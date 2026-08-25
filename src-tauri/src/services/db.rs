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
    // v2 — §5.5 player: playlists + ordered items
    "CREATE TABLE IF NOT EXISTS playlists (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playlist_items (
        id INTEGER PRIMARY KEY,
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        download_id INTEGER NOT NULL REFERENCES downloads(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        added_at INTEGER NOT NULL,
        UNIQUE(playlist_id, download_id)
    );",
];

pub fn open(path: &Path) -> Result<Connection, rusqlite::Error> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub track_count: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistTrack {
    pub item_id: i64,
    pub position: i64,
    pub added_at: i64,
    #[serde(flatten)]
    pub entry: LibraryEntry,
}

pub fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn row_to_playlist(r: &rusqlite::Row) -> Result<Playlist, rusqlite::Error> {
    Ok(Playlist {
        id: r.get("id")?,
        name: r.get("name")?,
        track_count: r.get("track_count")?,
        created_at: r.get("created_at")?,
    })
}

const PLAYLIST_SELECT: &str =
    "SELECT p.id, p.name, p.created_at, COUNT(pi.id) AS track_count
     FROM playlists p LEFT JOIN playlist_items pi ON pi.playlist_id = p.id";

/// Create a playlist; idempotent on name (returns the existing row instead of failing).
pub fn create_playlist(conn: &Connection, name: &str) -> Result<Playlist, rusqlite::Error> {
    let now = now_unix();
    conn.execute(
        "INSERT OR IGNORE INTO playlists (name, created_at) VALUES (?1, ?2)",
        params![name, now],
    )?;
    conn.query_row(
        &format!("{PLAYLIST_SELECT} WHERE p.name = ?1 GROUP BY p.id"),
        params![name],
        row_to_playlist,
    )
}

pub fn rename_playlist(conn: &Connection, id: i64, name: &str) -> Result<(), rusqlite::Error> {
    conn.execute("UPDATE playlists SET name = ?2 WHERE id = ?1", params![id, name])?;
    Ok(())
}

pub fn list_playlists(conn: &Connection) -> Result<Vec<Playlist>, rusqlite::Error> {
    let sql = format!("{PLAYLIST_SELECT} GROUP BY p.id ORDER BY p.created_at DESC, p.id DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_playlist)?;
    rows.collect()
}

pub fn delete_playlist(conn: &Connection, id: i64) -> Result<(), rusqlite::Error> {
    // Items are removed explicitly too: CASCADE only fires with foreign_keys pragma on,
    // and in-memory test connections open without going through open().
    conn.execute("DELETE FROM playlist_items WHERE playlist_id = ?1", params![id])?;
    conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])?;
    Ok(())
}

/// Append a download to a playlist at the end; duplicate adds return the existing row.
pub fn add_playlist_item(
    conn: &Connection,
    playlist_id: i64,
    download_id: i64,
) -> Result<i64, rusqlite::Error> {
    let next: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), 0) + 1 FROM playlist_items WHERE playlist_id = ?1",
        params![playlist_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO playlist_items (playlist_id, download_id, position, added_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![playlist_id, download_id, next, now_unix()],
    )?;
    if conn.changes() == 0 {
        return conn.query_row(
            "SELECT id FROM playlist_items WHERE playlist_id = ?1 AND download_id = ?2",
            params![playlist_id, download_id],
            |r| r.get(0),
        );
    }
    Ok(conn.last_insert_rowid())
}

pub fn remove_playlist_item(conn: &Connection, item_id: i64) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM playlist_items WHERE id = ?1", params![item_id])?;
    Ok(())
}

pub fn list_playlist_items(
    conn: &Connection,
    playlist_id: i64,
) -> Result<Vec<PlaylistTrack>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT pi.id AS item_id, pi.position AS position, pi.added_at AS added_at, d.*
         FROM playlist_items pi JOIN downloads d ON d.id = pi.download_id
         WHERE pi.playlist_id = ?1
         ORDER BY pi.position ASC, pi.id ASC",
    )?;
    let rows = stmt.query_map(params![playlist_id], |r| {
        Ok(PlaylistTrack {
            item_id: r.get("item_id")?,
            position: r.get("position")?,
            added_at: r.get("added_at")?,
            entry: row_to_entry(r)?,
        })
    })?;
    rows.collect()
}

/// Rewrite positions so items play in the given order. IDs belonging to other
/// playlists are ignored; omitted items keep their relative order at the end.
pub fn reorder_playlist_items(
    conn: &Connection,
    playlist_id: i64,
    item_ids: &[i64],
) -> Result<(), rusqlite::Error> {
    let tx = conn.unchecked_transaction()?;
    for (idx, item_id) in item_ids.iter().enumerate() {
        tx.execute(
            "UPDATE playlist_items SET position = ?3
             WHERE id = ?1 AND playlist_id = ?2",
            params![item_id, playlist_id, idx as i64 + 1],
        )?;
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
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

    #[test]
    fn playlists_crud_and_items() {
        let conn = mem();

        let p = create_playlist(&conn, "Focus Mix").unwrap();
        assert_eq!(p.name, "Focus Mix");
        assert_eq!(p.track_count, 0);

        // Idempotent on name — same row comes back.
        let again = create_playlist(&conn, "Focus Mix").unwrap();
        assert_eq!(again.id, p.id);

        let a = insert_download(&conn, &rec("aaa11111111", "/tmp/a.mp3")).unwrap();
        let b = insert_download(&conn, &rec("bbb22222222", "/tmp/b.mp3")).unwrap();

        let item_a = add_playlist_item(&conn, p.id, a).unwrap();
        add_playlist_item(&conn, p.id, b).unwrap();

        // Duplicate add is a no-op returning the existing item id.
        let dup = add_playlist_item(&conn, p.id, a).unwrap();
        assert_eq!(dup, item_a);

        let items = list_playlist_items(&conn, p.id).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].entry.video_id, "aaa11111111");
        assert!(items[0].position < items[1].position);
        assert_eq!(items[0].entry.title, "Title aaa11111111");

        let listed = list_playlists(&conn).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].track_count, 2);

        // Reorder: b first, then a.
        let ids: Vec<i64> = items.iter().rev().map(|i| i.item_id).collect();
        reorder_playlist_items(&conn, p.id, &ids).unwrap();
        let reordered = list_playlist_items(&conn, p.id).unwrap();
        assert_eq!(reordered[0].entry.video_id, "bbb22222222");
        assert_eq!(reordered[1].entry.video_id, "aaa11111111");

        remove_playlist_item(&conn, reordered[0].item_id).unwrap();
        assert_eq!(list_playlist_items(&conn, p.id).unwrap().len(), 1);

        rename_playlist(&conn, p.id, "Deep Focus").unwrap();
        let renamed = list_playlists(&conn).unwrap();
        assert_eq!(renamed[0].name, "Deep Focus");

        delete_playlist(&conn, p.id).unwrap();
        assert!(list_playlists(&conn).unwrap().is_empty());
        assert!(list_playlist_items(&conn, p.id).unwrap().is_empty());
    }

    #[test]
    fn deleting_download_cascades_playlist_items() {
        let conn = mem();
        let p = create_playlist(&conn, "Mix").unwrap();
        let a = insert_download(&conn, &rec("ccc33333333", "/tmp/c.mp3")).unwrap();
        add_playlist_item(&conn, p.id, a).unwrap();
        delete_download(&conn, a).unwrap();
        // Check the raw table — a JOIN would silently hide orphaned rows.
        let orphans: i64 = conn
            .query_row("SELECT COUNT(*) FROM playlist_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(orphans, 0, "FK cascade must remove playlist items");
    }
}
