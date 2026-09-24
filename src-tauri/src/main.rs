#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // GTK3's native Wayland backend intentionally implements keep-above as a
    // no-op. Prefer XWayland so the overlay gets the X11/EWMH
    // _NET_WM_STATE_ABOVE hint; fall back to native Wayland if X11 is not
    // available. This must be set before Tauri initializes GTK.
    #[cfg(target_os = "linux")]
    std::env::set_var("GDK_BACKEND", "x11,wayland");

    // WebKitGTK's DMABUF renderer paints a black video surface on Wayland
    // while audio still decodes/plays. Force the legacy GL/CPU path so the
    // <video> element actually renders. Harmless on X11 (ignored there).
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    crtube_lib::run()
}
