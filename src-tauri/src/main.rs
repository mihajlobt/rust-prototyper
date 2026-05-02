#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && args[1] == "--sandbox-init" {
        #[cfg(target_os = "linux")]
        app_lib::sandbox::sandbox_init(&args[3..]);
        #[cfg(not(target_os = "linux"))]
        unreachable!("--sandbox-init only supported on Linux");
    }
    app_lib::run()
}
