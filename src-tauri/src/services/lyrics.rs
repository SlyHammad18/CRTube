use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub const LRCLIB_BASE: &str = "https://lrclib.net";
const USER_AGENT: &str = concat!("CRTube/", env!("CARGO_PKG_VERSION"), " (Tauri desktop player)");
/// Max allowed distance between the track duration and a search result's duration.
const DURATION_TOLERANCE_S: u64 = 3;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsPayload {
    pub synced: Option<String>,
    pub plain: Option<String>,
    pub instrumental: bool,
    pub track_name: String,
    pub artist_name: String,
    pub cached: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LrcLibTrack {
    #[serde(default)]
    pub track_name: String,
    #[serde(default)]
    pub artist_name: String,
    /// LRCLIB emits this as a JSON float (`355.0`) — never bind it to an integer type.
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub instrumental: bool,
    #[serde(default)]
    pub plain_lyrics: Option<String>,
    #[serde(default)]
    pub synced_lyrics: Option<String>,
}

/// Decoration that appears in YouTube titles and poisons lyric lookups.
const NOISE_WORDS: &[&str] = &[
    "official", "video", "audio", "lyric", "lyrics", "visualizer", "m/v", "mv",
    "hd", "hq", "4k", "8k", "remastered", "remaster", "explicit", "topic",
];

fn strip_noise(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let bytes = title.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let rest = &title[i..];
        let Some(open) = rest.find(['(', '[']) else {
            out.push_str(rest);
            break;
        };
        let close_ch = if rest.as_bytes()[open] == b'(' { ')' } else { ']' };
        let close_abs = rest[open..].find(close_ch).map(|p| open + p);
        match close_abs {
            Some(close) if close > open => {
                let inner = rest[open + 1..close].trim();
                let lowered = inner.to_lowercase();
                let noisy = NOISE_WORDS.iter().any(|w| lowered.contains(w));
                out.push_str(&rest[..open]);
                if !noisy {
                    // Keep meaningful segments like "(Acoustic)" or "(feat. X)".
                    out.push('(');
                    out.push_str(inner);
                    out.push(')');
                }
                i += close + 1;
            }
            _ => {
                // Unbalanced bracket — keep the remainder verbatim.
                out.push_str(rest);
                break;
            }
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Derive `(track, artist)` search terms from a download's title + channel.
///
/// Handles the dominant YouTube patterns:
/// - `"Artist - Title"` / `"Artist – Title"` / `"Artist — Title"` → split on first dash
/// - `"Artist | Title"` → split on pipe
/// - decoration like `"(Official Video)"`, `"[HD]"` is dropped
/// - fallback: track = whole title, artist = channel
pub fn parse_title_artist(title: &str, channel: Option<&str>) -> (String, String) {
    let cleaned = strip_noise(title.trim());
    for sep in [" - ", " – ", " — ", " | "] {
        if let Some((left, right)) = cleaned.split_once(sep) {
            let (artist, track) = (left.trim(), right.trim());
            if !artist.is_empty() && !track.is_empty() {
                return (track.to_string(), artist.to_string());
            }
        }
    }
    (
        cleaned.clone(),
        channel.unwrap_or_default().trim().to_string(),
    )
}

fn duration_delta(track: &LrcLibTrack, target: Option<u64>) -> Option<u64> {
    let target = target?;
    let duration = track.duration?.round().max(0.0) as u64;
    Some(duration.abs_diff(target))
}

fn has_synced(track: &LrcLibTrack) -> bool {
    track.synced_lyrics.as_deref().is_some_and(|s| !s.trim().is_empty())
}

/// Choose the best LRCLIB result for a track. Preference order:
/// 1. synced lyrics + duration within tolerance
/// 2. duration within tolerance
/// 3. any synced lyrics
/// 4. give up (`None`) rather than risk wrong-song lyrics
pub fn pick_best(results: &[LrcLibTrack], duration_s: Option<u64>) -> Option<&LrcLibTrack> {
    let within = |t: &LrcLibTrack| matches!(duration_delta(t, duration_s), Some(d) if d <= DURATION_TOLERANCE_S);
    results
        .iter()
        .find(|t| has_synced(t) && within(t))
        .or_else(|| results.iter().find(|t| !t.instrumental && within(t)))
        .or_else(|| results.iter().find(|t| has_synced(t)))
}

pub fn lyrics_dir(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_data_dir().ok()?.join("lyrics"))
}

/// `{app_data}/lyrics/{video_id}.lrc` holds synced lyrics; `.txt` holds plain
/// text (empty file = known-instrumental marker).
pub fn cached_path(dir: &Path, video_id: &str, synced: bool) -> PathBuf {
    dir.join(format!("{video_id}.{}", if synced { "lrc" } else { "txt" }))
}

fn read_cache(dir: &Path, video_id: &str) -> Option<LyricsPayload> {
    for flag in [true, false] {
        let body = match std::fs::read_to_string(cached_path(dir, video_id, flag)) {
            Ok(body) => body,
            Err(_) => continue,
        };
        let text = if body.trim().is_empty() { None } else { Some(body) };
        let (synced, plain) = match flag {
            true => (text.clone(), None),
            false => (None, text),
        };
        return Some(LyricsPayload {
            synced,
            plain,
            instrumental: false,
            track_name: String::new(),
            artist_name: String::new(),
            cached: true,
        });
    }
    None
}

fn write_cache(dir: &Path, video_id: &str, payload: &LyricsPayload) -> Option<()> {
    let (synced, body) = match (&payload.synced, &payload.plain) {
        (Some(s), _) => (true, s.clone()),
        (None, Some(p)) => (false, p.clone()),
        (None, None) => (false, payload.instrumental.then(String::new)?),
    };
    std::fs::create_dir_all(dir).ok()?;
    let dest = cached_path(dir, video_id, synced);
    let tmp = dir.join(format!(".{video_id}.tmp"));
    std::fs::write(&tmp, body).ok()?;
    std::fs::rename(&tmp, &dest).ok()?;
    Some(())
}

async fn lrclib_get(client: &reqwest::Client, artist: &str, track: &str, duration_s: Option<u64>) -> Result<Option<LrcLibTrack>, String> {
    let mut url = reqwest::Url::parse(&format!("{LRCLIB_BASE}/api/get")).expect("static base URL");
    url.query_pairs_mut()
        .append_pair("track_name", track)
        .append_pair("artist_name", artist);
    if let Some(d) = duration_s {
        url.query_pairs_mut().append_pair("duration", &d.to_string());
    }
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let resp = resp.error_for_status().map_err(|e| e.to_string())?;
    Ok(resp.json::<LrcLibTrack>().await.ok())
}

async fn lrclib_search(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<LrcLibTrack>, String> {
    let mut url = reqwest::Url::parse(&format!("{LRCLIB_BASE}/api/search")).expect("static base URL");
    url.query_pairs_mut().append_pair("q", query);
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(Vec::new());
    }
    let resp = resp.error_for_status().map_err(|e| e.to_string())?;
    Ok(resp.json::<Vec<LrcLibTrack>>().await.unwrap_or_default())
}

/// Cache-first LRCLIB lookup. Returns `Ok(None)` when nothing trustworthy is found.
pub async fn fetch_lyrics(
    app: &AppHandle,
    video_id: &str,
    title: &str,
    channel: Option<&str>,
    duration_s: Option<u64>,
) -> Result<Option<LyricsPayload>, String> {
    let dir = lyrics_dir(app).ok_or("cannot resolve app data dir")?;
    if let Some(mut hit) = read_cache(&dir, video_id) {
        let (track_name, artist_name) = parse_title_artist(title, channel);
        if hit.track_name.is_empty() {
            hit.track_name = track_name;
        }
        if hit.artist_name.is_empty() {
            hit.artist_name = artist_name;
        }
        return Ok(Some(hit));
    }

    let (track, artist) = parse_title_artist(title, channel);
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;

    let found = if track.is_empty() || artist.is_empty() {
        None
    } else {
        match lrclib_get(&client, &artist, &track, duration_s).await {
            Ok(Some(t)) => Some(t),
            Ok(None) => None,
            Err(e) => return Err(format!("lrclib get failed: {e}")),
        }
    };

    let chosen = match found {
        Some(t) if has_synced(&t) || t.plain_lyrics.is_some() || t.instrumental => Some(t),
        _ => {
            let query = if artist.is_empty() {
                track.clone()
            } else {
                format!("{artist} {track}")
            };
            if query.trim().is_empty() {
                None
            } else {
                let results = lrclib_search(&client, &query).await?;
                pick_best(&results, duration_s).cloned()
            }
        }
    };

    let Some(mut t) = chosen else {
        return Ok(None);
    };

    let synced = t.synced_lyrics.take_if(|s| !s.trim().is_empty());
    let plain = t.plain_lyrics.take_if(|s| !s.trim().is_empty());
    let instrumental = t.instrumental && synced.is_none() && plain.is_none();
    let payload = LyricsPayload {
        synced,
        plain,
        instrumental,
        track_name: t.track_name,
        artist_name: t.artist_name,
        cached: false,
    };
    write_cache(&dir, video_id, &payload);
    Ok(Some(payload))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_splits_artist_dash_title() {
        assert_eq!(
            parse_title_artist("Queen - Bohemian Rhapsody", Some("Music Channel")),
            ("Bohemian Rhapsody".into(), "Queen".into())
        );
        assert_eq!(
            parse_title_artist("Daft Punk \u{2013} One More Time", None),
            ("One More Time".into(), "Daft Punk".into())
        );
        assert_eq!(
            parse_title_artist("Artist | Song Title", Some("Ch")),
            ("Song Title".into(), "Artist".into())
        );
    }

    #[test]
    fn parse_strips_youtube_decoration() {
        let (track, artist) =
            parse_title_artist("Queen - Bohemian Rhapsody (Official Video Remastered)", Some("Ch"));
        assert_eq!(track, "Bohemian Rhapsody");
        assert_eq!(artist, "Queen");

        // Meaningful parentheticals survive.
        let (track, _) = parse_title_artist("Song Name (Acoustic) [Official Audio]", Some("Ch"));
        assert_eq!(track, "Song Name (Acoustic)");
    }

    #[test]
    fn parse_falls_back_to_channel_as_artist() {
        assert_eq!(
            parse_title_artist("Some Standalone Track", Some("LoFi Girl")),
            ("Some Standalone Track".into(), "LoFi Girl".into())
        );
        assert_eq!(parse_title_artist("No Channel Here", None).1, "");
    }

    #[test]
    fn parse_unbalanced_brackets_are_kept() {
        let (track, _) = parse_title_artist("Weird [Broken Title", Some("Ch"));
        assert_eq!(track, "Weird [Broken Title");
    }

    fn track(synced: bool, duration: u64) -> LrcLibTrack {
        LrcLibTrack {
            track_name: "T".into(),
            artist_name: "A".into(),
            duration: Some(duration as f64),
            instrumental: false,
            plain_lyrics: (!synced).then(|| "plain".into()),
            synced_lyrics: synced.then(|| "[00:01.00] line".into()),
        }
    }

    #[test]
    fn pick_prefers_synced_within_tolerance() {
        let results = vec![track(false, 200), track(true, 356), track(true, 400)];
        let best = pick_best(&results, Some(354)).unwrap();
        assert_eq!(best.duration, Some(356.0));
        assert!(has_synced(best));
    }

    #[test]
    fn pick_rejects_far_matches_without_synced() {
        // Only far-off plain results → no confident match.
        let results = vec![track(false, 100), track(false, 900)];
        assert!(pick_best(&results, Some(354)).is_none());
    }

    #[test]
    fn pick_prefers_close_match_over_far_synced() {
        // A close plain-text hit identifies the right song more reliably
        // than synced lyrics for a wildly different duration.
        let results = vec![track(false, 355), track(true, 500)];
        let best = pick_best(&results, Some(354)).unwrap();
        assert!(!has_synced(best));
        assert_eq!(best.duration, Some(355.0));

        // With no close candidate at all, a far synced result still wins.
        let results = vec![track(false, 900), track(true, 500)];
        let best = pick_best(&results, Some(354)).unwrap();
        assert!(has_synced(best));
    }

    #[test]
    fn cache_roundtrip_synced_plain_and_instrumental() {
        let dir = std::env::temp_dir().join(format!("crtube-lyrics-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let synced = LyricsPayload {
            synced: Some("[00:01.00] hello".into()),
            plain: None,
            instrumental: false,
            track_name: "T".into(),
            artist_name: "A".into(),
            cached: false,
        };
        write_cache(&dir, "vid1", &synced).unwrap();
        let hit = read_cache(&dir, "vid1").unwrap();
        assert!(hit.cached);
        assert_eq!(hit.synced.as_deref(), Some("[00:01.00] hello"));
        assert!(hit.plain.is_none());

        let plain = LyricsPayload {
            synced: None,
            plain: Some("just words".into()),
            instrumental: false,
            track_name: String::new(),
            artist_name: String::new(),
            cached: false,
        };
        write_cache(&dir, "vid2", &plain).unwrap();
        assert_eq!(read_cache(&dir, "vid2").unwrap().plain.as_deref(), Some("just words"));

        // Instrumental-only tracks cache as an empty .txt marker.
        let inst = LyricsPayload {
            synced: None,
            plain: None,
            instrumental: true,
            track_name: String::new(),
            artist_name: String::new(),
            cached: false,
        };
        write_cache(&dir, "vid3", &inst).unwrap();
        let hit = read_cache(&dir, "vid3").unwrap();
        assert!(hit.synced.is_none() && hit.plain.is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Live network check against real LRCLIB: `cargo test -- --ignored lyrics_network`
#[cfg(test)]
#[tokio::test]
#[ignore = "network required"]
async fn lyrics_network_sanity() {
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .unwrap();
    let got = lrclib_get(&client, "Queen", "Bohemian Rhapsody", Some(354))
        .await
        .unwrap()
        .expect("/api/get should find Bohemian Rhapsody");
    assert!(got.synced_lyrics.as_deref().is_some_and(|s| s.contains("[00:")));
}
