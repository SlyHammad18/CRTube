use std::io::Read;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// App-owned font cache. Holds the user's picked Urdu font file (copied here
/// by `pick_urdu_font`) and is served to the webview through the loopback
/// server's `fonts` route. Nothing is bundled or auto-downloaded — the user
/// supplies the font file themselves.
pub fn fonts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("fonts");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// True when the 4-byte header is a known font container magic
/// (TTF / OTF / `true` / collection / WOFF2) — rejects user-picked non-font
/// files (a native dialog's extension filter is advisory on Linux).
pub fn has_font_magic(head: &[u8]) -> bool {
    head.starts_with(&[0x00, 0x01, 0x00, 0x00])
        || head.starts_with(b"OTTO")
        || head.starts_with(b"true")
        || head.starts_with(b"ttcf")
        || head.starts_with(b"wOF2")
}

/// Magic-only check for user-picked font files.
pub fn file_is_font(path: &Path) -> bool {
    let mut head = [0u8; 4];
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    file.read_exact(&mut head).is_ok() && has_font_magic(&head)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn font_magic_recognition() {
        assert!(has_font_magic(&[0x00, 0x01, 0x00, 0x00, 0xff]));
        assert!(has_font_magic(b"OTTO"));
        assert!(has_font_magic(b"true"));
        assert!(has_font_magic(b"ttcf"));
        assert!(has_font_magic(b"wOF2"));
        // HTML error pages and anything else are rejected.
        assert!(!has_font_magic(b"<!DOC"));
        assert!(!has_font_magic(b"GIF8"));
        assert!(!has_font_magic(&[]));
    }
}
