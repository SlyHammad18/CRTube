use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use std::path::PathBuf;

pub const DEFAULT_CONCURRENT: u32 = 3;
/// §4.8 — playback speed menu spans 0.5×–2×; clamp wider inputs into a safe range.
pub const SPEED_MIN: f32 = 0.25;
pub const SPEED_MAX: f32 = 4.0;

/// Urdu lyrics font choices (§2.2): "naskh" (bundled default) or "custom" —
/// a font file the user picked themselves (see `urdu_custom_file` /
/// `pick_urdu_font`).
pub const URDU_FONTS: [&str; 2] = ["naskh", "custom"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub download_dir: String,
    pub concurrent: u32,
    pub autoupdate_ytdlp: bool,
    /// Browser to pull cookies from for yt-dlp (e.g. "chrome", "firefox",
    /// "edge"). Empty by default. Needed when YouTube bot-walls extraction or
    /// for age/restricted videos. Requires that browser to be installed and
    /// logged into YouTube. Needs the `secretstorage` Python module on Linux.
    pub youtube_cookies: String,
    /// Path to a Netscape-format `cookies.txt` exported from a browser. Read
    /// directly by yt-dlp (no browser keyring / `secretstorage` needed), so it
    /// is the most reliable way to supply YouTube authentication. Empty by default.
    pub youtube_cookies_file: String,
    /// When true, video tracks play audio-only (picture hidden, cached thumbnail
    /// shown). Auto-applied per track; can still be toggled per-track from the
    /// player. Set from Settings → Playback.
    pub disable_video_playback: bool,
    pub filename_template: Option<String>,
    pub player_volume: f32,
    pub player_speed: f32,
    /// Urdu lyrics font: "naskh" (bundled default) or "custom" (a font file
    /// the user picked — see `urdu_custom_file`).
    pub urdu_font: String,
    /// Cached font file in `{app_data}/fonts/` backing `urdu_font: "custom"`.
    pub urdu_custom_file: Option<String>,
    /// Caption Deck font size (px) for Latin lyric lines.
    pub lyrics_size_latin: u32,
    /// Caption Deck font size (px) for Urdu lyric lines (active line ×4⁄3).
    pub lyrics_size_urdu: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            download_dir: String::new(),
            concurrent: DEFAULT_CONCURRENT,
            autoupdate_ytdlp: true,
            youtube_cookies: String::new(),
            youtube_cookies_file: String::new(),
            disable_video_playback: false,
            filename_template: None,
            player_volume: 1.0,
            player_speed: 1.0,
            urdu_font: "naskh".to_string(),
            urdu_custom_file: None,
            lyrics_size_latin: 15,
            lyrics_size_urdu: 18,
        }
    }
}

impl AppSettings {
    pub fn effective_download_dir(&self) -> PathBuf {
        if self.download_dir.trim().is_empty() {
            default_download_dir().unwrap_or_else(|_| PathBuf::from("."))
        } else {
            PathBuf::from(self.download_dir.trim())
        }
    }
}

pub fn default_download_dir() -> Result<PathBuf, String> {
    let home_key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    let home = std::env::var(home_key).map_err(|_| "cannot resolve home directory".to_string())?;
    Ok(PathBuf::from(home).join("Downloads").join("CRTube"))
}

pub fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

