//! Shared setup for spawning child processes (ffprobe, ffmpeg, yt-dlp).
//!
//! On Windows, a console (cmd/terminal) window pops up for every spawned
//! `.exe` unless the `CREATE_NO_WINDOW` creation flag is set. CRTube's child
//! processes are all headless, so every spawn goes through one of the helpers
//! below.

pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn no_window(cmd: &mut tokio::process::Command) {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    #[cfg(not(windows))]
    let _ = cmd;
}

pub fn no_window_std(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    #[cfg(not(windows))]
    let _ = cmd;
}
