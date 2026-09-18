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
    // v3 — favourites flag on library entries
    "ALTER TABLE downloads ADD COLUMN favourite INTEGER NOT NULL DEFAULT 0;",
    // v4 — normalized artists: many-to-many track ↔ artist
    "CREATE TABLE IF NOT EXISTS artists (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL
    );",
    "CREATE TABLE IF NOT EXISTS track_artists (
        id INTEGER PRIMARY KEY,
        track_id INTEGER NOT NULL REFERENCES downloads(id) ON DELETE CASCADE,
        artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        UNIQUE(track_id, artist_id)
    );",
    // Backfill: each existing channel becomes a single artist (position 1).
    "INSERT OR IGNORE INTO artists(name)
        SELECT DISTINCT channel FROM downloads
        WHERE channel IS NOT NULL AND TRIM(channel) <> '';",
    "INSERT OR IGNORE INTO track_artists(track_id, artist_id, position)
        SELECT d.id, a.id, 1
        FROM downloads d
        JOIN artists a ON a.name = d.channel
        WHERE d.channel IS NOT NULL AND TRIM(d.channel) <> '';",
    // v5 — playlist covers (auto 4-up track collage / custom upload).
    "ALTER TABLE playlists ADD COLUMN cover_kind TEXT NOT NULL DEFAULT 'auto';",
    "ALTER TABLE playlists ADD COLUMN cover_path TEXT;",
    "ALTER TABLE playlists ADD COLUMN cover_seed INTEGER NOT NULL DEFAULT 0;",
    "UPDATE playlists SET cover_seed = id WHERE cover_seed = 0;",
];

pub fn open(path: &Path) -> Result<Connection, rusqlite::Error> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    // The migration counter has drifted across builds, so schema additions are
    // idempotent "add column if missing" checks rather than ordered ALTERs.
    ensure_artist_cover_schema(&conn)?;
    Ok(conn)
}

/// Idempotently add the artist cover columns (see `ensure_column`). Exposed for
/// tests and `open`; must run after `migrate`.
pub(crate) fn ensure_artist_cover_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    ensure_column(
        conn,
        "artists",
        "cover_kind",
        "ALTER TABLE artists ADD COLUMN cover_kind TEXT NOT NULL DEFAULT 'auto';",
    )?;
    ensure_column(
        conn,
        "artists",
        "cover_path",
        "ALTER TABLE artists ADD COLUMN cover_path TEXT;",
    )?;
    Ok(())
}

/// Add a column to `table` only when it isn't already present (idempotent).
fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    ddl: &str,
) -> Result<(), rusqlite::Error> {
    let has: bool = conn
        .prepare(&format!("PRAGMA table_info({table})"))?
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(Result::ok)
        .any(|c| c == column);
    if !has {
        conn.execute_batch(ddl)?;
    }
    Ok(())
}

/// Best-effort sweep of stale cover files whose filename starts with `prefix`
/// (keeping `keep`, the just-written file). Never fatal.
pub fn remove_cover_files(dir: &Path, prefix: &str, keep: Option<&Path>) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if name.starts_with(prefix) && Some(p.as_path()) != keep {
                let _ = std::fs::remove_file(p);
            }
        }
    }
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
    pub favourite: bool,
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
    let new_id = if conn.changes() > 0 {
        Some(conn.last_insert_rowid())
    } else {
        None
    };
    if let Some(id) = new_id {
        if let Some(ch) = rec.channel.as_deref().filter(|c| !c.trim().is_empty()) {
            link_artist(conn, id, ch, 1)?;
        }
        Ok(id)
    } else {
        conn.query_row(
            "SELECT id FROM downloads WHERE video_id = ?1",
            params![rec.video_id],
            |r| r.get(0),
        )
    }
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
        favourite: r.get::<_, i64>("favourite")? != 0,
    })
}

