use serde_json::Value;
use tauri::{AppHandle, Manager};

/// Path to the resume-session file (`{app_data}/session.json`). Kept separate
/// from settings.json so throttled playback snapshots never re-run the
/// `set_settings` side effects (asset-scope / media-root rewiring).
fn session_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("session.json"))
}

/// Pure: read a session from `path`. Missing/corrupt/non-object JSON all yield
/// `None` so a bad file can never crash or blank the player on startup.
pub fn load_from(path: &std::path::Path) -> Option<Value> {
    let value: Value = std::fs::read_to_string(path).ok()?.parse().ok()?;
    if value.is_object() {
        Some(value)
    } else {
        None
    }
}

/// Pure: write a session JSON object to `path` atomically (temp-write →
/// rename), mirroring the settings save path so a crash mid-write cannot
/// corrupt the live file. Non-object payloads are rejected.
pub fn save_to(path: &std::path::Path, value: &Value) -> Result<(), String> {
    if !value.is_object() {
        return Err("session must be a JSON object".to_string());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, value.to_string()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_session(app: &AppHandle) -> Option<Value> {
    let path = session_path(app).ok()?;
    load_from(&path)
}

pub fn save_session(app: &AppHandle, value: &Value) -> Result<(), String> {
    let path = session_path(app)?;
    save_to(&path, value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_path(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "crtube-session-{tag}-{}.json",
            std::process::id()
        ))
    }

    #[test]
    fn missing_file_loads_none() {
        let p = temp_path("missing");
        let _ = std::fs::remove_file(&p);
        assert!(load_from(&p).is_none());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn roundtrip_keeps_session_shape() {
        let p = temp_path("round");
        let _ = std::fs::remove_file(&p);
        let value = json!({
            "version": 1,
            "queue": [{"id": 7, "title": "t"}],
            "order": [0],
            "pos": 0,
            "currentTimeS": 12.5,
            "repeat": "all",
            "shuffle": true,
            "context": {"type": "playlist", "id": 2}
        });
        save_to(&p, &value).unwrap();
        let loaded = load_from(&p).unwrap();
        assert_eq!(loaded["version"], 1);
        assert_eq!(loaded["queue"][0]["id"], 7);
        assert_eq!(loaded["currentTimeS"], 12.5);
        assert_eq!(loaded["repeat"], "all");
        assert!(loaded["shuffle"].as_bool().unwrap());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn corrupt_and_non_object_load_none() {
        let p = temp_path("corrupt");
        let _ = std::fs::remove_file(&p);
        std::fs::write(&p, "{ not json").unwrap();
        assert!(load_from(&p).is_none());

        std::fs::write(&p, "[1,2,3]").unwrap();
        assert!(load_from(&p).is_none());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn save_rejects_non_object() {
        let p = temp_path("array");
        let _ = std::fs::remove_file(&p);
        assert!(save_to(&p, &json!([1, 2, 3])).is_err());
        assert!(!p.exists());
        let _ = std::fs::remove_file(&p);
    }
}