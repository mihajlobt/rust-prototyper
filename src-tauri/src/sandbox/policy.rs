use once_cell::sync::Lazy;
use regex::Regex;

use super::error::SandboxError;

#[cfg(target_os = "linux")]
use agcodex_execpolicy::{ExecCall, PolicyParser};

static INJECTION_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    let patterns: &[&str] = &[
        // Reverse shells and network backconnect patterns
        r"/dev/tcp",
        r"/dev/udp",
        r"\bnc\s+-e\b",
        r"\bbash\s+-i\b",
        r"\bexec\s+\d+<>/dev/tcp",
        r"\bcurl\s*[|&]\s*sh\b",
        r"\bwget\s*[|&]\s*bash\b",
        // Privilege escalation / unsafe environment manipulation
        r"\bLD_PRELOAD\b",
        r"\bLD_LIBRARY_PATH\b",
        r"\bchmod\s+[0-7]*4[0-7]*[0-7]*[0-7]*\b",
        // Interpreter -c/-e eval patterns (code injection vectors)
        r"\bpython\d?\s+-c\b",
        r"\bperl\s+-e\b",
        r"\bruby\s+-e\b",
        r"\bnode\s+-e\b",
        r"\bnode\s+--eval\b",
        r"\bphp\s+-r\b",
        // Shell process substitution and pipe-to-shell patterns
        r"<\(",
        r"\|\s*(ba)?sh\b",
        r"\|\s*nc\b",
    ];
    patterns
        .iter()
        .filter_map(|p| Regex::new(p).ok())
        .collect()
});

#[cfg(target_os = "linux")]
static POLICY: Lazy<Result<agcodex_execpolicy::Policy, String>> = Lazy::new(|| {
    let policy_source = include_str!("prototyper.policy");
    let parser = PolicyParser::new("prototyper.policy", policy_source);
    parser
        .parse()
        .map_err(|e| format!("failed to parse policy: {e}"))
});

#[cfg(target_os = "linux")]
pub fn validate_command(command: &str) -> Result<(), SandboxError> {
    if detect_shell_injection(command) {
        return Err(SandboxError::InjectionDetected(
            format!("shell injection pattern detected in command: {command}")
        ));
    }

    let policy = match POLICY.as_ref() {
        Ok(p) => p,
        Err(e) => {
            return Err(SandboxError::PolicyDenied(
                format!("policy failed to load — all commands denied: {e}")
            ));
        }
    };

    let parts = match shlex::split(command) {
        Some(parts) if !parts.is_empty() => parts,
        _ => {
            return Err(SandboxError::PolicyDenied(
                format!("cannot parse command: {command}")
            ));
        }
    };

    // All commands — including compound ones — must pass policy validation.
    // Compound commands are NOT exempt. The bwrap + Landlock + seccomp sandbox
    // contains the rest; bypassing policy for pipes/AND/OR defeats the purpose.
    let program = parts[0].clone();
    let args: Vec<&str> = parts[1..].iter().map(String::as_str).collect();
    let exec_call = ExecCall::new(&program, &args);

    match policy.check(&exec_call) {
        Ok(agcodex_execpolicy::MatchedExec::Match { .. }) => Ok(()),
        Ok(agcodex_execpolicy::MatchedExec::Forbidden { cause, reason }) => {
            Err(SandboxError::PolicyDenied(format!(
                "execution policy denied: {:?} — {reason}", cause
            )))
        },
        Err(e) => Err(SandboxError::PolicyDenied(format!(
            "execution policy check failed: {e:?}"
        ))),
    }
}

fn detect_shell_injection(command: &str) -> bool {
    for pattern in INJECTION_PATTERNS.iter() {
        if pattern.is_match(command) {
            return true;
        }
    }
    false
}