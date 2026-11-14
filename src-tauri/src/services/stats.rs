use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::db::now_unix;

/// Analytics window for every stats query. Calendar semantics; chart
/// granularity zooms out with the window: Today = hourly bars, Week = daily,
/// Month = daily (whole calendar month), Year = monthly, All = yearly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Range {
    All,
    Year,
    Month,
    Week,
    Day,
}

/// WHERE fragment mapping an event's local date into the range window. Buckets
/// in `timeline` already bound each event to exactly one displayed bucket, so
/// only the flat/rolling ranges need this.
pub fn range_where(range: Range) -> &'static str {
    match range {
        Range::All => "1=1",
        Range::Year => {
            "datetime(ce.started_at, 'unixepoch', 'localtime')
                 >= datetime('now', 'localtime', 'start of year')"
        }
        Range::Month => {
            "datetime(ce.started_at, 'unixepoch', 'localtime')
                 >= datetime('now', 'localtime', 'start of month')"
        }
        Range::Week => {
            "datetime(ce.started_at, 'unixepoch', 'localtime')
                 >= datetime('now', 'localtime', 'start of day', '-6 days')"
        }
        Range::Day => {
            "datetime(ce.started_at, 'unixepoch', 'localtime')
                 >= datetime('now', 'localtime', 'start of day')"
        }
    }
}

/// Payload the frontend sends per flush: remaining unreported seconds of the
/// current listening session plus the session-end verdict.
#[derive(Debug, Clone)]
pub struct ListenEvent {
    pub video_id: String,
    /// Content seconds played since the previous flush of this session.
    pub seconds: f64,
    /// Closing row of a listening session that reached the 30s play threshold.
    pub completed: bool,
    /// Stream metadata, recorded only for events whose video was never
    /// downloaded (library rows resolve titles/artists through the JOIN).
    pub title: Option<String>,
    pub channel: Option<String>,
    pub thumb_url: Option<String>,
}

/// A listening segment. Started at `started_at` so tests can pin timestamps.
fn record_segment_at(
    conn: &Connection,
    ev: &ListenEvent,
    started_at: i64,
) -> Result<(), rusqlite::Error> {
    if ev.seconds < 1e-9 && !ev.completed {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO play_events (video_id, played_s, completed, title, channel, thumb_url, started_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            ev.video_id,
            ev.seconds,
            ev.completed as i64,
            ev.title,
            ev.channel,
            ev.thumb_url,
            started_at,
        ],
    )?;
    Ok(())
}

pub fn record_segment(conn: &Connection, ev: &ListenEvent) -> Result<(), rusqlite::Error> {
    record_segment_at(conn, ev, now_unix())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    /// Total content seconds (playback-speed adjusted — the accumulation is
    /// taken from media-time deltas, not wall clock).
    pub total_seconds: f64,
    /// Completed ≥30s listens (Spotify-style stream threshold).
    pub plays: i64,
    pub tracks: i64,
}

pub fn overview(conn: &Connection, range: Range) -> Result<Overview, rusqlite::Error> {
    conn.query_row(
        &format!(
            "SELECT COALESCE(SUM(ce.played_s), 0),
                    COALESCE(SUM(ce.completed), 0),
                    COUNT(DISTINCT ce.video_id)
             FROM play_events ce WHERE {}",
            range_where(range)
        ),
        [],
        |r| {
            Ok(Overview {
                total_seconds: r.get(0)?,
                plays: r.get(1)?,
                tracks: r.get(2)?,
            })
        },
    )
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopTrack {
    pub video_id: String,
    pub title: String,
    pub channel: Option<String>,
    pub seconds: f64,
    pub plays: i64,
    /// Original/cached thumb of the downloaded row (falling back to the
    /// stream-row's recorded thumb), or none for stream-only ghosts.
    pub thumb_url: Option<String>,
    /// User-selected app artwork, preferred by the frontend when present.
    pub custom_thumb_path: Option<String>,
}

const TRACK_ARTISTS_SQL: &str = "(SELECT GROUP_CONCAT(name, ', ') FROM (
            SELECT a.name AS name FROM track_artists ta
            JOIN artists a ON a.id = ta.artist_id
            WHERE ta.track_id = d.id
            ORDER BY ta.position
        ))";

