use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use std::path::PathBuf;

pub const DEFAULT_CONCURRENT: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub download_dir: String,
    pub concurrent: u32,
    pub autoupdate_ytdlp: bool,
    pub filename_template: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            download_dir: String::new(),
            concurrent: DEFAULT_CONCURRENT,
            autoupdate_ytdlp: true,
            filename_template: None,
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

fn sanitize(mut s: AppSettings) -> AppSettings {
    s.download_dir = s.download_dir.trim().to_string();
    s.concurrent = s.concurrent.clamp(1, 5);
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
