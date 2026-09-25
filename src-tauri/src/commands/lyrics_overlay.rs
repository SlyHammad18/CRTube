use std::sync::Arc;
use std::time::Duration;

#[cfg(target_os = "linux")]
use std::os::raw::{c_int, c_uchar, c_ulong};
#[cfg(target_os = "linux")]
use std::slice;

use serde::Serialize;
use tauri::window::Color;
use tauri::{
    AppHandle, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    Window, WindowEvent,
};

use crate::services::db::{self, Db, LibraryEntry};
use crate::services::lyrics;
use crate::services::lyrics_overlay::{
    self, LyricsOverlayPrefs, WINDOW_LABEL,
};
use crate::services::mpris::Mpris;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsOverlaySnapshot {
    pub entry: LibraryEntry,
    pub sequence: u64,
    pub position_s: f64,
    pub playing: bool,
    pub speed: f64,
    pub volume: f64,
    pub muted: bool,
    pub can_next: bool,
    pub can_previous: bool,
    pub shuffle: bool,
    pub repeat: String,
    pub lyrics_revision: u64,
}

fn overlay_url(app: &AppHandle) -> WebviewUrl {
    if cfg!(debug_assertions) {
        let mut url = app
            .config()
            .build
            .dev_url
            .clone()
            .unwrap_or_else(|| "http://localhost:1420/".parse().expect("valid Vite URL"));
        url.set_fragment(Some("lyrics-overlay"));
        WebviewUrl::External(url)
    } else {
        WebviewUrl::App("index.html#lyrics-overlay".into())
    }
}

fn monitor_work_area(
    monitor: &tauri::window::Monitor,
) -> (i32, i32, u32, u32) {
    let area = monitor.work_area();
    (
        area.position.x,
        area.position.y,
        area.size.width,
        area.size.height,
    )
}

fn available_work_areas(app: &AppHandle) -> Vec<(i32, i32, u32, u32)> {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(monitor_work_area)
        .collect()
}

fn default_position(
    app: &AppHandle,
    size: (u32, u32),
) -> (i32, i32) {
    let area = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor_work_area(&monitor))
        .unwrap_or((0, 0, 1920, 1080));
    (
        area.0 + area.2.saturating_sub(size.0) as i32 - 12,
        area.1 + 12,
    )
}

