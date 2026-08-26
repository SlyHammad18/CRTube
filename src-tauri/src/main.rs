#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMABUF renderer paints a black video surface on Wayland
    // while audio still decodes/plays. Force the legacy GL/CPU path so the
    // <video> element actually renders. Harmless on X11 (ignored there).
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    crtube_lib::run()
}
