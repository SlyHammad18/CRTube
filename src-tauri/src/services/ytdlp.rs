use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use super::installer::{prepended_path, ytdlp_path};

const SEARCH_PAGE_SIZE: u64 = 20;
const SEARCH_TIMEOUT_SECS: u64 = 40;
const PROBE_TIMEOUT_SECS: u64 = 60;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchItem {
    pub video_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_s: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub views: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    pub height: Option<u32>,
    pub fps: Option<u32>,
    pub ext: String,
    pub filesize: Option<u64>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub video_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_s: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb_url: Option<String>,
    pub is_live: bool,
    pub formats: Vec<FormatInfo>,
}

#[derive(Debug)]
pub enum YtDlpError {
    Spawn(String),
    Timeout,
    Failed(String),
    Parse(String),
}

impl std::fmt::Display for YtDlpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Spawn(m) => write!(f, "failed to launch yt-dlp: {m}"),
            Self::Timeout => write!(f, "yt-dlp timed out"),
            Self::Failed(m) => write!(f, "{m}"),
            Self::Parse(m) => write!(f, "unexpected yt-dlp output: {m}"),
        }
    }
}

impl std::error::Error for YtDlpError {}

type Result<T> = std::result::Result<T, YtDlpError>;

pub fn search_args(query: &str, page: u32) -> Vec<String> {
    let count = page.max(1) as u64 * SEARCH_PAGE_SIZE;
    vec![
        format!("ytsearch{count}:{query}"),
        "--flat-playlist".to_string(),
        "--dump-json".to_string(),
    ]
}

pub fn probe_args(url: &str) -> Vec<String> {
    vec![
        "--dump-single-json".to_string(),
        "--no-playlist".to_string(),
        url.to_string(),
    ]
}

fn value_str(v: &Value, key: &str) -> Option<String> {
    v.get(key)?.as_str().filter(|s| !s.is_empty()).map(String::from)
}

fn value_u64(v: &Value, key: &str) -> Option<u64> {
    v.get(key)?.as_f64().map(|f| f.max(0.0) as u64)
}

