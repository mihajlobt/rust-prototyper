use std::path::Path;

use super::error::SandboxError;

/// Apply Landlock LSM restrictions inside the sandbox process.
/// Called after bwrap sets up mount namespaces (inside --sandbox-init).
/// Uses ABI::V2 to request Refer right (needed for statx/open).
/// BestEffort compatibility automatically downgrades to what the kernel supports.
/// See: https://www.kernel.org/doc/html/latest/userspace-api/landlock.html
#[cfg(target_os = "linux")]
pub fn apply_landlock(project_dir: &Path, self_exe: &Path) -> Result<(), SandboxError> {
    use landlock::{
        Access, AccessFs, CompatLevel, Compatible, PathBeneath, PathFd,
        Ruleset, RulesetAttr, RulesetCreatedAttr, ABI, RulesetStatus,
    };

    let abi = ABI::V2;

    let access_fs = AccessFs::from_all(abi);
    let status = Ruleset::default()
        .handle_access(access_fs)
        .map_err(|e| SandboxError::Landlock(format!("handle_access failed: {e}")))?
        .set_compatibility(CompatLevel::BestEffort)
        .create()
        .map_err(|e| SandboxError::Landlock(format!("ruleset create failed: {e}")))?;

    let project_dir_str = project_dir.to_string_lossy();

    let read_execute = AccessFs::from_read(abi) | AccessFs::Execute;
    let read_only = AccessFs::from_read(abi);
    let read_write = AccessFs::from_all(abi);

    let rules: Vec<PathBeneath<PathFd>> = vec![
        PathBeneath::new(
            PathFd::new("/usr").map_err(|e| SandboxError::Landlock(format!("open /usr: {e}")))?,
            read_execute,
        ),
        // /lib and /lib64 are symlinks to usr/lib on Arch but bwrap bind-mounts them as
        // SEPARATE mount points. Landlock traces the directory hierarchy through the mount
        // tree, so the /usr rule does not cover paths accessed via /lib64 (a different mount).
        // Both rules are needed even though the inodes are identical.
        PathBeneath::new(
            PathFd::new("/lib").map_err(|e| SandboxError::Landlock(format!("open /lib: {e}")))?,
            read_execute,
        ),
        PathBeneath::new(
            PathFd::new("/lib64").map_err(|e| SandboxError::Landlock(format!("open /lib64: {e}")))?,
            read_execute,
        ),
        PathBeneath::new(
            PathFd::new("/proc").map_err(|e| SandboxError::Landlock(format!("open /proc: {e}")))?,
            read_only,
        ),
        PathBeneath::new(
            PathFd::new("/dev").map_err(|e| SandboxError::Landlock(format!("open /dev: {e}")))?,
            read_write,
        ),
        PathBeneath::new(
            PathFd::new("/etc").map_err(|e| SandboxError::Landlock(format!("open /etc: {e}")))?,
            read_only,
        ),
        PathBeneath::new(
            PathFd::new("/run").map_err(|e| SandboxError::Landlock(format!("open /run: {e}")))?,
            read_only,
        ),
        PathBeneath::new(
            PathFd::new("/tmp").map_err(|e| SandboxError::Landlock(format!("open /tmp: {e}")))?,
            read_write,
        ),
        PathBeneath::new(
            PathFd::new(project_dir_str.as_ref())
                .map_err(|e| SandboxError::Landlock(format!("open {}: {e}", project_dir_str)))?,
            read_write,
        ),
        PathBeneath::new(
            PathFd::new(self_exe).map_err(|e| SandboxError::Landlock(format!("open {}: {e}", self_exe.display())))?,
            read_execute,
        ),
    ];

    let mut created = status;
    for rule in rules {
        created = created.add_rule(rule).map_err(|e| {
            SandboxError::Landlock(format!("add_rule failed: {e}"))
        })?;
    }

    // Bun's package resolver traverses up the directory tree with
    // O_RDONLY | O_DIRECTORY to find workspace/package.json boundaries.
    // Without read access to ancestor directories, it fails with EACCES.
    // Grant ReadDir (list directory entries, no file content) on each
    // ancestor so bun can traverse without exposing file contents.
    // Reference: LANDLOCK_ACCESS_FS_READ_DIR kernel docs §5.3
    let mut ancestor = project_dir.parent();
    while let Some(parent) = ancestor {
        if parent == Path::new("") || parent == Path::new("/") {
            break;
        }
        if let Ok(fd) = PathFd::new(parent) {
            created = created.add_rule(PathBeneath::new(fd, AccessFs::ReadDir))
                .map_err(|e| SandboxError::Landlock(format!("add ancestor rule {}: {e}", parent.display())))?;
        } else {
            break;
        }
        ancestor = parent.parent();
    }

    let restriction = created.restrict_self().map_err(|e| {
        SandboxError::Landlock(format!("restrict_self failed: {e}"))
    })?;

    // Only print Landlock status in debug mode (SANDBOX_DEBUG env var set)
    // Partially enforced is normal on most kernels, so suppress that by default
    let debug = std::env::var("SANDBOX_DEBUG").is_ok();
    match restriction.ruleset {
        RulesetStatus::FullyEnforced if debug => {
            eprintln!("[sandbox] Landlock fully enforced (ABI {:?})", abi);
        }
        RulesetStatus::PartiallyEnforced if debug => {
            eprintln!("[sandbox] Landlock partially enforced — some access rights unsupported by kernel");
        }
        RulesetStatus::NotEnforced => {
            // This is a warning - Landlock is the primary security layer
            eprintln!("[sandbox] WARNING: Landlock not enforced — kernel may not support Landlock");
        }
        _ => {}
    }

    Ok(())
}