#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // GTK3's native Wayland backend intentionally implements keep-above as a
    // no-op. Prefer XWayland so the overlay gets the X11/EWMH
    // _NET_WM_STATE_ABOVE hint; fall back to native Wayland if X11 is not
    // available. This must be set before Tauri initializes GTK.
    #[cfg(target_os = "linux")]
    std::env::set_var("GDK_BACKEND", "x11,wayland");

    // Zero-copy video: WebKit's GL video sink lets the compositor sample
    // decoder-owned DMABufs directly, and the VA-API decoder recycles one
    // that is still being sampled (WebKit bug 253807) — old and new frames
    // mix persistently on Intel iGPUs, worst past a seek when buffer churn
    // peaks. Two layers of defense, both verified present in WebKitGTK 2.54:
    //
    // 1. WEBKIT_GST_DMABUF_SINK_DISABLED=1 — the original fix: force the
    //    GLMemory upload path instead of zero-copy DMABuf sampling.
    // 2. WEBKIT_GST_DISABLE_GL_SINK=1 — with WebKit 2.54 + GStreamer 1.26
    //    (new `va` decoder stack) the GL-upload path STILL mixes frames on
    //    this Intel HD 530. Disabling the GL video sink outright takes video
    //    frames out of GL-texture recycling entirely — the mixing mechanism
    //    is gone by construction. Cost: decoded frames composite via CPU
    //    upload (fine at 360p streams / 480–1080p files here); the DMABUF
    //    *page* renderer stays enabled so scrolling/UI keep the GPU path.
    //
    // If video artifacts ever return, escalate in this order:
    //   a. WEBKIT_GST_ENABLE_LEGACY_VAAPI=1 (old vaapi decode path)
    //   b. WEBKIT_DISABLE_DMABUF_RENDERER=1 (full CPU page renderer — the
    //      documented last resort; costs scroll/animation performance)
    // NOTE: WEBKIT_DMABUF_RENDERER_DEVICE does NOT exist in WebKitGTK 2.54
    // (verified: no such string in libwebkit2gtk) — do not bother setting it.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_GST_DMABUF_SINK_DISABLED").is_none() {
        std::env::set_var("WEBKIT_GST_DMABUF_SINK_DISABLED", "1");
    }
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_GST_DISABLE_GL_SINK").is_none() {
        std::env::set_var("WEBKIT_GST_DISABLE_GL_SINK", "1");
    }

    crtube_lib::run()
}
