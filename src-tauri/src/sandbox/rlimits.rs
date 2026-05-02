use super::error::SandboxError;

const RLIMIT_CPU_SOFT: u64 = 120;
const RLIMIT_CPU_HARD: u64 = 120;

#[cfg(target_os = "linux")]
pub fn apply_rlimits() -> Result<(), SandboxError> {
    use nix::sys::resource::{setrlimit, Resource};

    setrlimit(Resource::RLIMIT_CPU, RLIMIT_CPU_SOFT, RLIMIT_CPU_HARD).map_err(|e| {
        SandboxError::Rlimit(format!("RLIMIT_CPU: {e}"))
    })?;

    // RLIMIT_AS and RLIMIT_NOFILE intentionally not set:
    // bun requires high address space and fd limits.
    // bwrap namespace isolation provides containment
    // without needing rlimit constraints on these resources.

    Ok(())
}