pub fn top_tracks(
    conn: &Connection,
    range: Range,
    limit: i64,
) -> Result<Vec<TopTrack>, rusqlite::Error> {
    let sql = format!(
        "SELECT ce.video_id AS video_id,
                COALESCE(MAX(d.title), MAX(ce.title), ce.video_id) AS title,
                COALESCE({TRACK_ARTISTS_SQL}, TRIM(MAX(ce.channel))) AS channel,
                SUM(ce.played_s) AS seconds,
                SUM(ce.completed) AS plays,
                COALESCE(MAX(d.thumb_url), MAX(ce.thumb_url)) AS thumb_url,
                MAX(d.custom_thumb_path) AS custom_thumb_path
         FROM play_events ce
         LEFT JOIN downloads d ON d.video_id = ce.video_id
         WHERE {w}
         GROUP BY ce.video_id
         ORDER BY plays DESC, seconds DESC, title COLLATE NOCASE ASC
         LIMIT ?",
        w = range_where(range)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([limit], |r| {
        Ok(TopTrack {
            video_id: r.get("video_id")?,
            title: r.get("title")?,
            channel: r.get("channel")?,
            seconds: r.get("seconds")?,
            plays: r.get("plays")?,
            thumb_url: r.get("thumb_url")?,
            custom_thumb_path: r.get("custom_thumb_path")?,
        })
    })?;
    rows.collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TopArtist {
    pub name: String,
    pub seconds: f64,
    pub plays: i64,
    /// Library artist row id, used by the frontend for artwork/details —
    /// absent for artists known only from stream events.
    pub artist_id: Option<i64>,
}

pub fn top_artists(
    conn: &Connection,
    range: Range,
    limit: i64,
) -> Result<Vec<TopArtist>, rusqlite::Error> {
    // Two sources, UNIONed then summed per *name*: library tracks attribute
    // through the normalized artist tables (each artist is credited the
    // track's full listen); stream-only events fall back to their recorded
    // channel string, and match downloads rows never double-count.
    let sql = format!(
        "SELECT name, SUM(seconds) AS seconds, SUM(plays) AS plays, MAX(artist_id) AS artist_id
         FROM (
             SELECT a.name AS name, SUM(ce.played_s) AS seconds,
                    SUM(ce.completed) AS plays, a.id AS artist_id
             FROM play_events ce
             JOIN downloads d ON d.video_id = ce.video_id
             JOIN track_artists ta ON ta.track_id = d.id
             JOIN artists a ON a.id = ta.artist_id
             WHERE {w}
             GROUP BY a.id
             UNION ALL
             SELECT TRIM(ce.channel) AS name, SUM(ce.played_s) AS seconds,
                    SUM(ce.completed) AS plays, NULL AS artist_id
             FROM play_events ce
             WHERE {w}
               AND TRIM(COALESCE(ce.channel, '')) <> ''
               AND NOT EXISTS (SELECT 1 FROM downloads d2 WHERE d2.video_id = ce.video_id)
             GROUP BY TRIM(ce.channel)
         )
         GROUP BY name
         ORDER BY plays DESC, seconds DESC, name COLLATE NOCASE ASC
         LIMIT ?",
        w = range_where(range)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([limit], |r| {
        Ok(TopArtist {
            name: r.get("name")?,
            seconds: r.get("seconds")?,
            plays: r.get("plays")?,
            artist_id: r.get("artist_id")?,
        })
    })?;
    rows.collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub label: String,
    pub seconds: f64,
}

/// Zero-filled date buckets covering the range window (7 days / current
/// calendar month / 12 months of the current year / every year of listening
/// history). A recursive SQLite series supplies the calendar; each event
/// joins exactly the bucket holding its local date, so no separate range
/// filter is needed.
pub fn timeline(conn: &Connection, range: Range) -> Result<Vec<Bucket>, rusqlite::Error> {
    if range == Range::All {
        let any: bool = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM play_events)", [], |r| r.get(0))?;
        if !any {
            return Ok(Vec::new());
        }
    }
    let sql = match range {
        Range::Week => "
            WITH RECURSIVE days(d) AS (
                SELECT datetime('now', 'localtime', 'start of day', '-6 days')
                UNION ALL
                SELECT datetime(d, '+1 day') FROM days
                WHERE datetime(d, '+1 day') < datetime('now', 'localtime', 'start of day', '+1 day')
             )
             SELECT days.d AS bucket, COALESCE(SUM(ce.played_s), 0) AS seconds
             FROM days
             LEFT JOIN play_events ce
                ON strftime('%Y-%m-%d 00:00:00', ce.started_at, 'unixepoch', 'localtime') = days.d
             GROUP BY days.d ORDER BY days.d ASC",
        Range::Month => "
            WITH RECURSIVE days(d) AS (
                SELECT datetime('now', 'localtime', 'start of month')
                UNION ALL
                SELECT datetime(d, '+1 day') FROM days
                WHERE datetime(d, '+1 day') < datetime('now', 'localtime', 'start of month', '+1 month')
             )
             SELECT days.d AS bucket, COALESCE(SUM(ce.played_s), 0) AS seconds
             FROM days
             LEFT JOIN play_events ce
                ON strftime('%Y-%m-%d 00:00:00', ce.started_at, 'unixepoch', 'localtime') = days.d
             GROUP BY bucket ORDER BY bucket ASC",
        Range::Day => "
            WITH RECURSIVE hours(h) AS (
                SELECT datetime('now', 'localtime', 'start of day')
                UNION ALL
                SELECT datetime(h, '+1 hour') FROM hours
                WHERE datetime(h, '+1 hour') < datetime('now', 'localtime', 'start of day', '+1 day')
             )
             SELECT hours.h AS bucket, COALESCE(SUM(ce.played_s), 0) AS seconds
             FROM hours
             LEFT JOIN play_events ce
                ON strftime('%Y-%m-%d %H:00:00', ce.started_at, 'unixepoch', 'localtime') = hours.h
             GROUP BY bucket ORDER BY bucket ASC",
        Range::Year => "
            WITH RECURSIVE months(m) AS (
                SELECT datetime('now', 'localtime', 'start of year')
                UNION ALL
                SELECT datetime(m, '+1 month') FROM months
                WHERE datetime(m, '+1 month') < datetime('now', 'localtime', 'start of year', '+1 year')
             )
             SELECT months.m AS bucket, COALESCE(SUM(ce.played_s), 0) AS seconds
             FROM months
             LEFT JOIN play_events ce
                ON strftime('%Y-%m-01 00:00:00', ce.started_at, 'unixepoch', 'localtime') = months.m
             GROUP BY months.m ORDER BY months.m ASC",
        // Start the series at the first event's year so the chart spans the
        // entire listening history; the anchor of an empty database is guarded
        // above.
        Range::All => "
            WITH RECURSIVE years(y) AS (
                SELECT strftime('%Y-01-01 00:00:00', (SELECT MIN(started_at) FROM play_events),
                                'unixepoch', 'localtime')
                UNION ALL
                SELECT datetime(y, '+1 year') FROM years
                WHERE datetime(y, '+1 year') < datetime('now', 'localtime', 'start of day', '+1 day')
             )
             SELECT years.y AS bucket, COALESCE(SUM(ce.played_s), 0) AS seconds
             FROM years
             LEFT JOIN play_events ce
                ON strftime('%Y-01-01 00:00:00', ce.started_at, 'unixepoch', 'localtime') = years.y
             GROUP BY years.y ORDER BY years.y ASC",
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |r| {
        let bucket: String = r.get("bucket")?;
        let seconds: f64 = r.get("seconds")?;
        Ok(Bucket {
            label: bucket_label(&bucket, range),
            seconds,
        })
    })?;
    rows.collect()
}

/// Pure: days since 1970-01-01 for a civil date (Howard Hinnant's algorithm —
/// no chrono dependency, used for weekday bucket labels).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let yy = if m <= 2 { y - 1 } else { y };
    let era = (if yy >= 0 { yy } else { yy - 399 }) / 400;
    let yoe = yy - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Pure: English ordinal suffix for a day number ("1st", "2nd", "3rd",
/// "4th"… with the 11th–13th exceptions). 4 characters at most, so month
/// chart labels never truncate.
fn ordinal(n: i64) -> String {
    let suffix = match n % 100 {
        11..=13 => "th",
        _ => match n % 10 {
            1 => "st",
            2 => "nd",
            3 => "rd",
            _ => "th",
        },
    };
    format!("{n}{suffix}")
}

/// Pure: human label for a `YYYY-MM-DD HH:MM:SS` bucket key (`datetime` /
/// `strftime` local-date output), themed by range:
/// all → "2024", year → "Jan", month → "3rd", week → "Thu 6", day → "14h".
pub fn bucket_label(ks: &str, range: Range) -> String {
    let parse = |slice: &str| slice.parse::<i64>().ok();
    let y = ks.get(0..4).and_then(parse);
    let m = ks.get(5..7).and_then(parse);
    let d = ks.get(8..10).and_then(parse);
    match ((y, m, d), range) {
        ((Some(y), Some(m), Some(d)), _) => match range {
            Range::All => y.to_string(),
            Range::Year => MONTHS[(m.clamp(1, 12) - 1) as usize].to_string(),
            // Ordinals ("1st"… "30th"): the month chart is ~30 narrow columns,
            // and 4-char labels are the longest that never truncate there.
            Range::Month => ordinal(d),
            Range::Day => {
                // Hour key (`YYYY-MM-DD HH:00:00`) → "14h" (leap-year names on
                // the date slices are parsed above to keep the match total).
                ks.get(11..13)
                    .and_then(|h| h.parse::<u8>().ok())
                    .map(|h| format!("{h}h"))
                    .unwrap_or_else(|| ks.chars().skip(11).take(2).collect())
            }
            Range::Week => {
                const WEEKDAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                let idx = (days_from_civil(y, m, d) + 4).rem_euclid(7);
                format!("{} {}", WEEKDAYS[idx as usize], d)
            }
        },
        // Malformed keys can't come from SQLite's own strftime output, but the
        // fallback keeps the frontend rendering sane regardless.
        _ => ks.chars().take(10).collect(),
    }
}

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        super::super::db::migrate(&conn).unwrap();
        conn
    }

    fn ev(video_id: &str, seconds: f64, completed: bool, title: Option<&str>) -> ListenEvent {
        ListenEvent {
            video_id: video_id.into(),
            seconds,
            completed,
            title: title.map(Into::into),
            channel: None,
            thumb_url: None,
        }
    }

    // ---- pure helpers -----------------------------------------------------

    #[test]
    fn civil_weekday_matches_reference_dates() {
        // Exercised end-to-end through the pure label formatter: 1970-01-01
        // was a Thursday, 2000-01-01 a Saturday, 2024-02-29 a Thursday.
        assert_eq!(bucket_label("1970-01-01 00:00:00", Range::Week), "Thu 1");
        assert_eq!(bucket_label("2000-01-01 00:00:00", Range::Week), "Sat 1");
        assert_eq!(bucket_label("2024-02-29 00:00:00", Range::Week), "Thu 29");
        assert_eq!(bucket_label("2024-03-05 00:00:00", Range::Week), "Tue 5");
    }

    #[test]
    fn bucket_labels_by_range() {
        let ks = "2026-03-09 00:00:00";
        assert_eq!(bucket_label(ks, Range::All), "2026");
        assert_eq!(bucket_label(ks, Range::Year), "Mar");
        assert_eq!(bucket_label(ks, Range::Month), "9th");
        assert_eq!(bucket_label(ks, Range::Week), "Mon 9");
        assert_eq!(bucket_label("2026-03-09 14:07:32", Range::Day), "14h");
        // Ordinal suffix rules: 1st/2nd/3rd, 11th–13th, 21st/22nd/23rd, 30th.
        let day = |k: &str| bucket_label(k, Range::Month);
        assert_eq!(day("2026-02-01 00:00:00"), "1st");
        assert_eq!(day("2026-02-02 00:00:00"), "2nd");
        assert_eq!(day("2026-02-03 00:00:00"), "3rd");
        assert_eq!(day("2026-02-04 00:00:00"), "4th");
        assert_eq!(day("2026-02-11 00:00:00"), "11th");
        assert_eq!(day("2026-02-13 00:00:00"), "13th");
        assert_eq!(day("2026-02-21 00:00:00"), "21st");
        assert_eq!(day("2026-02-22 00:00:00"), "22nd");
        assert_eq!(day("2026-02-23 00:00:00"), "23rd");
        assert_eq!(day("2026-02-30 00:00:00"), "30th");
        // Leap-year day and a malformed key fall through sanely.
        assert_eq!(bucket_label("2024-02-29 00:00:00", Range::Week), "Thu 29");
        assert_eq!(bucket_label("not-a-date", Range::Week), "not-a-date");
    }

    #[test]
    fn range_window_filters() {
        let conn = mem();
        let now = now_unix();
        record_segment_at(&conn, &ev("now0000001", 60.0, true, None), now).unwrap();
        record_segment_at(&conn, &ev("old0000002", 120.0, true, None), now - 45 * 86_400)
            .unwrap();
        record_segment_at(&conn, &ev("ancient0001", 300.0, true, None), now - 370 * 86_400)
            .unwrap();

        // 45 days back is always in a different calendar month; 370 days back
        // is always within the current year at worst — both are stable
        // boundaries (a 45d offset can never land in this month, and 370d can
        // never land in this calendar year).
        assert_eq!(overview(&conn, Range::All).unwrap().tracks, 3);
        assert_eq!(overview(&conn, Range::Year).unwrap().tracks, 2);
        assert_eq!(overview(&conn, Range::Month).unwrap().tracks, 1);
        assert_eq!(overview(&conn, Range::Week).unwrap().tracks, 1);
        assert_eq!(overview(&conn, Range::Day).unwrap().tracks, 1);
        let all = overview(&conn, Range::All).unwrap();
        assert_eq!(all.plays, 3);
        assert!((all.total_seconds - 480.0).abs() < 1e-9);
    }

    // ---- recording + aggregation ------------------------------------------

    #[test]
    fn record_and_overview() {
        let conn = mem();
        let now = now_unix();
        record_segment_at(
            &conn,
            &ListenEvent {
                video_id: "stream".into(),
                seconds: 40.0,
                completed: true,
                title: Some("Stream Song".into()),
                channel: Some("The Streams".into()),
                thumb_url: Some("s.jpg".into()),
            },
            now,
        )
        .unwrap();
        record_segment_at(&conn, &ev("stream", 5.5, false, None), now).unwrap();
        record_segment_at(&conn, &ev("libvid01", 20.0, false, None), now).unwrap();
        record_segment_at(&conn, &ev("libvid02", 200.0, true, None), now).unwrap();
        // Zero-length non-completed rows are dropped entirely.
        record_segment_at(&conn, &ev("libvid02", 0.0, false, None), now).unwrap();

        let all = overview(&conn, Range::All).unwrap();
        assert!((all.total_seconds - 265.5).abs() < 1e-9);
        assert_eq!(all.plays, 2);
        assert_eq!(all.tracks, 3);
    }

    #[test]
    fn top_tracks_unite_library_and_stream_rows() {
        let conn = mem();
        let now = now_unix();
        // A library track with an artist link.
        super::super::db::insert_download(
            &conn,
            &super::super::db::DownloadRecord {
                video_id: "libvid01".into(),
                url: "u".into(),
                title: "Downloaded Song".into(),
                channel: Some("Alpha".into()),
                duration_s: Some(180),
                kind: "audio".into(),
                quality: None,
                container: "mp3".into(),
                path: "/tmp/a.mp3".into(),
                size_bytes: None,
                thumb_url: Some("lib.jpg".into()),
            },
        )
        .unwrap();
        record_segment_at(&conn, &ev("libvid01", 100.0, false, None), now).unwrap();
        record_segment_at(&conn, &ev("libvid01", 50.0, true, None), now - 300).unwrap();
        // Stream-only ghost rows carry their own metadata.
        record_segment_at(
            &conn,
            &ListenEvent {
                video_id: "streamvid1".into(),
                seconds: 200.0,
                completed: true,
                title: Some("Stream Song".into()),
                channel: Some("Beta".into()),
                thumb_url: Some("s.jpg".into()),
            },
            now,
        )
        .unwrap();

        let tracks = top_tracks(&conn, Range::All, 10).unwrap();
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].video_id, "streamvid1");
        assert_eq!(tracks[0].title, "Stream Song");
        assert_eq!(tracks[0].channel.as_deref(), Some("Beta"));
        assert!((tracks[0].seconds - 200.0).abs() < 1e-9);
        assert!((tracks[1].seconds - 150.0).abs() < 1e-9);
        assert_eq!(tracks[1].title, "Downloaded Song");
        assert_eq!(tracks[1].channel.as_deref(), Some("Alpha"));
        assert_eq!(tracks[1].thumb_url.as_deref(), Some("lib.jpg"));
    }

    #[test]
    fn top_artists_credit_library_and_fallback_channels() {
        let conn = mem();
        let now = now_unix();
        super::super::db::insert_download(
            &conn,
            &super::super::db::DownloadRecord {
                video_id: "libvid01".into(),
                url: "u".into(),
                title: "Song".into(),
                channel: Some("Alpha".into()),
                duration_s: Some(180),
                kind: "audio".into(),
                quality: None,
                container: "mp3".into(),
                path: "/tmp/a.mp3".into(),
                size_bytes: None,
                thumb_url: None,
            },
        )
        .unwrap();
        // Two credited artists on the library track (full credit each).
        super::super::db::set_track_artists(&conn, 1, &["Alpha".into(), "Gamma".into()])
            .unwrap();
        record_segment_at(&conn, &ev("libvid01", 90.0, false, None), now).unwrap();
        record_segment_at(
            &conn,
            &ListenEvent {
                video_id: "streamvid1".into(),
                seconds: 40.0,
                completed: true,
                title: Some("Ghost song".into()),
                channel: Some("Alpha".into()),
                thumb_url: None,
            },
            now,
        )
        .unwrap();

        let artists = top_artists(&conn, Range::All, 10).unwrap();
        assert_eq!(
            artists.len(),
            2,
            "Alpha (library + ghost fallback) and Gamma"
        );
        let alpha = artists.iter().find(|a| a.name == "Alpha").unwrap();
        assert!((alpha.seconds - 130.0).abs() < 1e-9); // 90 (library) + 40 (ghost)
        assert_eq!(alpha.plays, 1);
        assert_eq!(alpha.artist_id, Some(1), "library id wins for the name");
        let gamma = artists.iter().find(|a| a.name == "Gamma").unwrap();
        assert!((gamma.seconds - 90.0).abs() < 1e-9);
        assert_eq!(gamma.artist_id, Some(2));
        // Artists are ordered by seconds descending.
        assert_eq!(artists[0].name, "Alpha");
    }

    // ---- timeline ---------------------------------------------------------

    #[test]
    fn empty_database_timelines_are_empty() {
        let conn = mem();
        assert!(timeline(&conn, Range::All).unwrap().is_empty());
        // Calendar windows still produce zero-filled buckets.
        assert_eq!(timeline(&conn, Range::Week).unwrap().len(), 7);
    }

    #[test]
    fn week_timeline_buckets_today_and_excludes_eight_days_ago() {
        let conn = mem();
        let now = now_unix();
        record_segment_at(&conn, &ev("t1", 30.0, true, None), now).unwrap();
        record_segment_at(&conn, &ev("t1", 25.5, false, None), now).unwrap();
        record_segment_at(&conn, &ev("t2", 8.0, false, None), now).unwrap();
        // 8 days back can never fall inside the rolling 7-day window.
        record_segment_at(&conn, &ev("old0000002", 999.0, true, None), now - 8 * 86_400)
            .unwrap();

        let buckets = timeline(&conn, Range::Week).unwrap();
        assert_eq!(
            buckets.len(),
            7,
            "exactly one bucket per day regardless of timezone offsets"
        );
        // Buckets ascend and the final (today) bucket holds all recent audio.
        let today = buckets.last().unwrap();
        assert!((today.seconds - 63.5).abs() < 1e-9);
        // Non-date-only labels: every label parses (no empty labels).
        assert!(buckets.iter().all(|b| !b.label.is_empty()));
    }

    #[test]
    fn month_timeline_covers_the_calendar_month() {
        let conn = mem();
        let now = now_unix();
        record_segment_at(&conn, &ev("now0000001", 60.0, true, None), now).unwrap();
        // 45 days ago is always in a different calendar month.
        record_segment_at(&conn, &ev("old0000002", 5.0, false, None), now - 45 * 86_400)
            .unwrap();

        let buckets = timeline(&conn, Range::Month).unwrap();
        assert!(!buckets.is_empty());
        assert!(
            (buckets.iter().map(|b| b.seconds).sum::<f64>() - 60.0).abs() < 1e-9,
            "only this month's listening sums into the chart"
        );
        // One bucket per day of the calendar month; day numbers ascend
        // (labels like "23rd" don't compare as raw strings).
        let day_of = |lbl: &str| -> Option<i64> {
            let digits: String = lbl
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            digits.parse().ok()
        };
        assert!(
            buckets.windows(2).all(|w| day_of(&w[0].label) < day_of(&w[1].label)),
            "buckets ascend"
        );
        assert!(buckets.iter().all(|b| !b.label.is_empty()));
    }

    #[test]
    fn day_timeline_has_24_hour_buckets() {
        let conn = mem();
        let now = now_unix();
        record_segment_at(&conn, &ev("now0000001", 60.0, true, None), now).unwrap();
        // 8 days back is always a different day — excluded from today.
        record_segment_at(&conn, &ev("old0000002", 5.0, false, None), now - 10 * 86_400)
            .unwrap();

        let buckets = timeline(&conn, Range::Day).unwrap();
        assert_eq!(
            buckets.len(),
            24,
            "one zero-filled bucket per hour of today"
        );
        assert!(
            (buckets.iter().map(|b| b.seconds).sum::<f64>() - 60.0).abs() < 1e-9,
            "yesterday's audio never lands in today's chart"
        );
        let last = buckets.last().unwrap();
        assert_eq!(last.label, "23h");
        // Hour labels aren't Ascii-comparable across 9h→10h; compare numbers.
        let hour_of = |lbl: &str| lbl.strip_suffix('h').and_then(|s| s.parse::<u8>().ok());
        assert!(
            buckets.windows(2).all(|w| hour_of(&w[0].label) < hour_of(&w[1].label)),
            "hour buckets ascend: {:?}",
            buckets.iter().map(|b| &b.label).collect::<Vec<_>>()
        );
    }

    #[test]
    fn year_timeline_has_twelve_month_buckets() {
        let conn = mem();
        let now = now_unix();
        record_segment_at(&conn, &ev("now0000001", 60.0, true, None), now).unwrap();
        record_segment_at(&conn, &ev("ancient0001", 5.0, false, None), now - 370 * 86_400)
            .unwrap();

        let buckets = timeline(&conn, Range::Year).unwrap();
        assert_eq!(
            buckets.len(),
            12,
            "one bucket per calendar month of the current year"
        );
        // Only this month's listening sums into the chart; the 370-days-back
        // event is always in a previous calendar year.
        assert!((buckets.iter().map(|b| b.seconds).sum::<f64>() - 60.0).abs() < 1e-9);
        assert_eq!(buckets[0].label, "Jan");
        assert_eq!(buckets[11].label, "Dec");
    }

    #[test]
    fn all_timeline_spans_listening_history() {
        let conn = mem();
        let now = now_unix();
        record_segment_at(&conn, &ev("now0000001", 60.0, true, None), now).unwrap();
        record_segment_at(&conn, &ev("ancient0001", 5.0, false, None), now - 370 * 86_400)
            .unwrap();

        let buckets = timeline(&conn, Range::All).unwrap();
        assert!(
            buckets.windows(2).all(|w| w[0].label < w[1].label),
            "year labels strictly ascend"
        );
        let last = buckets.last().unwrap();
        assert!(
            last.label.len() == 4 && last.label.chars().all(|c| c.is_ascii_digit()),
            "the final bucket is always the current year: {}",
            last.label
        );
        assert!((last.seconds - 60.0).abs() < 1e-9,
            "the 'now' event always lands in the current-year bucket");
    }
}
