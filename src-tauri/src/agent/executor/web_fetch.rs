use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use super::{ToolError, ToolExecutionResult};
use crate::agent::tools::WebFetchArgs;

const MAX_RESPONSE_SIZE: u64 = 5 * 1024 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

fn error_result(output: String) -> ToolExecutionResult {
    ToolExecutionResult { success: false, output, written_path: None, written_content: None }
}

/// True if `ip` falls in a loopback, private, link-local, or carrier-grade-NAT range —
/// the address classes a server-side fetcher must refuse so a malicious URL can't be
/// used to reach the host's own network or cloud metadata endpoints (e.g. 169.254.169.254,
/// fd00:ec2::254) from inside the agent loop.
fn is_blocked_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let octets = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.is_documentation()
                || (octets[0] == 100 && (octets[1] & 0xC0) == 64) // 100.64.0.0/10 — CGNAT
        }
        IpAddr::V6(v6) => {
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_blocked_ip(&IpAddr::V4(mapped));
            }
            let segments = v6.segments();
            v6.is_loopback()
                || v6.is_unspecified()
                || (segments[0] & 0xfe00) == 0xfc00 // fc00::/7 — unique local
                || (segments[0] & 0xffc0) == 0xfe80 // fe80::/10 — link-local
                || segments == [0xfd00, 0, 0, 0, 0, 0xec2, 0, 0x254] // AWS IMDSv2 IPv6 metadata
        }
    }
}

/// Resolves `host:port`, validates every returned address against the SSRF blocklist, and
/// returns the first allowed one. The caller pins the connection to exactly this address
/// (via `ClientBuilder::resolve`) so the address that gets validated is the address that
/// gets connected to. Without pinning, a DNS-rebinding attacker serves a public address
/// for this lookup and a private one for the connection's own (separate) lookup, making
/// the validation here a no-op.
async fn resolve_and_validate(host: &str, port: u16) -> Result<SocketAddr, String> {
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| format!("DNS resolution failed for '{host}' — {e}"))?
        .collect();

    if addrs.is_empty() {
        return Err(format!("DNS resolution returned no addresses for '{host}'"));
    }

    for addr in &addrs {
        if is_blocked_ip(&addr.ip()) {
            return Err(format!(
                "refusing to fetch '{host}' — it resolves to {}, a private/internal/link-local address. \
                 Fetching internal network addresses is blocked to prevent SSRF.",
                addr.ip()
            ));
        }
    }

    Ok(addrs[0])
}

pub(in crate::agent) async fn execute_web_fetch(args: &serde_json::Value) -> ToolExecutionResult {
    let parsed = match serde_json::from_value::<WebFetchArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return error_result(format!("web_fetch: {}", ToolError::InvalidArguments(e.to_string()))),
    };

    let mut url = match reqwest::Url::parse(&parsed.url) {
        Ok(u) => u,
        Err(e) => return error_result(format!("web_fetch: invalid URL '{}' — {e}", parsed.url)),
    };

    match url.scheme() {
        "https" => {}
        "http" => {
            // Upgrade to https — the tool never sends plaintext requests.
            if url.set_scheme("https").is_err() {
                return error_result(format!("web_fetch: failed to upgrade '{}' to https", parsed.url));
            }
        }
        other => {
            return error_result(format!(
                "web_fetch: unsupported URL scheme '{other}'. Only http and https URLs are allowed."
            ));
        }
    }

    let host = match url.host_str() {
        Some(h) => h.to_string(),
        None => return error_result(format!("web_fetch: URL '{url}' has no host")),
    };
    let port = url.port_or_known_default().unwrap_or(443);

    let pinned_addr = match resolve_and_validate(&host, port).await {
        Ok(addr) => addr,
        Err(message) => return error_result(format!("web_fetch: {message}")),
    };

    // A fresh, single-use client is required here: the shared http_client's DNS resolver
    // is fixed at construction time and cannot be overridden per-request, but pinning the
    // connection to the address we just validated is exactly what closes the SSRF gap above.
    let pinned_client = match reqwest::Client::builder()
        .resolve(&host, pinned_addr)
        .timeout(FETCH_TIMEOUT)
        .build()
    {
        Ok(c) => c,
        Err(e) => return error_result(format!("web_fetch: failed to build HTTP client — {e}")),
    };

    let response = match pinned_client.get(url.clone()).send().await {
        Ok(r) => r,
        Err(e) if e.is_timeout() => {
            return error_result(format!("web_fetch: request to {url} timed out after {}s", FETCH_TIMEOUT.as_secs()));
        }
        Err(e) => return error_result(format!("web_fetch: request to {url} failed — {e}")),
    };

    if !response.status().is_success() {
        return error_result(format!("web_fetch: HTTP {} fetching {url}", response.status().as_u16()));
    }

    if let Some(len) = response.content_length() {
        if len > MAX_RESPONSE_SIZE {
            return error_result(format!(
                "web_fetch: response too large ({len} bytes, max {MAX_RESPONSE_SIZE} bytes)"
            ));
        }
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let bytes = match response.bytes().await {
        Ok(b) => b,
        Err(e) => return error_result(format!("web_fetch: failed to read response body from {url} — {e}")),
    };

    if bytes.len() as u64 > MAX_RESPONSE_SIZE {
        return error_result(format!(
            "web_fetch: response too large ({} bytes, max {MAX_RESPONSE_SIZE} bytes)",
            bytes.len()
        ));
    }

    let text = String::from_utf8_lossy(&bytes).into_owned();

    let body = if content_type.contains("text/html") {
        match htmd::convert(&text) {
            Ok(markdown) => markdown,
            Err(_) => text,
        }
    } else {
        text
    };

    ToolExecutionResult {
        success: true,
        output: format!(
            "Fetched {url} ({} bytes{}).\nExtraction goal: {}\n\n{body}",
            bytes.len(),
            if content_type.is_empty() { String::new() } else { format!(", content-type: {content_type}") },
            parsed.prompt,
        ),
        written_path: None,
        written_content: None,
    }
}
