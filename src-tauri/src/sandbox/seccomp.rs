use super::error::SandboxError;

#[cfg(target_os = "linux")]
pub fn apply_seccomp_filter() -> Result<(), SandboxError> {
    use seccompiler::{
        BpfProgram, SeccompAction, SeccompFilter, SeccompRule,
    };
    use std::convert::TryInto;

    let allowed_syscalls: Vec<(i64, Vec<SeccompRule>)> = vec![
        (libc::SYS_read, vec![]),
        (libc::SYS_write, vec![]),
        (libc::SYS_openat, vec![]),
        (libc::SYS_close, vec![]),
        (libc::SYS_fstat, vec![]),
        (libc::SYS_lseek, vec![]),
        (libc::SYS_mmap, vec![]),
        (libc::SYS_munmap, vec![]),
        (libc::SYS_mprotect, vec![]),
        (libc::SYS_brk, vec![]),
        (libc::SYS_rt_sigaction, vec![]),
        (libc::SYS_rt_sigprocmask, vec![]),
        (libc::SYS_ioctl, vec![]),
        (libc::SYS_access, vec![]),
        (libc::SYS_pipe2, vec![]),
        (libc::SYS_dup, vec![]),
        (libc::SYS_dup2, vec![]),
        (libc::SYS_dup3, vec![]),
        (libc::SYS_futex, vec![]),
        (libc::SYS_set_robust_list, vec![]),
        (libc::SYS_getdents64, vec![]),
        (libc::SYS_faccessat, vec![]),
        (libc::SYS_readlinkat, vec![]),
        (libc::SYS_fadvise64, vec![]),
        (libc::SYS_clock_gettime, vec![]),
        (libc::SYS_getrandom, vec![]),
        (libc::SYS_rseq, vec![]),
        (libc::SYS_exit, vec![]),
        (libc::SYS_exit_group, vec![]),
        (libc::SYS_arch_prctl, vec![]),
        (libc::SYS_set_tid_address, vec![]),
        (libc::SYS_sigaltstack, vec![]),
        (libc::SYS_clone3, vec![]),
        (libc::SYS_clone, vec![]),
        // vfork: Node.js child_process.spawn() uses vfork() on Linux for performance
        // before falling back to clone(). Without it, posix_spawn() fails with EPERM.
        // Reference: Node.js libuv src/unix/process.c uses uv_spawn() which calls vfork()
        (libc::SYS_vfork, vec![]),
        (libc::SYS_wait4, vec![]),
        (libc::SYS_waitid, vec![]),
        (libc::SYS_socket, vec![]),
        (libc::SYS_connect, vec![]),
        (libc::SYS_bind, vec![]),
        (libc::SYS_listen, vec![]),
        (libc::SYS_recvmsg, vec![]),
        (libc::SYS_sendmsg, vec![]),
        (libc::SYS_recvfrom, vec![]),
        (libc::SYS_sendto, vec![]),
        (libc::SYS_getsockname, vec![]),
        (libc::SYS_getpeername, vec![]),
        (libc::SYS_socketpair, vec![]),
        (libc::SYS_setsockopt, vec![]),
        (libc::SYS_getsockopt, vec![]),
        (libc::SYS_fcntl, vec![]),
        (libc::SYS_execve, vec![]),
        (libc::SYS_execveat, vec![]),
        (libc::SYS_newfstatat, vec![]),
        (libc::SYS_getpid, vec![]),
        (libc::SYS_getppid, vec![]),
        (libc::SYS_getuid, vec![]),
        (libc::SYS_getgid, vec![]),
        (libc::SYS_geteuid, vec![]),
        (libc::SYS_getegid, vec![]),
        (libc::SYS_getcwd, vec![]),
        (libc::SYS_umask, vec![]),
        (libc::SYS_chdir, vec![]),
        (libc::SYS_renameat, vec![]),
        (libc::SYS_linkat, vec![]),
        (libc::SYS_unlinkat, vec![]),
        (libc::SYS_mkdirat, vec![]),
        (libc::SYS_flock, vec![]),
        (libc::SYS_poll, vec![]),
        (libc::SYS_ppoll, vec![]),
        (libc::SYS_epoll_create1, vec![]),
        (libc::SYS_epoll_ctl, vec![]),
        (libc::SYS_epoll_wait, vec![]),
        (libc::SYS_prlimit64, vec![]),
        (libc::SYS_madvise, vec![]),
        // bash/bun runtime requirements
        (libc::SYS_writev, vec![]),
        (libc::SYS_pread64, vec![]),
        (libc::SYS_pwrite64, vec![]),
        (libc::SYS_nanosleep, vec![]),
        (libc::SYS_sched_yield, vec![]),
        (libc::SYS_mremap, vec![]),
        (libc::SYS_prctl, vec![]),
        (libc::SYS_getrlimit, vec![]),
        (libc::SYS_sysinfo, vec![]),
        (libc::SYS_clock_getres, vec![]),
        (libc::SYS_splice, vec![]),
        (libc::SYS_tgkill, vec![]),
        (libc::SYS_rt_sigreturn, vec![]),
        (libc::SYS_stat, vec![]),
        (libc::SYS_mkdir, vec![]),
        (libc::SYS_rmdir, vec![]),
        (libc::SYS_unlink, vec![]),
        // bash job control (getpgrp(2), getpgid(2), setpgid(2), getsid(2))
        (libc::SYS_getpgrp, vec![]),
        (libc::SYS_getpgid, vec![]),
        (libc::SYS_setpgid, vec![]),
        (libc::SYS_getsid, vec![]),
        // Modern file metadata (statx(2), statfs(2), fstatfs(2), renameat2(2))
        (libc::SYS_statx, vec![]),
        (libc::SYS_statfs, vec![]),
        (libc::SYS_fstatfs, vec![]),
        (libc::SYS_renameat2, vec![]),
        // Runtime requirements (membarrier(2), syncfs(2), copy_file_range(2))
        (libc::SYS_membarrier, vec![]),
        (libc::SYS_syncfs, vec![]),
        (libc::SYS_copy_file_range, vec![]),
        // File timestamp and permission operations (utimensat(2))
        (libc::SYS_utimensat, vec![]),
        (libc::SYS_fchmodat, vec![]),
        (libc::SYS_fchmod, vec![]),
        (libc::SYS_fchownat, vec![]),
        (libc::SYS_fchown, vec![]),
        (libc::SYS_getdents, vec![]),
        // Extended attribute reads (needed by ls -la, getfattr, security.xattr queries)
        (libc::SYS_getxattr, vec![]),
        (libc::SYS_lgetxattr, vec![]),
        (libc::SYS_fgetxattr, vec![]),
        (libc::SYS_listxattr, vec![]),
        (libc::SYS_llistxattr, vec![]),
        (libc::SYS_flistxattr, vec![]),
        // bun event loop: timerfd-based timers (libuSockets on Linux uses timerfd, not setitimer)
        // Reference: https://github.com/uNetworking/uSockets/blob/master/src/eventing/epoll_kqueue.h
        (libc::SYS_timerfd_create, vec![]),
        (libc::SYS_timerfd_settime, vec![]),
        (libc::SYS_timerfd_gettime, vec![]),
        // bun event loop: epoll_pwait adds signal-mask arg vs epoll_wait
        (libc::SYS_epoll_pwait, vec![]),
        // bun/libuSockets: eventfd for inter-thread wakeup
        (libc::SYS_eventfd2, vec![]),
        // bun reads kernel version via uname(2) (reports "Linux Kernel v0.0.0" when blocked)
        (libc::SYS_uname, vec![]),
        // inotify for file watching (bun --watch, hot reload)
        (libc::SYS_inotify_init1, vec![]),
        (libc::SYS_inotify_add_watch, vec![]),
        (libc::SYS_inotify_rm_watch, vec![]),
        // io_uring: bun uses io_uring for async I/O on modern Linux kernels
        // Reference: bun uses libuv/libuSockets which selects io_uring on Linux 5.4+
        (libc::SYS_io_uring_setup, vec![]),
        (libc::SYS_io_uring_enter, vec![]),
        (libc::SYS_io_uring_register, vec![]),
        // Additional syscalls for bun/JSC JavaScript engine
        (libc::SYS_getrusage, vec![]),
        (libc::SYS_lstat, vec![]),
        (libc::SYS_pipe, vec![]),
        (libc::SYS_sched_getaffinity, vec![]),
        (libc::SYS_sched_setaffinity, vec![]),
        (libc::SYS_clock_nanosleep, vec![]),
        (libc::SYS_memfd_create, vec![]),
        (libc::SYS_sendfile, vec![]),
        (libc::SYS_ftruncate, vec![]),
        (libc::SYS_truncate, vec![]),
        (libc::SYS_preadv, vec![]),
        (libc::SYS_pwritev, vec![]),
        (libc::SYS_preadv2, vec![]),
        (libc::SYS_pwritev2, vec![]),
        (libc::SYS_readv, vec![]),
        (libc::SYS_getgroups, vec![]),
        (libc::SYS_getresuid, vec![]),
        (libc::SYS_getresgid, vec![]),
        (libc::SYS_msync, vec![]),
        (libc::SYS_mincore, vec![]),
        (libc::SYS_mlock, vec![]),
        (libc::SYS_munlock, vec![]),
        (libc::SYS_mlock2, vec![]),
        (libc::SYS_epoll_pwait2, vec![]),
        (libc::SYS_openat2, vec![]),
        (libc::SYS_close_range, vec![]),
        (libc::SYS_dup, vec![]),
        (libc::SYS_shutdown, vec![]),
        (libc::SYS_symlinkat, vec![]),
        // Thread/signal management gaps
        (libc::SYS_get_robust_list, vec![]),
        (libc::SYS_rt_sigpending, vec![]),
        (libc::SYS_rt_sigsuspend, vec![]),
        (libc::SYS_rt_sigtimedwait, vec![]),
        (libc::SYS_fchdir, vec![]),
        (libc::SYS_accept, vec![]),
        (libc::SYS_accept4, vec![]),
        // landlock syscalls: bun's JSC or Zig std may probe for Landlock support
        (libc::SYS_landlock_create_ruleset, vec![]),
        (libc::SYS_landlock_add_rule, vec![]),
        (libc::SYS_landlock_restrict_self, vec![]),
        // personality: some JIT engines disable ASLR for code pages
        (libc::SYS_personality, vec![]),
        // Capability checks: bun may call capget to check its privileges
        (libc::SYS_capget, vec![]),
        // seccomp: JSC/bun might try to install its own seccomp filter
        (libc::SYS_seccomp, vec![]),
        // Scheduling policy queries
        (libc::SYS_sched_getscheduler, vec![]),
        (libc::SYS_sched_setscheduler, vec![]),
        (libc::SYS_sched_getparam, vec![]),
        (libc::SYS_sched_setparam, vec![]),
        (libc::SYS_sched_get_priority_max, vec![]),
        (libc::SYS_sched_get_priority_min, vec![]),
        (libc::SYS_sched_yield, vec![]),
        // Misc syscalls commonly used by glibc/musl/bun
        (libc::SYS_alarm, vec![]),
        (libc::SYS_pause, vec![]),
        (libc::SYS_nanosleep, vec![]),
        (libc::SYS_times, vec![]),
        (libc::SYS_ptrace, vec![]),
        (libc::SYS_getitimer, vec![]),
        (libc::SYS_setitimer, vec![]),
        (libc::SYS_semget, vec![]),
        (libc::SYS_semop, vec![]),
        (libc::SYS_semctl, vec![]),
        (libc::SYS_shmget, vec![]),
        (libc::SYS_shmat, vec![]),
        (libc::SYS_shmctl, vec![]),
        (libc::SYS_msgget, vec![]),
        (libc::SYS_msgsnd, vec![]),
        (libc::SYS_msgrcv, vec![]),
        (libc::SYS_msgctl, vec![]),
        (libc::SYS_shmdt, vec![]),
        (libc::SYS_getpgrp, vec![]),
        (libc::SYS_lookup_dcookie, vec![]),
        (libc::SYS_io_setup, vec![]),
        (libc::SYS_io_destroy, vec![]),
        (libc::SYS_io_getevents, vec![]),
        (libc::SYS_io_submit, vec![]),
        (libc::SYS_io_cancel, vec![]),
        (libc::SYS_perf_event_open, vec![]),
        // gettid: used pervasively by threading code and JSC's garbage collector
        (libc::SYS_gettid, vec![]),
        // Legacy (non-at) file syscalls: glibc/musl/bun emit these on x86_64 for compatibility.
        // Blocked syscall probing revealed SYS_open (2) as the first denied call.
        (libc::SYS_open, vec![]),
        (libc::SYS_creat, vec![]),
        (libc::SYS_rename, vec![]),
        (libc::SYS_link, vec![]),
        (libc::SYS_unlink, vec![]),
        (libc::SYS_symlink, vec![]),
        (libc::SYS_readlink, vec![]),
        (libc::SYS_chmod, vec![]),
        (libc::SYS_chown, vec![]),
        (libc::SYS_lchown, vec![]),
        (libc::SYS_mknod, vec![]),
        (libc::SYS_utime, vec![]),
        (libc::SYS_utimes, vec![]),
        (libc::SYS_getdents, vec![]),
    ];

    let default_action = SeccompAction::Errno(libc::EPERM as u32);

    let filter: SeccompFilter = SeccompFilter::new(
        allowed_syscalls.into_iter().collect(),
        default_action,
        SeccompAction::Allow,
        std::env::consts::ARCH.try_into().map_err(|e| {
            SandboxError::Seccomp(format!("unsupported architecture: {e:?}"))
        })?,
    )
    .map_err(|e| SandboxError::Seccomp(format!("failed to create seccomp filter: {e}")))?;

    let bpf_program: BpfProgram = filter.try_into().map_err(|e| {
        SandboxError::Seccomp(format!("failed to compile seccomp BPF: {e}"))
    })?;

    seccompiler::apply_filter(&bpf_program).map_err(|e| {
        SandboxError::Seccomp(format!("failed to apply seccomp filter: {e}"))
    })?;

    Ok(())
}