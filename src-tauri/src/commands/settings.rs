use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use std::path::PathBuf;

pub const DEFAULT_CONCURRENT: u32 = 3;
/// §4.8 — playback speed menu spans 0.5×–2×; clamp wider inputs into a safe range.
pub const SPEED_MIN: f32 = 0.25;
pub const SPEED_MAX: f32 = 4.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub download_dir: String,
    pub concurrent: u32,
    pub autoupdate_ytdlp: bool,
    pub hardware_accel: bool,
    /// Re-encode video downloads to H.264/AAC at download time so they play
    /// natively in WebKitGTK (which can't decode AV1/VP9). ON by default —
    /// new downloads are stored as H.264/MP4 and need no playback-time transcode.
    pub transcode_on_download: bool,
    /// Browser to pull cookies from for yt-dlp (e.g. "chrome", "firefox",
    /// "edge"). Empty by default. Needed when YouTube bot-walls extraction or
    /// for age/restricted videos. Requires that browser to be installed and
    /// logged into YouTube. Needs the `secretstorage` Python module on Linux.
    pub youtube_cookies: String,
    /// Path to a Netscape-format `cookies.txt` exported from a browser. Read
    /// directly by yt-dlp (no browser keyring / `secretstorage` needed), so it
    /// is the most reliable way to supply YouTube authentication. Empty by default.
    pub youtube_cookies_file: String,
    pub filename_template: Option<String>,
    pub player_volume: f32,
    pub player_speed: f32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            download_dir: String::new(),
            concurrent: DEFAULT_CONCURRENT,
            autoupdate_ytdlp: true,
            hardware_accel: true,
            transcode_on_download: true,
            youtube_cookies: String::new(),
            youtube_cookies_file: String::new(),
            filename_template: None,
            player_volume: 1.0,
            player_speed: 1.0,
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