fn place_initial_window(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    prefs: &LyricsOverlayPrefs,
) -> Result<(), String> {
    let physical_size = window.outer_size().map_err(|e| e.to_string())?;
    let size = (physical_size.width, physical_size.height);
    let saved = prefs.x.zip(prefs.y);
    let position = saved
        .filter(|position| {
            lyrics_overlay::position_is_visible(
                *position,
                size,
                &available_work_areas(app),
            )
        })
        .unwrap_or_else(|| default_position(app, size));
    window
        .set_position(PhysicalPosition::new(position.0, position.1))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Mutter's X11 backend treats a window as focusable when either
/// `WM_HINTS.input` is true or the window advertises `WM_TAKE_FOCUS`.
/// Tauri's `set_focusable(false)` only clears `WM_HINTS.input`; GTK still
/// advertises `WM_TAKE_FOCUS`. A sticky overlay with that protocol can
/// therefore be selected as the default focus window when the user changes
/// workspaces. Remove only that protocol and preserve the close/ping protocols.
#[cfg(target_os = "linux")]
fn remove_wm_take_focus(window: &WebviewWindow) -> Result<(), String> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};

    let raw_handle = match window.window_handle() {
        Ok(handle) => handle,
        // Tauri does not expose a native handle until a hidden window has
        // been realized. The post-map pass below will enforce the protocol.
        Err(_) => return Ok(()),
    };
    let window_id = match raw_handle.as_raw() {
        RawWindowHandle::Xlib(handle) => handle.window,
        _ => return Ok(()),
    };

    let display = unsafe { x11::xlib::XOpenDisplay(std::ptr::null()) };
    if display.is_null() {
        return Err(
            "failed to open the X11 display for lyrics overlay focus policy".into(),
        );
    }

    let result = (|| -> Result<(), String> {
        let protocols_atom =
            unsafe { x11::xlib::XInternAtom(display, c"WM_PROTOCOLS".as_ptr(), 0) };
        let take_focus_atom =
            unsafe { x11::xlib::XInternAtom(display, c"WM_TAKE_FOCUS".as_ptr(), 0) };

        let mut actual_type: c_ulong = 0;
        let mut actual_format: c_int = 0;
        let mut items: c_ulong = 0;
        let mut bytes_after: c_ulong = 0;
        let mut data: *mut c_uchar = std::ptr::null_mut();
        let status = unsafe {
            x11::xlib::XGetWindowProperty(
                display,
                window_id,
                protocols_atom,
                0,
                1024,
                0,
                x11::xlib::XA_ATOM,
                &mut actual_type,
                &mut actual_format,
                &mut items,
                &mut bytes_after,
                &mut data,
            )
        };
        if status != x11::xlib::Success as c_int {
            if !data.is_null() {
                unsafe {
                    x11::xlib::XFree(data.cast());
                }
            }
            return Err(
                "failed to read the lyrics overlay WM_PROTOCOLS property".into(),
            );
        }
        if data.is_null() {
            return Ok(());
        }
        if actual_type != x11::xlib::XA_ATOM || actual_format != 32 {
            unsafe {
                x11::xlib::XFree(data.cast());
            }
            return Err(
                "the lyrics overlay WM_PROTOCOLS property has an unexpected format".into(),
            );
        }
        if bytes_after != 0 {
            unsafe {
                x11::xlib::XFree(data.cast());
            }
            return Err(
                "the lyrics overlay WM_PROTOCOLS property is unexpectedly long".into(),
            );
        }

        let protocols =
            unsafe { slice::from_raw_parts(data.cast::<c_ulong>(), items as usize) };
        let filtered = filter_window_protocols(protocols, take_focus_atom);
        let changed = filtered.len() != protocols.len();
        if changed {
            unsafe {
                x11::xlib::XChangeProperty(
                    display,
                    window_id,
                    protocols_atom,
                    x11::xlib::XA_ATOM,
                    32,
                    x11::xlib::PropModeReplace,
                    filtered.as_ptr().cast::<c_uchar>(),
                    filtered.len() as c_int,
                );
                x11::xlib::XFlush(display);
            }
        }

        if !data.is_null() {
            unsafe {
                x11::xlib::XFree(data.cast());
            }
        }
        Ok(())
    })();

    unsafe {
        x11::xlib::XCloseDisplay(display);
    }
    result
}

#[cfg(target_os = "linux")]
fn filter_window_protocols(
    protocols: &[c_ulong],
    take_focus_atom: c_ulong,
) -> Vec<c_ulong> {
    protocols
        .iter()
        .copied()
        .filter(|protocol| *protocol != take_focus_atom)
        .collect()
}

#[cfg(not(target_os = "linux"))]
fn remove_wm_take_focus(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
}

fn enforce_non_activating_window(window: &WebviewWindow) -> Result<(), String> {
    window
        .set_focusable(false)
        .map_err(|error| format!("failed to keep lyrics overlay unfocusable: {error}"))?;
    remove_wm_take_focus(window)
}

fn apply_topmost_to_webview(window: &WebviewWindow) -> Result<(), String> {
    enforce_non_activating_window(window)?;
    window
        .set_always_on_top(true)
        .map_err(|error| format!("failed to keep lyrics overlay on top: {error}"))?;
    window
        .set_visible_on_all_workspaces(true)
        .map_err(|error| {
            format!(
                "failed to keep lyrics overlay on all workspaces: {error}"
            )
        })
}

/// Reassert the X11/EWMH compositor hints without focusing or raising the
/// window through an activation request.
pub fn reassert_topmost(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        if let Err(error) = apply_topmost_to_webview(&window) {
            eprintln!("crtube: {error}");
        }
    }
}

/// Reapply the X11/EWMH hints after lifecycle events. The primary backend is
/// selected in `main.rs`; native Wayland cannot provide this client-side state.
pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != WINDOW_LABEL {
        return;
    }

    match event {
        WindowEvent::Focused(false) => {
            reassert_topmost(window.app_handle());
            let app = window.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(80)).await;
                reassert_topmost(&app);
            });
        }
        WindowEvent::Moved(_)
        | WindowEvent::Resized(_)
        | WindowEvent::ScaleFactorChanged { .. } => {
            reassert_topmost(window.app_handle());
        }
        _ => {}
    }
}