pub fn list_entries(conn: &Connection) -> Result<Vec<LibraryEntry>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT
            d.id, d.video_id, d.url, d.title, d.duration_s, d.kind,
            d.quality, d.container, d.path, d.size_bytes, d.thumb_url,
            d.status, d.created_at, d.favourite,
            (SELECT GROUP_CONCAT(name, ', ') FROM (
                SELECT a.name AS name FROM track_artists ta
                JOIN artists a ON a.id = ta.artist_id
                WHERE ta.track_id = d.id
                ORDER BY ta.position
            )) AS channel
        FROM downloads d
        ORDER BY d.created_at DESC, d.id DESC",
    )?;
    let entries = stmt.query_map([], row_to_entry)?.collect::<Result<_, _>>()?;
    Ok(entries)
}

/// Check whether each entry's file still exists, updating statuses in a single
/// batched transaction. Stat calls run in parallel without holding the DB lock.
pub fn sync_entry_statuses(
    conn: &Connection,
    entries: &mut [LibraryEntry],
) -> Result<(), rusqlite::Error> {
    // Parallel existence checks (no DB lock held by the caller's perspective —
    // callers should release the connection before calling this and re-acquire
    // afterwards; here we only need `conn` for the final batch write).
    let existing: Vec<bool> = std::thread::scope(|s| {
        let handles: Vec<_> = entries
            .iter()
            .map(|e| {
                let path = e.path.clone();
                s.spawn(move || path.is_empty() || Path::new(&path).exists())
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });

    let mut flush: Vec<(i64, bool)> = Vec::new();
    for (entry, exists) in entries.iter_mut().zip(existing) {
        if entry.path.is_empty() {
            continue;
        }
        if entry.status == "done" && !exists {
            entry.status = "missing".to_string();
            flush.push((entry.id, false));
        } else if entry.status == "missing" && exists {
            entry.status = "done".to_string();
            flush.push((entry.id, true));
        }
    }

    if !flush.is_empty() {
        let tx = conn.unchecked_transaction()?;
        {
            let mut stmt = tx.prepare("UPDATE downloads SET status = ?2 WHERE id = ?1")?;
            for (id, status) in &flush {
                stmt.execute(params![id, if *status { "done" } else { "missing" }])?;
            }
        }
        tx.commit()?;
    }

    Ok(())
}

pub fn list_and_sync_statuses(conn: &Connection) -> Result<Vec<LibraryEntry>, rusqlite::Error> {
    let mut entries = list_entries(conn)?;
    sync_entry_statuses(conn, &mut entries)?;
    Ok(entries)
}

pub fn delete_download(conn: &Connection, id: i64) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM downloads WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn set_favourite(conn: &Connection, id: i64, favourite: bool) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE downloads SET favourite = ?2 WHERE id = ?1",
        params![id, favourite as i64],
    )?;
    Ok(())
}

/// Ensure an artist exists and link it to a track at the given position.
fn link_artist(
    conn: &Connection,
    track_id: i64,
    name: &str,
    position: i64,
) -> Result<(), rusqlite::Error> {
    conn.execute("INSERT OR IGNORE INTO artists(name) VALUES (?1)", params![name])?;
    let artist_id: i64 = conn.query_row(
        "SELECT id FROM artists WHERE name = ?1",
        params![name],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO track_artists(track_id, artist_id, position) VALUES (?1, ?2, ?3)",
        params![track_id, artist_id, position],
    )?;
    Ok(())
}

/// Replace a track's artist list (ordered, deduped). Also keeps the redundant
/// `downloads.channel` cache in sync with the joined names.
pub fn set_track_artists(
    conn: &Connection,
    track_id: i64,
    artists: &[String],
) -> Result<(), rusqlite::Error> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM track_artists WHERE track_id = ?1",
        params![track_id],
    )?;
    let mut seen = std::collections::HashSet::new();
    let mut ordered: Vec<String> = Vec::new();
    let mut pos = 1i64;
    for a in artists {
        let trimmed = a.trim();
        if !trimmed.is_empty() && seen.insert(trimmed.to_string()) {
            link_artist(&tx, track_id, trimmed, pos)?;
            ordered.push(trimmed.to_string());
            pos += 1;
        }
    }
    let joined = if ordered.is_empty() {
        None
    } else {
        Some(ordered.join(", "))
    };
    tx.execute(
        "UPDATE downloads SET channel = ?2 WHERE id = ?1",
        params![track_id, joined],
    )?;
    tx.commit()
}

