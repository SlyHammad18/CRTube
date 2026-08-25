use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::Serialize;

pub struct Db(pub Mutex<Connection>);

const MIGRATIONS: &[&str] = &[
    // v1 — §5.5 downloads table
    "CREATE TABLE IF NOT EXISTS downloads (
        id INTEGER PRIMARY KEY,
        video_id TEXT UNIQUE,
        url TEXT,
        title TEXT,
        channel TEXT,
        duration_s INTEGER,
        kind TEXT,
        quality TEXT,
        container TEXT,
        path TEXT,
        size_bytes INTEGER,
        thumb_url TEXT,
        status TEXT,
        created_at INTEGER
    );",
];

pub fn open(path: &Path) -> Result<Connection, rusqlite::Error> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> Result<(), rusqlite::Error> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate() {
        let step = i as i64 + 1;
        if version < step {
            conn.execute_batch(sql)?;
            conn.pragma_update(None, "user_version", step)?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub id: i64,
    pub video_id: String,
    pub url: Option<String>,
    pub title: String,
    pub channel: Option<String>,
    pub duration_s: Option<u64>,
    pub kind: String,
    pub quality: Option<String>,
    pub container: String,
    pub path: String,
    pub size_bytes: Option<u64>,
    pub thumb_url: Option<String>,
    pub status: String,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub struct DownloadRecord {
    pub video_id: String,
    pub url: String,
    pub title: String,
    pub channel: Option<String>,
    pub duration_s: Option<u64>,
    pub kind: String,
    pub quality: Option<String>,
    pub container: String,
    pub path: String,
    pub size_bytes: Option<u64>,
    pub thumb_url: Option<String>,
}

pub fn insert_download(conn: &Connection, rec: &DownloadRecord) -> Result<i64, rusqlite::Error> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT OR IGNORE INTO downloads
            (video_id, url, title, channel, duration_s, kind, quality, container,
             path, size_bytes, thumb_url, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'done', ?12)",
        params![
            rec.video_id,
            rec.url,
            rec.title,
            rec.channel,
            rec.duration_s,
            rec.kind,
            rec.quality,
            rec.container,
            rec.path,
            rec.size_bytes,
            rec.thumb_url,
            now,
        ],
    )?;
    if conn.changes() == 0 {
        return conn.query_row(
            "SELECT id FROM downloads WHERE video_id = ?1",
            params![rec.video_id],
            |r| r.get(0),
        );
    }
    Ok(conn.last_insert_rowid())
}

pub fn has_download(conn: &Connection, video_id: &str) -> Result<bool, rusqlite::Error> {
    let found: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM downloads WHERE video_id = ?1)",
        params![video_id],
        |r| r.get(0),
    )?;
    Ok(found)
}

fn row_to_entry(r: &rusqlite::Row) -> Result<LibraryEntry, rusqlite::Error> {
    Ok(LibraryEntry {
        id: r.get("id")?,
        video_id: r.get("video_id")?,
        url: r.get("url")?,
        title: r.get("title")?,
        channel: r.get("channel")?,
        duration_s: r.get::<_, Option<i64>>("duration_s")?.map(|v| v as u64),
        kind: r.get("kind")?,
        quality: r.get("quality")?,
        container: r.get::<_, Option<String>>("container")?.unwrap_or_default(),
        path: r.get::<_, Option<String>>("path")?.unwrap_or_default(),
        size_bytes: r.get::<_, Option<i64>>("size_bytes")?.map(|v| v as u64),
        thumb_url: r.get("thumb_url")?,
        status: r.get("status")?,
        created_at: r.get("created_at")?,
    })
}

pub fn list_and_sync_statuses(conn: &Connection) -> Result<Vec<LibraryEntry>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT * FROM downloads ORDER BY created_at DESC, id DESC")?;
    let mut entries: Vec<LibraryEntry> =
        stmt.query_map([], row_to_entry)?.collect::<Result<_, _>>()?;

    for entry in &mut entries {
        if entry.path.is_empty() {
            continue;
        }
        let exists = std::path::Path::new(&entry.path).exists();
        if entry.status == "done" && !exists {
            entry.status = "missing".to_string();
            let _ = conn.execute(
                "UPDATE downloads SET status = 'missing' WHERE id = ?1",
                params![entry.id],
            );
        } else if entry.status == "missing" && exists {
            entry.status = "done".to_string();
            let _ = conn.execute(
                "UPDATE downloads SET status = 'done' WHERE id = ?1",
                params![entry.id],
            );
        }
    }
    Ok(entries)
}

pub fn delete_download(conn: &Connection, id: i64) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    fn rec(video_id: &str, path: &str) -> DownloadRecord {
        DownloadRecord {
            video_id: video_id.to_string(),
            url: format!("https://youtu.be/{video_id}"),
            title: format!("Title {video_id}"),
            channel: Some("Ch".into()),
            duration_s: Some(19),
            kind: "video".into(),
            quality: Some("720p".into()),
            container: "mp4".into(),
            path: path.to_string(),
            size_bytes: Some(1024),
            thumb_url: None,
        }
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = mem();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
    }

    #[test]
    fn duplicate_video_ids_are_detected_not_duplicated() {
        let conn = mem();
        let a = insert_download(&conn, &rec("abc12345678", "/tmp/a.mp4")).unwrap();
        let b = insert_download(&conn, &rec("abc12345678", "/tmp/a.mp4")).unwrap();
        assert_eq!(a, b);
        assert!(has_download(&conn, "abc12345678").unwrap());
        assert!(!has_download(&conn, "zzz99999zzz").unwrap());

        let entries = list_and_sync_statuses(&conn).unwrap();
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn status_flips_missing_and_back() {
        let dir = std::env::temp_dir().join(format!("crtube-db-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("v.mp4");
        std::fs::write(&file, b"x").unwrap();

        let conn = mem();
        insert_download(&conn, &rec("abc12345678", file.to_string_lossy().as_ref())).unwrap();

        assert_eq!(list_and_sync_statuses(&conn).unwrap()[0].status, "done");
        std::fs::remove_file(&file).unwrap();
        assert_eq!(
            list_and_sync_statuses(&conn).unwrap()[0].status,
            "missing"
        );
        std::fs::write(&file, b"x").unwrap();
        assert_eq!(list_and_sync_statuses(&conn).unwrap()[0].status, "done");

        let id = insert_download(&conn, &rec("abc12345678", file.to_string_lossy().as_ref())).unwrap();
        delete_download(&conn, id).unwrap();
        assert!(!has_download(&conn, "abc12345678").unwrap());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