pub fn load_from(path: &std::path::Path) -> AppSettings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_to(path: &std::path::Path, settings: &AppSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_settings(app: &AppHandle) -> AppSettings {
    settings_path(app).map(|p| load_from(&p)).unwrap_or_default()
}

/// Widen the runtime asset-protocol scope to the effective download dir (§5.6)
/// so downloaded media is playable by the webview. Idempotent; safe to call on
/// every startup and every `set_settings`.
pub fn allow_media_scope(app: &AppHandle, settings: &AppSettings) {
    let dir = settings.effective_download_dir();
    let _ = std::fs::create_dir_all(&dir);
    if let Err(e) = app.asset_protocol_scope().allow_directory(&dir, true) {
        log_scope_error(&e.to_string());
    }
}

fn log_scope_error(msg: &str) {
    eprintln!("crtube: asset scope allow failed: {msg}");
}

fn sanitize(mut s: AppSettings) -> AppSettings {
    s.download_dir = s.download_dir.trim().to_string();
    s.concurrent = s.concurrent.clamp(1, 5);
    s.player_volume = s.player_volume.clamp(0.0, 1.0);
    if !URDU_FONTS.contains(&s.urdu_font.as_str()) {
        s.urdu_font = "naskh".to_string();
    }
    s.lyrics_size_latin = s.lyrics_size_latin.clamp(12, 32);
    s.lyrics_size_urdu = s.lyrics_size_urdu.clamp(14, 40);
    if !s.player_speed.is_finite() || s.player_speed < SPEED_MIN {
        s.player_speed = SPEED_MIN;
    } else if s.player_speed > SPEED_MAX {
        s.player_speed = SPEED_MAX;
    }
    if let Some(t) = &s.filename_template {
        if t.trim().is_empty() {
            s.filename_template = None;
        }
    }
    s
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Result<AppSettings, String> {
    let mut s = load_settings(&app);
    if s.download_dir.is_empty() {
        s.download_dir = default_download_dir()?.to_string_lossy().to_string();
    }
    Ok(s)
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: AppSettings) -> Result<AppSettings, String> {
    let mut s = sanitize(settings);
    if s.download_dir.is_empty() {
        s.download_dir = default_download_dir()?.to_string_lossy().to_string();
    }
    save_to(&settings_path(&app)?, &s)?;
    allow_media_scope(&app, &s);
    // Keep the media streamer's allowed roots in sync with the new dir.
    if let Some(server) = app.try_state::<crate::services::media::MediaServer>() {
        let roots = vec![s.effective_download_dir()];
        tauri::async_runtime::block_on(server.set_roots(roots));
    }
    Ok(s)
}

/// Cached metadata for a user-picked Urdu font file.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedUrduFont {
    /// File name inside `{app_data}/fonts/` (persisted in settings).
    pub file: String,
    /// Original file stem, for display.
    pub label: String,
}

/// Native file dialog → copy the picked font into the app-owned fonts cache.
/// One custom slot: older `custom-*` files are swept so the webview always
/// gets a fresh URL (and never loads a stale cached face).
#[tauri::command]
pub async fn pick_urdu_font(app: AppHandle) -> Result<PickedUrduFont, String> {
    use crate::services::fonts::{file_is_font, fonts_dir};

    let picker_app = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        picker_app
            .dialog()
            .file()
            .add_filter("Fonts", &["ttf", "otf", "woff", "woff2"])
            .blocking_pick_file()
            .and_then(|p| p.into_path().ok())
    })
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "no font selected".to_string())?;

    if !file_is_font(&picked) {
        return Err("that file is not a supported font (ttf / otf / woff / woff2)".into());
    }

    let dir = fonts_dir(&app)?;
    let ext = picked
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_else(|| "ttf".to_string());
    if !matches!(ext.as_str(), "ttf" | "otf" | "woff" | "woff2") {
        return Err("unsupported font format — use ttf, otf, woff or woff2".into());
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let file = format!("custom-{stamp}.{ext}");
    std::fs::copy(&picked, dir.join(&file)).map_err(|e| format!("copy failed: {e}"))?;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("custom-") && name != file {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
    let label = picked
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Custom")
        .to_string();
    Ok(PickedUrduFont { file, label })
}

/// Loopback URL for the persisted custom Urdu font (for the runtime FontFace).
#[tauri::command]
pub fn urdu_custom_font_url(
    app: AppHandle,
    server: State<'_, crate::services::media::MediaServer>,
) -> Result<String, String> {
    use crate::services::fonts::fonts_dir;

    let s = load_settings(&app);
    let file = s
        .urdu_custom_file
        .ok_or_else(|| "no custom Urdu font is set".to_string())?;
    if !crate::services::media::is_font_name(&file) {
        return Err("invalid custom font name".into());
    }
    let dir = fonts_dir(&app)?;
    if !dir.join(&file).is_file() {
        return Err("the custom font file is missing — pick it again".into());
    }
    Ok(server.font_url_for(&file))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "crtube-settings-{tag}-{}.json",
            std::process::id()
        ))
    }

    #[test]
    fn defaults_when_file_missing() {
        let p = temp_path("missing");
        let _ = std::fs::remove_file(&p);
        let s = load_from(&p);
        assert_eq!(s.concurrent, DEFAULT_CONCURRENT);
        assert!(s.autoupdate_ytdlp);
        assert!(s.filename_template.is_none());
        assert_eq!(s.download_dir, "");
        // v0.2 player fields default to unity.
        assert_eq!(s.player_volume, 1.0);
        assert_eq!(s.player_speed, 1.0);
        assert_eq!(s.urdu_font, "naskh");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn pre_v02_file_without_player_fields_loads_with_defaults() {
        let p = temp_path("legacy");
        let _ = std::fs::remove_file(&p);
        std::fs::write(&p, r#"{"download_dir":"/tmp/x","concurrent":2,"autoupdate_ytdlp":true}"#)
            .unwrap();
        let s = load_from(&p);
        assert_eq!(s.player_volume, 1.0);
        assert_eq!(s.player_speed, 1.0);
        assert_eq!(s.concurrent, 2);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn roundtrip_uses_snake_keys_per_spec() {
        let p = temp_path("round");
        let _ = std::fs::remove_file(&p);
        let s = AppSettings {
            download_dir: "/tmp/crtube-dl".into(),
            concurrent: 5,
            autoupdate_ytdlp: false,
            filename_template: Some("{id} - {title}.{ext}".into()),
            ..Default::default()
        };
        save_to(&p, &s).unwrap();
        let loaded = load_from(&p);
        assert_eq!(loaded.download_dir, "/tmp/crtube-dl");
        assert_eq!(loaded.concurrent, 5);
        assert!(!loaded.autoupdate_ytdlp);
        assert_eq!(
            loaded.filename_template.as_deref(),
            Some("{id} - {title}.{ext}")
        );

        let raw = std::fs::read_to_string(&p).unwrap();
        assert!(raw.contains("\"download_dir\""));
        assert!(raw.contains("\"autoupdate_ytdlp\""));
        assert!(raw.contains("\"filename_template\""));
        assert!(raw.contains("\"player_volume\""));
        assert!(raw.contains("\"player_speed\""));
        assert!(!raw.contains("\"downloadDir\""));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn sanitize_clamps_concurrency_and_trims_dir() {
        let s = sanitize(AppSettings {
            concurrent: 99,
            download_dir: "  /tmp/x  ".into(),
            ..Default::default()
        });
        assert_eq!(s.concurrent, 5);
        assert_eq!(s.download_dir, "/tmp/x");

        let s = sanitize(AppSettings {
            concurrent: 0,
            ..Default::default()
        });
        assert_eq!(s.concurrent, 1);

        let s = sanitize(AppSettings {
            filename_template: Some("   ".into()),
            ..Default::default()
        });
        assert!(s.filename_template.is_none());
    }

    #[test]
    fn sanitize_clamps_player_volume_and_speed() {
        let s = sanitize(AppSettings {
            player_volume: 1.7,
            player_speed: 12.0,
            ..Default::default()
        });
        assert_eq!(s.player_volume, 1.0);
        assert_eq!(s.player_speed, SPEED_MAX);

        let s = sanitize(AppSettings {
            player_volume: -3.0,
            player_speed: 0.0,
            ..Default::default()
        });
        assert_eq!(s.player_volume, 0.0);
        assert_eq!(s.player_speed, SPEED_MIN);

        let s = sanitize(AppSettings {
            player_speed: f32::NAN,
            ..Default::default()
        });
        assert_eq!(s.player_speed, SPEED_MIN);

        // In-range values pass through untouched.
        let s = sanitize(AppSettings {
            player_volume: 0.35,
            player_speed: 1.5,
            ..Default::default()
        });
        assert_eq!(s.player_volume, 0.35);
        assert_eq!(s.player_speed, 1.5);
    }

    #[test]
    fn sanitize_rejects_unknown_urdu_font() {
        let s = sanitize(AppSettings {
            urdu_font: "comic-sans".into(),
            ..Default::default()
        });
        assert_eq!(s.urdu_font, "naskh");
        let s = sanitize(AppSettings {
            urdu_font: "custom".into(),
            ..Default::default()
        });
        assert_eq!(s.urdu_font, "custom");
    }

    #[test]
    fn sanitize_clamps_lyrics_sizes() {
        let s = sanitize(AppSettings {
            lyrics_size_latin: 5,
            lyrics_size_urdu: 99,
            ..Default::default()
        });
        assert_eq!(s.lyrics_size_latin, 12);
        assert_eq!(s.lyrics_size_urdu, 40);
        let s = sanitize(AppSettings {
            lyrics_size_latin: 20,
            lyrics_size_urdu: 24,
            ..Default::default()
        });
        assert_eq!(s.lyrics_size_latin, 20);
        assert_eq!(s.lyrics_size_urdu, 24);
    }

    #[test]
    fn effective_download_dir_falls_back_to_default() {
        let s = AppSettings::default();
        assert!(s.effective_download_dir().ends_with("Downloads/CRTube"));
        let s = AppSettings {
            download_dir: "/custom/dir".into(),
            ..Default::default()
        };
        assert_eq!(s.effective_download_dir(), PathBuf::from("/custom/dir"));
    }
}