/// All artists with their track counts (artists never referenced by any track
/// are trimmed out). Artwork resolves on the frontend.
pub fn list_artists(conn: &Connection) -> Result<Vec<Artist>, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!(
        "{ARTIST_SELECT} FROM artists a LEFT JOIN track_artists ta ON ta.artist_id = a.id
         GROUP BY a.id
         HAVING track_count > 0
         ORDER BY a.name COLLATE NOCASE ASC, a.id ASC"
    ))?;
    let rows = stmt.query_map([], row_to_artist)?;
    rows.collect()
}

/// A single artist (used to return fresh state after a cover change).
pub fn get_artist(conn: &Connection, id: i64) -> Result<Artist, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!(
        "{ARTIST_SELECT} FROM artists a LEFT JOIN track_artists ta ON ta.artist_id = a.id
         WHERE a.id = ?1
         GROUP BY a.id"
    ))?;
    stmt.query_row([id], row_to_artist)
}

/// Switch an artist between auto collage and a custom cover image.
pub fn set_artist_cover_kind(
    conn: &Connection,
    id: i64,
    kind: CoverKind,
    cover_path: Option<&str>,
) -> Result<(), rusqlite::Error> {
    let kind_str = match kind {
        CoverKind::Auto => "auto",
        CoverKind::Custom => "custom",
    };
    conn.execute(
        "UPDATE artists SET cover_kind = ?2, cover_path = ?3 WHERE id = ?1",
        params![id, kind_str, cover_path],
    )?;
    Ok(())
}

/// Switch a playlist between auto collage and a custom cover image.
pub fn set_playlist_cover_kind(
    conn: &Connection,
    id: i64,
    kind: CoverKind,
    cover_path: Option<&str>,
) -> Result<(), rusqlite::Error> {
    let kind_str = match kind {
        CoverKind::Auto => "auto",
        CoverKind::Custom => "custom",
    };
    conn.execute(
        "UPDATE playlists SET cover_kind = ?2, cover_path = ?3 WHERE id = ?1",
        params![id, kind_str, cover_path],
    )?;
    Ok(())
}

/// Rotate the auto-collage seed so a different-but-stable set of four covers
/// shows next (the "shuffle cover" action).
pub fn set_playlist_cover_seed(
    conn: &Connection,
    id: i64,
    seed: i64,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE playlists SET cover_seed = ?2 WHERE id = ?1",
        params![id, seed],
    )?;
    Ok(())
}

pub fn get_playlist(conn: &Connection, id: i64) -> Result<Playlist, rusqlite::Error> {
    let mut playlist: Playlist = conn.query_row(
        &format!("{PLAYLIST_SELECT} WHERE p.id = ?1 GROUP BY p.id"),
        params![id],
        row_to_playlist,
    )?;
    with_collages(conn, std::slice::from_mut(&mut playlist))?;
    Ok(playlist)
}

pub fn rename_entry(
    conn: &Connection,
    id: i64,
    title: &str,
    artists: &[String],
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE downloads SET title = ?2 WHERE id = ?1",
        params![id, title],
    )?;
    set_track_artists(conn, id, artists)
}

/// Where a playlist's cover art comes from. `auto` renders the animated 4-up
/// collage of the playlist's own track covers; `custom` shows a user-picked
/// image stored at `cover_path`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum CoverKind {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "custom")]
    Custom,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub track_count: i64,
    pub created_at: i64,
    pub cover_kind: CoverKind,
    pub cover_path: Option<String>,
    /// Seed driving the auto collage pick (0 is fine — splitmix64 hashes it).
    pub cover_seed: i64,
    /// Up to four thumbnails picked for the collage (http URL or a cached
    /// absolute path). Empty when the playlist has no tracks with covers.
    pub cover_urls: Vec<String>,
}

