#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // GTK3's native Wayland backend intentionally implements keep-above as a
    // no-op. Prefer XWayland so the overlay gets the X11/EWMH
    // _NET_WM_STATE_ABOVE hint; fall back to native Wayland if X11 is not
    // available. This must be set before Tauri initializes GTK.
    #[cfg(target_os = "linux")]
    std::env::set_var("GDK_BACKEND", "x11,wayland");

    // WebKitGPU note: the DMABUF renderer historically painted a black <video>
    // surface on Wayland (audio played, video didn't), so this binary used to
    // force the legacy CPU path via WEBKIT_DISABLE_DMABUF_RENDERER — at the
    // cost of sluggish scroll/tab-switch under CPU compositing. Recent
    // WebKitGTK (≥ 2.42) fixed most dmabuf bugs, and the app already prefers
    // XWayland (GDK_BACKEND=x11) where that bug largely doesn't apply, so the
    // renderer is now left at its default and you still get the GPU path.
    //
    // If video ever renders black on some system: prefer setting
    // WEBKIT_DMABUF_RENDERER_DEVICE=/dev/dri/renderD128 (point at the primary
    // render node); as a last resort launch with WEBKIT_DISABLE_DMABUF_RENDERER=1.
    crtube_lib::run()
}