pub fn normalize_search_entry(entry: &Value) -> Option<SearchItem> {
    let entry_type = entry.get("_type").and_then(Value::as_str).unwrap_or("url");
    if entry_type != "url" {
        return None;
    }
    let video_id = value_str(entry, "id")?;
    let title = value_str(entry, "title")?;
    let channel = value_str(entry, "channel")
        .or_else(|| value_str(entry, "uploader"))
        .or_else(|| value_str(entry, "channel_name"));

    let thumb_url = entry
        .get("thumbnails")
        .and_then(Value::as_array)
        .and_then(|thumbs| {
            thumbs
                .iter()
                .filter_map(|t| {
                    let url = t.get("url")?.as_str()?.to_string();
                    let width = t.get("width").and_then(Value::as_u64).unwrap_or(0);
                    Some((width, url))
                })
                .max_by_key(|(w, _)| *w)
                .map(|(_, url)| url)
        })
        .or_else(|| value_str(entry, "thumbnail"))
        .or_else(|| Some(format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")));

    Some(SearchItem {
        video_id,
        title,
        channel,
        duration_s: value_u64(entry, "duration"),
        views: value_u64(entry, "view_count"),
        thumb_url,
    })
}

pub fn parse_search_output(stdout: &str) -> Result<Vec<SearchItem>> {
    let mut items = Vec::new();
    let mut saw_line = false;
    for line in stdout.lines().filter(|l| !l.trim().is_empty()) {
        saw_line = true;
        if let Ok(entry) = serde_json::from_str::<Value>(line) {
            if let Some(item) = normalize_search_entry(&entry) {
                items.push(item);
            }
        }
    }
    if saw_line && items.is_empty() {
        return Err(YtDlpError::Parse("no usable search entries".into()));
    }
    Ok(items)
}

fn norm_format(v: &Value) -> Option<FormatInfo> {
    let ext = value_str(v, "ext")?;
    if ext == "mhtml" {
        return None;
    }
    let vcodec = v.get("vcodec").and_then(Value::as_str).map(String::from);
    let acodec = v.get("acodec").and_then(Value::as_str).map(String::from);
    if vcodec.as_deref() == Some("none") && acodec.as_deref() == Some("none") {
        return None;
    }
    let height = v.get("height").and_then(Value::as_u64).map(|h| h as u32);
    if height.is_none() && vcodec.is_none() && acodec.is_none() {
        return None;
    }
    Some(FormatInfo {
        height,
        fps: v.get("fps").and_then(Value::as_f64).map(|f| f as u32),
        ext,
        filesize: v
            .get("filesize")
            .and_then(Value::as_u64)
            .or_else(|| v.get("filesize_approx").and_then(Value::as_u64)),
        vcodec,
        acodec,
    })
}

pub fn normalize_formats(formats: &[Value]) -> Vec<FormatInfo> {
    let mut best: Vec<(String, FormatInfo)> = Vec::new();
    for raw in formats {
        let Some(fmt) = norm_format(raw) else {
            continue;
        };
        let key = format!("{:?}|{}", fmt.height, fmt.ext);
        match best.iter_mut().find(|(k, _)| *k == key) {
            Some((_, existing)) => {
                if fmt.filesize.unwrap_or(0) > existing.filesize.unwrap_or(0) {
                    *existing = fmt;
                }
            }
            None => best.push((key, fmt)),
        }
    }
    best.sort_by(|a, b| {
        let ka = (a.1.height.unwrap_or(0), &a.1.ext);
        let kb = (b.1.height.unwrap_or(0), &b.1.ext);
        kb.cmp(&ka)
    });
    best.into_iter().map(|(_, f)| f).collect()
}

pub fn normalize_info(payload: &Value) -> Result<VideoInfo> {
    let video_id = payload
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| YtDlpError::Parse("missing video id".into()))?
        .to_string();
    let title = value_str(payload, "title")
        .ok_or_else(|| YtDlpError::Parse("missing video title".into()))?;

    let formats = payload
        .get("formats")
        .and_then(Value::as_array)
        .map(|a| normalize_formats(a))
        .unwrap_or_default();

    Ok(VideoInfo {
        video_id,
        title,
        channel: value_str(payload, "channel").or_else(|| value_str(payload, "uploader")),
        duration_s: value_u64(payload, "duration"),
        thumb_url: value_str(payload, "thumbnail"),
        is_live: payload.get("is_live").and_then(Value::as_bool).unwrap_or(false),
        formats,
    })
}

async fn run_ytdlp(bin: &Path, args: &[String], timeout_secs: u64) -> Result<String> {
    let child = tokio::process::Command::new(ytdlp_path(bin))
        .args(args)
        .env("PATH", prepended_path(bin))
        .kill_on_drop(true)
        .output();

    let output = tokio::time::timeout(Duration::from_secs(timeout_secs), child)
        .await
        .map_err(|_| YtDlpError::Timeout)?
        .map_err(|e| YtDlpError::Spawn(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: Vec<&str> = stderr.lines().rev().take(4).collect();
        let tail = tail.into_iter().rev().collect::<Vec<_>>().join(" | ");
        return Err(YtDlpError::Failed(if tail.is_empty() {
            format!("yt-dlp exited with {}", output.status)
        } else {
            tail
        }));
    }
    String::from_utf8(output.stdout).map_err(|_| YtDlpError::Parse("stdout not utf8".into()))
}

fn page_slice(items: Vec<SearchItem>, page: u32) -> Vec<SearchItem> {
    let page = page.max(1);
    let start = ((page as u64 - 1) * SEARCH_PAGE_SIZE) as usize;
    let end = (page as u64 * SEARCH_PAGE_SIZE) as usize;
    if start >= items.len() {
        return Vec::new();
    }
    items[start..items.len().min(end)].to_vec()
}

pub async fn search_youtube(
    bin: &Path,
    query: &str,
    page: u32,
) -> Result<Vec<SearchItem>> {
    let stdout = run_ytdlp(bin, &search_args(query, page), SEARCH_TIMEOUT_SECS).await?;
    let all = parse_search_output(&stdout)?;
    Ok(page_slice(all, page))
}

pub async fn fetch_info(bin: &Path, url: &str) -> Result<VideoInfo> {
    let stdout = run_ytdlp(bin, &probe_args(url), PROBE_TIMEOUT_SECS).await?;
    let payload = serde_json::from_str::<Value>(&stdout)
        .map_err(|e| YtDlpError::Parse(e.to_string()))?;
    normalize_info(&payload)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn search_args_follow_pinned_invocation() {
        assert_eq!(
            search_args("lofi mix", 1),
            vec![
                "ytsearch20:lofi mix".to_string(),
                "--flat-playlist".to_string(),
                "--dump-json".to_string()
            ]
        );
        assert_eq!(search_args("q", 3)[0], "ytsearch60:q");
        assert_eq!(search_args("q", 0)[0], "ytsearch20:q");
    }

    #[test]
    fn probe_args_follow_pinned_invocation() {
        assert_eq!(
            probe_args("https://youtu.be/x?v=2"),
            vec![
                "--dump-single-json".to_string(),
                "--no-playlist".to_string(),
                "https://youtu.be/x?v=2".to_string()
            ]
        );
    }

    #[test]
    fn parses_flat_search_entries_and_skips_junk() {
        let stdout = concat!(
            r#"{"_type":"url","id":"abc123def45","title":"A Song","channel":"Ch A","duration":214.0,"view_count":1048576,"thumbnails":[{"url":"https://t/low.jpg","width":168},{"url":"https://t/high.jpg","width":1280}]}"#,
            "\n",
            "\n",
            r#"{"_type":"playlist","id":"PLxyz","title":"Some Mixtape"}"#,
            "\n",
            "not json at all\n"
        );
        let items = parse_search_output(stdout).expect("parses");
        assert_eq!(items.len(), 1);
        let item = &items[0];
        assert_eq!(item.video_id, "abc123def45");
        assert_eq!(item.title, "A Song");
        assert_eq!(item.channel.as_deref(), Some("Ch A"));
        assert_eq!(item.duration_s, Some(214));
        assert_eq!(item.views, Some(1048576));
        assert_eq!(item.thumb_url.as_deref(), Some("https://t/high.jpg"));
    }

    #[test]
    fn falls_back_to_hqdefault_thumb() {
        let entry = json!({"id":"zzzz9999abc","title":"No Thumbs"});
        let item = normalize_search_entry(&entry).unwrap();
        assert_eq!(
            item.thumb_url.as_deref(),
            Some("https://i.ytimg.com/vi/zzzz9999abc/hqdefault.jpg")
        );
    }

    #[test]
    fn empty_output_is_empty_not_error() {
        assert!(parse_search_output("\n\n").unwrap().is_empty());
    }

    #[test]
    fn normalizes_formats_dedupes_and_sorts() {
        let formats = json!([
            {"ext":"mhtml","vcodec":"none","acodec":"none"},
            {"ext":"mp4","height":1080,"fps":30,"vcodec":"avc1","acodec":"mp4a","filesize":100},
            {"ext":"mp4","height":1080,"fps":30,"vcodec":"avc1","acodec":"mp4a","filesize":900},
            {"ext":"webm","height":720,"fps":60,"vcodec":"vp9","filesize_approx":500},
            {"ext":"m4a","vcodec":"none","acodec":"mp4a","filesize":4000},
            {"ext":"webm","height":null,"fps":null,"vcodec":"none","acodec":"opus"}
        ])
        .as_array()
        .unwrap()
        .clone();

        let out = normalize_formats(&formats);
        assert_eq!(out.len(), 4);

        assert_eq!(out[0].height, Some(1080));
        assert_eq!(out[0].ext, "mp4");
        assert_eq!(out[0].filesize, Some(900));

        assert_eq!(out[1].height, Some(720));
        assert_eq!(out[1].fps, Some(60));
        assert_eq!(out[1].filesize, Some(500));

        let audio: Vec<_> = out
            .iter()
            .filter(|f| f.height.is_none())
            .map(|f| f.ext.as_str())
            .collect();
        assert_eq!(audio, vec!["webm", "m4a"]);
        assert!(out.iter().all(|f| f.ext != "mhtml"));
    }

    #[test]
    fn normalizes_full_probe_payload() {
        let payload = json!({
            "id": "jNQXAC9IVRw",
            "title": "Me at the zoo",
            "uploader": "jawed",
            "duration": 19.0,
            "thumbnail": "https://thumb/z.jpg",
            "is_live": false,
            "formats": [
                {"ext":"mp4","height":360,"fps":30,"vcodec":"avc1","acodec":"mp4a"}
            ]
        });
        let info = normalize_info(&payload).unwrap();
        assert_eq!(info.video_id, "jNQXAC9IVRw");
        assert_eq!(info.title, "Me at the zoo");
        assert_eq!(info.channel.as_deref(), Some("jawed"));
        assert_eq!(info.duration_s, Some(19));
        assert_eq!(info.formats.len(), 1);
        assert!(!info.is_live);
    }

    #[test]
    fn rejects_payload_without_identity() {
        let err = normalize_info(&json!({"title": "no id"}));
        assert!(err.is_err());
    }

    #[test]
    fn page_slices_cumulative_results() {
        let items: Vec<SearchItem> = (0..45u32)
            .map(|i| SearchItem {
                video_id: format!("v{i:02}"),
                title: format!("T{i}"),
                channel: None,
                duration_s: None,
                views: None,
                thumb_url: None,
            })
            .collect();
        let page2 = page_slice(items.clone(), 2);
        assert_eq!(page2.len(), 20);
        assert_eq!(page2[0].video_id, "v20");
        assert_eq!(page2[19].video_id, "v39");

        let page3 = page_slice(items.clone(), 3);
        assert_eq!(page3.len(), 5);
        assert_eq!(page3[0].video_id, "v40");

        assert!(page_slice(Vec::new(), 1).is_empty());
        assert_eq!(page_slice(items.clone(), 99).len(), 0);
    }
}