/// A single artist with its track count. Artwork resolves on the frontend from
/// the artist's own track thumbnails (`auto` collage) or a user-picked cover
/// image (`custom`, stored at `cover_path`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artist {
    pub id: i64,
    pub name: String,
    pub track_count: i64,
    pub cover_kind: CoverKind,
    pub cover_path: Option<String>,
}

fn row_to_artist(r: &rusqlite::Row) -> Result<Artist, rusqlite::Error> {
    let kind: String = r.get("cover_kind")?;
    Ok(Artist {
        id: r.get("id")?,
        name: r.get("name")?,
        track_count: r.get("track_count")?,
        cover_kind: if kind == "custom" { CoverKind::Custom } else { CoverKind::Auto },
        cover_path: r.get("cover_path")?,
    })
}

const ARTIST_SELECT: &str = "SELECT a.id, a.name, a.cover_kind, a.cover_path,
            COUNT(ta.track_id) AS track_count";

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
    let kind: String = r.get("cover_kind")?;
    Ok(Playlist {
        id: r.get("id")?,
        name: r.get("name")?,
        track_count: r.get("track_count")?,
        created_at: r.get("created_at")?,
        cover_kind: if kind == "custom" { CoverKind::Custom } else { CoverKind::Auto },
        cover_path: r.get("cover_path")?,
        cover_seed: r.get("cover_seed")?,
        cover_urls: Vec::new(),
    })
}

const PLAYLIST_SELECT: &str =
    "SELECT p.id, p.name, p.created_at, p.cover_kind, p.cover_path, p.cover_seed,
            COUNT(pi.id) AS track_count
     FROM playlists p LEFT JOIN playlist_items pi ON pi.playlist_id = p.id";

/// Deterministic PRNG step (splitmix64) — stable across restarts so a given
/// seed always yields the same collage selection.
pub fn splitmix64(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    x ^ (x >> 31)
}

/// Pure: the indices a playlist collage should show, from a seeded partial
/// Fisher–Yates shuffle. Stable for a fixed `seed`; `seed` rotation (the
/// "shuffle cover" action) picks a different-but-persistent four.
pub fn seeded_collage_pick(len: usize, seed: u64, max: usize) -> Vec<usize> {
    if len == 0 || max == 0 {
        return Vec::new();
    }
    let m = max.min(len);
    let mut arr: Vec<usize> = (0..len).collect();
    let mut state = splitmix64(seed);
    for i in 0..m {
        state = splitmix64(state);
        let j = i + (state as usize) % (len - i);
        arr.swap(i, j);
    }
    arr.truncate(m);
    arr
}

/// Order cover art for the collage from a playlist's thumbs: `<4` values are
/// used as-is (a single cover fills the whole tile when there's just one);
/// `>=4` picks four distinct ones seeded by `seed`. Duplicates are dropped so
/// one song never appears twice on a 2×2 grid.
pub fn collage_from_thumbs(thumbs: &[Option<String>], seed: u64) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let distinct: Vec<String> = thumbs
        .iter()
        .flatten()
        .filter(|t| !t.trim().is_empty())
        .filter(|t| seen.insert((*t).clone()))
        .cloned()
        .collect();
    seeded_collage_pick(distinct.len(), seed, 4)
        .into_iter()
        .map(|i| distinct[i].clone())
        .collect()
}

/// Ordered (non-null, non-empty) thumbnail values for a playlist's tracks.
fn load_playlist_thumbs(conn: &Connection, playlist_id: i64) -> Result<Vec<Option<String>>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT d.thumb_url
         FROM playlist_items pi JOIN downloads d ON d.id = pi.download_id
         WHERE pi.playlist_id = ?1
         ORDER BY pi.position ASC, pi.id ASC",
    )?;
    let rows = stmt.query_map(params![playlist_id], |r| r.get(0))?;
    rows.collect()
}

