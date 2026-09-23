use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub const WINDOW_LABEL: &str = "lyrics-overlay";

const SNAP_THRESHOLD: i32 = 24;
const EDGE_GAP: i32 = 12;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct LyricsOverlayPrefs {
    pub enabled: bool,
    pub x: Option<i32>,
    pub y: Option<i32>,
}

pub fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?;
    Ok(dir.join("lyrics-overlay.json"))
}

pub fn load_from(path: &Path) -> LyricsOverlayPrefs {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|body| serde_json::from_str(&body).ok())
        .unwrap_or_default()
}

pub fn save_to(path: &Path, prefs: &LyricsOverlayPrefs) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    if let Err(error) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(error.to_string());
    }
    Ok(())
}

pub fn load_prefs(app: &AppHandle) -> LyricsOverlayPrefs {
    prefs_path(app)
        .map(|path| load_from(&path))
        .unwrap_or_default()
}

pub fn save_prefs(app: &AppHandle, prefs: &LyricsOverlayPrefs) -> Result<(), String> {
    save_to(&prefs_path(app)?, prefs)
}

/// Magnetic one-axis snapping. The current coordinate is preserved unless the
/// window is near the left, center, or right boundary of the monitor work area.
fn snap_axis(current: i32, min: i32, max: i32, length: i32) -> i32 {
    if max <= min || length <= 0 {
        return current;
    }
    let left_gap = current - min;
    let right_gap = max - (current + length);
    if left_gap <= SNAP_THRESHOLD {
        return min + EDGE_GAP;
    }
    if right_gap <= SNAP_THRESHOLD {
        return (max - length - EDGE_GAP).max(min);
    }
    let center = min + (max - min - length) / 2;
    if (current - center).abs() <= SNAP_THRESHOLD {
        center
    } else {
        current
    }
}

/// Pure magnetic snap for all nine anchors: four corners, four edge centers,
/// and the monitor center. Each axis is independent, allowing free floating
/// along the other axis.
pub fn snap_position(
    current: (i32, i32),
    size: (u32, u32),
    work_area: (i32, i32, u32, u32),
) -> (i32, i32) {
    let (work_x, work_y, work_width, work_height) = work_area;
    let x = snap_axis(
        current.0,
        work_x,
        work_x.saturating_add(work_width as i32),
        size.0 as i32,
    );
    let y = snap_axis(
        current.1,
        work_y,
        work_y.saturating_add(work_height as i32),
        size.1 as i32,
    );
    (x, y)
}

/// Whether a restored window still overlaps a monitor's usable work area.
pub fn position_is_visible(
    position: (i32, i32),
    size: (u32, u32),
    work_areas: &[(i32, i32, u32, u32)],
) -> bool {
    const MIN_VISIBLE: i32 = 48;
    let (x, y) = position;
    let (width, height) = (size.0 as i32, size.1 as i32);
    work_areas.iter().any(|&(wx, wy, ww, wh)| {
        let right = wx.saturating_add(ww as i32);
        let bottom = wy.saturating_add(wh as i32);
        x < right.saturating_sub(MIN_VISIBLE)
            && x.saturating_add(width) > wx.saturating_add(MIN_VISIBLE)
            && y < bottom.saturating_sub(MIN_VISIBLE)
            && y.saturating_add(height) > wy.saturating_add(MIN_VISIBLE)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "crtube-lyrics-overlay-{tag}-{}.json",
            std::process::id()
        ))
    }

    #[test]
    fn prefs_round_trip_and_default_disabled() {
        let path = temp_path("prefs");
        let _ = std::fs::remove_file(&path);
        assert!(!load_from(&path).enabled);

        let prefs = LyricsOverlayPrefs {
            enabled: true,
            x: Some(120),
            y: Some(-40),
        };
        save_to(&path, &prefs).unwrap();
        let loaded = load_from(&path);
        assert!(loaded.enabled);
        assert_eq!(loaded.x, Some(120));
        assert_eq!(loaded.y, Some(-40));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn snapping_covers_corners_centers_and_free_float() {
        let size = (400, 220);
        let work = (0, 0, 1920, 1040);
        assert_eq!(snap_position((5, 7), size, work), (12, 12));
        assert_eq!(snap_position((1910, 7), size, work), (1508, 12));
        assert_eq!(snap_position((5, 1000), size, work), (12, 808));
        assert_eq!(snap_position((760, 410), size, work), (760, 410));
        assert_eq!(snap_position((755, 7), size, work), (760, 12));
        assert_eq!(snap_position((500, 405), size, work), (500, 410));
        assert_eq!(snap_position((400, 300), size, work), (400, 300));
    }

    #[test]
    fn restored_position_requires_a_visible_monitor_intersection() {
        let size = (400, 220);
        assert!(position_is_visible((100, 100), size, &[(0, 0, 1920, 1040)]));
        assert!(!position_is_visible((4000, 100), size, &[(0, 0, 1920, 1040)]));
        assert!(position_is_visible((-1500, 100), size, &[(-1920, 0, 1920, 1040)]));
    }
}
