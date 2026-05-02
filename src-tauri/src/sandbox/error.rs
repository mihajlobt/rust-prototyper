#[derive(Debug, thiserror::Error)]
pub enum SandboxError {
    #[error("Shell injection detected: {0}")]
    InjectionDetected(String),

    #[error("Execution policy denied: {0}")]
    PolicyDenied(String),

    #[error("Landlock error: {0}")]
    Landlock(String),

    #[error("Seccomp error: {0}")]
    Seccomp(String),

    #[error("Rlimit error: {0}")]
    Rlimit(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}