/// Fill each playlist's `cover_urls` from its own tracks (seeded collage for
/// `CoverKind::Auto`; a single URL for `CoverKind::Custom`).
pub fn with_collages(conn: &Connection, playlists: &mut [Playlist]) -> Result<(), rusqlite::Error> {
    for p in playlists.iter_mut() {
        match p.cover_kind {
            CoverKind::Custom => {
                p.cover_urls = p
                    .cover_path
                    .iter()
                    .filter(|c| !c.trim().is_empty())
                    .cloned()
                    .collect();
            }
            CoverKind::Auto => {
                let thumbs = load_playlist_thumbs(conn, p.id)?;
                p.cover_urls = collage_from_thumbs(&thumbs, p.cover_seed as u64);
            }
        }
    }
    Ok(())
}

/// Create a playlist; idempotent on name (returns the existing row instead of failing).
pub fn create_playlist(conn: &Connection, name: &str) -> Result<Playlist, rusqlite::Error> {
    let now = now_unix();
    conn.execute(
        "INSERT OR IGNORE INTO playlists (name, created_at) VALUES (?1, ?2)",
        params![name, now],
    )?;
    let mut playlist: Playlist = conn.query_row(
        &format!("{PLAYLIST_SELECT} WHERE p.name = ?1 GROUP BY p.id"),
        params![name],
        row_to_playlist,
    )?;
    // Seed every new playlist with an id-derived seed so its collage is stable.
    conn.execute(
        "UPDATE playlists SET cover_seed = ?2 WHERE id = ?1 AND cover_seed = 0",
        params![playlist.id, playlist.id],
    )?;
    playlist.cover_seed = playlist.id;
    with_collages(conn, std::slice::from_mut(&mut playlist))?;
    Ok(playlist)
}

pub fn rename_playlist(conn: &Connection, id: i64, name: &str) -> Result<(), rusqlite::Error> {
    conn.execute("UPDATE playlists SET name = ?2 WHERE id = ?1", params![id, name])?;
    Ok(())
}