fn open_overlay_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        // Enforce the protocol before/after mapping so a recreated/sticky
        // window is never a workspace focus candidate.
        enforce_non_activating_window(&window)?;
        window.show().map_err(|e| e.to_string())?;
        apply_topmost_to_webview(&window)?;
        return Ok(());
    }

    let prefs = lyrics_overlay::load_prefs(app);
    let window = WebviewWindowBuilder::new(app, WINDOW_LABEL, overlay_url(app))
        .title("CRTube Lyrics")
        .inner_size(420.0, 220.0)
        .min_inner_size(360.0, 190.0)
        .max_inner_size(520.0, 320.0)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .background_color(Color(7, 9, 12, 0))
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .focused(false)
        .focusable(false)
        .build()
        .map_err(|e| e.to_string())?;
    place_initial_window(app, &window, &prefs)?;
    // Apply this before mapping when the native handle is already available;
    // Tauri's hidden-window handle can be unavailable, so the post-map pass
    // below is the authoritative enforcement point.
    enforce_non_activating_window(&window)?;
    window.show().map_err(|e| e.to_string())?;
    apply_topmost_to_webview(&window)?;
    Ok(())
}

pub fn close_existing(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.close();
    }
}

pub fn open_if_enabled(app: &AppHandle) {
    if !lyrics_overlay::load_prefs(app).enabled {
        return;
    }
    if let Err(error) = open_overlay_window(app) {
        eprintln!("crtube: failed to restore lyrics overlay: {error}");
    }
}

#[tauri::command]
pub fn get_lyrics_overlay_prefs(app: AppHandle) -> Result<LyricsOverlayPrefs, String> {
    Ok(lyrics_overlay::load_prefs(&app))
}

/// Bring the primary application window forward without closing the lyrics
/// overlay. The overlay remains available for its always-on-top workflow.
#[tauri::command]
pub fn focus_main_window(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_lyrics_overlay_enabled(
    app: AppHandle,
    enabled: bool,
) -> Result<LyricsOverlayPrefs, String> {
    let mut prefs = lyrics_overlay::load_prefs(&app);
    if enabled {
        open_overlay_window(&app)?;
        prefs.enabled = true;
    } else {
        close_existing(&app);
        prefs.enabled = false;
    }
    lyrics_overlay::save_prefs(&app, &prefs)?;
    Ok(prefs)
}

#[tauri::command]
pub fn snap_lyrics_overlay(app: AppHandle) -> Result<OverlayPosition, String> {
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "lyrics overlay is not open".to_string())?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "no monitor available".to_string())?;
    let snapped = lyrics_overlay::snap_position(
        (position.x, position.y),
        (size.width, size.height),
        monitor_work_area(&monitor),
    );
    window
        .set_position(PhysicalPosition::new(snapped.0, snapped.1))
        .map_err(|e| e.to_string())?;

    let mut prefs = lyrics_overlay::load_prefs(&app);
    prefs.x = Some(snapped.0);
    prefs.y = Some(snapped.1);
    lyrics_overlay::save_prefs(&app, &prefs)?;
    Ok(OverlayPosition {
        x: snapped.0,
        y: snapped.1,
    })
}

#[tauri::command]
pub fn lyrics_overlay_snapshot(
    db: State<'_, Arc<Db>>,
    mpris: State<'_, Mpris>,
) -> Result<Option<LyricsOverlaySnapshot>, String> {
    let Some(playback) = mpris.overlay_snapshot()? else {
        return Ok(None);
    };
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let entry = db::get_entry(&conn, playback.track_id).ok();
    Ok(entry.map(|entry| LyricsOverlaySnapshot {
        entry,
        sequence: playback.sequence,
        position_s: playback.position_s,
        playing: playback.playing,
        speed: playback.speed,
        volume: playback.volume,
        muted: playback.muted,
        can_next: playback.can_next,
        can_previous: playback.can_previous,
        shuffle: playback.shuffle,
        repeat: playback.repeat,
        lyrics_revision: lyrics::revision(),
    }))
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::filter_window_protocols;

    #[test]
    fn removes_only_wm_take_focus_from_protocols() {
        let protocols = [10, 20, 30, 20];
        assert_eq!(filter_window_protocols(&protocols, 20), [10, 30]);
    }

    #[test]
    fn leaves_protocols_unchanged_without_take_focus() {
        let protocols = [10, 20, 30];
        assert_eq!(filter_window_protocols(&protocols, 40), protocols);
    }
}
