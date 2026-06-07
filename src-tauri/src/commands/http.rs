use std::collections::HashMap;
use tauri::{AppHandle, Manager};
use crate::{AppState, AppError, app_data_dir};

fn is_private_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    let blocked_prefixes = [
        "http://127.", "https://127.", "http://localhost", "https://localhost",
        "http://0.0.0.0", "https://0.0.0.0", "http://::1", "https://::1",
        "http://10.", "https://10.", "http://192.168.", "https://192.168.",
        "http://169.254.", "https://169.254.",
    ];
    for prefix in &blocked_prefixes {
        if lower.starts_with(prefix) { return true; }
    }
    for protocol in &["http://172.", "https://172."] {
        if let Some(rest) = lower.strip_prefix(protocol) {
            if let Some(octet) = rest.split('.').next() {
                if let Ok(n) = octet.parse::<u8>() {
                    if (16..=31).contains(&n) { return true; }
                }
            }
        }
    }
    false
}

#[derive(serde::Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

#[tauri::command]
pub async fn http_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    app: AppHandle,
) -> Result<HttpResponse, AppError> {
    if is_private_url(&url) {
        return Err(AppError::Security("Private/internal URLs are blocked".into()));
    }
    let state = app.state::<AppState>();
    let client = &state.http_client;
    let mut req = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        _ => return Err(AppError::Http(format!("Unsupported method: {}", method))),
    };
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let res = if let Some(b) = body {
        req.body(b).send().await.map_err(|e| AppError::Http(e.to_string()))?
    } else {
        req.send().await.map_err(|e| AppError::Http(e.to_string()))?
    };
    let status = res.status().as_u16();
    let mut res_headers = HashMap::new();
    for (k, v) in res.headers() {
        if let Ok(v) = v.to_str() {
            res_headers.insert(k.to_string(), v.to_string());
        }
    }
    let body = res.text().await.map_err(|e| AppError::Http(e.to_string()))?;
    Ok(HttpResponse { status, headers: res_headers, body })
}

/// Test a SearXNG instance by hitting its JSON search endpoint.
/// Uses the same reqwest client as the agent (no localhost restriction).
/// Returns Ok(true) if the instance is reachable and JSON-enabled, Err otherwise.
#[tauri::command]
pub async fn test_searxng_connection(url: String, app: AppHandle) -> Result<bool, String> {
    let base = url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("URL is empty".into());
    }
    let test_url = format!("{base}/search?q=test&format=json");
    let state = app.state::<AppState>();
    let resp = state.http_client
        .get(&test_url)
        .send()
        .await
        .map_err(|e| format!("Connection failed: {e}"))?;

    if resp.status().is_success() {
        Ok(true)
    } else {
        Err(format!("HTTP {} — JSON format may not be enabled in SearXNG settings.yml", resp.status().as_u16()))
    }
}

/// Write a minimal SearXNG settings.yml under `<app_data_dir>/.searxng/`
/// with `use_default_settings: true` and `search.formats: [html, json]` enabled.
///
/// This is the released-app equivalent of the user manually creating
/// `~/.searxng/settings.yml` — putting the config under the app data dir
/// keeps it co-located with the app, and lets the UI show the exact path
/// so the user can mount it into the SearXNG docker container.
///
/// Returns the absolute path to the written file.
#[tauri::command]
pub async fn setup_searxng_config(app: AppHandle) -> Result<String, String> {
    let base = app_data_dir(&app).map_err(|e| e.to_string())?;
    let dir = base.join(".searxng");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let path = dir.join("settings.yml");
    let content = "use_default_settings: true\n\
                   \n\
                   search:\n  \
                   formats:\n    \
                   - html\n    \
                   - json\n";
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().to_string())
}