pub fn list_playlists(conn: &Connection) -> Result<Vec<Playlist>, rusqlite::Error> {
    let sql = format!("{PLAYLIST_SELECT} GROUP BY p.id ORDER BY p.created_at DESC, p.id DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_playlist)?;
    let mut playlists: Vec<Playlist> = rows.collect::<Result<_, _>>()?;
    with_collages(conn, &mut playlists)?;
    Ok(playlists)
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
        "SELECT
            pi.id AS item_id, pi.position AS position, pi.added_at AS added_at,
            d.id, d.video_id, d.url, d.title, d.duration_s, d.kind,
            d.quality, d.container, d.path, d.size_bytes, d.thumb_url,
            d.status, d.created_at, d.favourite,
            (SELECT GROUP_CONCAT(name, ', ') FROM (
                SELECT a.name AS name FROM track_artists ta
                JOIN artists a ON a.id = ta.artist_id
                WHERE ta.track_id = d.id
                ORDER BY ta.position
            )) AS channel
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
/// All playlist memberships as (playlist_id, download_id, item_id) triples —
/// a single query replacing the N+1 `list_playlist_items` calls used for the
/// membership checkmark UI.
pub fn list_playlist_memberships(
    conn: &Connection,
) -> Result<Vec<(i64, i64, i64)>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT playlist_id, download_id, id FROM playlist_items ORDER BY playlist_id, id",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    rows.collect()
}

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
        ensure_artist_cover_schema(&conn).unwrap();
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
  fn multi_artist_round_trip() {
    let conn = mem();
    let id = insert_download(&conn, &rec("abc12345678", "/tmp/a.mp4")).unwrap();
    // insert_download links the single channel "Ch" as one artist.
    let first = list_and_sync_statuses(&conn)
      .unwrap()
      .into_iter()
      .find(|e| e.id == id)
      .unwrap();
    assert_eq!(first.channel.as_deref(), Some("Ch"));

    // Replace with two artists via set_track_artists.
    set_track_artists(&conn, id, &["Alpha".into(), "Beta".into()]).unwrap();
    let e = list_and_sync_statuses(&conn)
      .unwrap()
      .into_iter()
      .find(|e| e.id == id)
      .unwrap();
    assert_eq!(e.channel.as_deref(), Some("Alpha, Beta"));

    // Dedup + trim: a repeated/whitespace name collapses to one entry.
    set_track_artists(&conn, id, &[" Gamma ".into(), "Gamma".into()]).unwrap();
    let dedup = list_and_sync_statuses(&conn)
      .unwrap()
      .into_iter()
      .find(|e| e.id == id)
      .unwrap();
    assert_eq!(dedup.channel.as_deref(), Some("Gamma"));

    // rename_entry updates title and the artist list together.
    rename_entry(&conn, id, "New Title", &["Delta".into()]).unwrap();
    let e2 = list_and_sync_statuses(&conn)
      .unwrap()
      .into_iter()
      .find(|e| e.id == id)
      .unwrap();
    assert_eq!(e2.title, "New Title");
    assert_eq!(e2.channel.as_deref(), Some("Delta"));
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

    #[test]
    fn collage_pick_is_stable_bounded_and_seed_sensitive() {
        let a = seeded_collage_pick(6, 42, 4);
        let b = seeded_collage_pick(6, 42, 4);
        assert_eq!(a, b, "same seed -> same selection");
        assert_ne!(a, seeded_collage_pick(6, 43, 4), "different seed -> different selection");
        assert_eq!(a.len(), 4);
        let mut sorted = a.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), 4, "no duplicate indices");
        assert!(sorted.iter().all(|&i| i < 6));
        // Fewer calls than requested just take what exists.
        assert_eq!(seeded_collage_pick(2, 7, 4).len(), 2);
        assert!(seeded_collage_pick(0, 7, 4).is_empty());
    }

    #[test]
    fn collage_uses_available_covers_only() {
        let thumbs: Vec<Option<String>> = vec![
            Some("a.jpg".into()),
            None,
            Some("b.jpg".into()),
            Some("a.jpg".into()),
        ];
        let out = collage_from_thumbs(&thumbs, 0);
        assert_eq!(out.len(), 2, "dupes + nulls are dropped");
        assert!(out.iter().all(|u| u == "a.jpg" || u == "b.jpg"));

        let one = collage_from_thumbs(&[None, Some("only.jpg".into())], 0);
        assert_eq!(one, vec!["only.jpg".to_string()]);
    }

    #[test]
    fn new_playlist_defaults_to_seeded_auto_cover() {
        let conn = mem();
        let p = create_playlist(&conn, "Seeded").unwrap();
        assert_eq!(p.cover_seed, p.id, "seed borrowed from id for stability");
        assert_eq!(p.cover_kind, CoverKind::Auto);
        assert!(p.cover_path.is_none());
        assert!(p.cover_urls.is_empty());

        set_playlist_cover_kind(&conn, p.id, CoverKind::Custom, Some("/tmp/custom.jpg")).unwrap();
        let after = get_playlist(&conn, p.id).unwrap();
        assert_eq!(after.cover_kind, CoverKind::Custom);
        assert_eq!(after.cover_urls, vec!["/tmp/custom.jpg".to_string()]);

        set_playlist_cover_kind(&conn, p.id, CoverKind::Auto, None).unwrap();
        set_playlist_cover_seed(&conn, p.id, 99).unwrap();
        let reset = get_playlist(&conn, p.id).unwrap();
        assert_eq!(reset.cover_kind, CoverKind::Auto);
        assert!(reset.cover_path.is_none());
        assert_eq!(reset.cover_seed, 99);
    }

    #[test]
    fn artists_list_with_track_counts() {
        let conn = mem();
        let id = insert_download(&conn, &rec("art00000001", "/tmp/a.mp4")).unwrap();
        set_track_artists(&conn, id, &["Daft Punk".into()]).unwrap();

        let artists = list_artists(&conn).unwrap();
        let dp = artists.iter().find(|a| a.name == "Daft Punk").unwrap();
        assert_eq!(dp.track_count, 1);
    }

    #[test]
    fn phantom_artists_are_trimmed_from_listing() {
        let conn = mem();
        conn.execute("INSERT INTO artists(name) VALUES ('Nobody')", [])
            .unwrap();
        assert!(list_artists(&conn).unwrap().is_empty());
    }
}
