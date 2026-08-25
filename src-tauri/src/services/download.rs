use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, ChildStdout};

use super::installer::{prepended_path, ytdlp_path};
use super::ytdlp::{compute_metrics, parse_progress_line};
use crate::jobs::JobRegistry;

const EMIT_INTERVAL: Duration = Duration::from_millis(150);

#[derive(Debug, Clone, Serialize)]
pub struct DlProgress {
    pub id: u64,
    pub pct: f64,
    pub speed_bps: Option<u64>,
    pub eta_s: Option<u64>,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub stage: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DlDone {
    pub id: u64,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DlError {
    pub id: u64,
    pub message: String,
}

#[derive(Debug, Clone)]
pub enum DlEvent {
    Progress(DlProgress),
    Done(DlDone),
    Failed(DlError),
    Cancelled,
}

pub fn spawn_ytdlp(bin_dir: &Path, args: &[String]) -> std::io::Result<Child> {
    tokio::process::Command::new(ytdlp_path(bin_dir))
        .args(args)
        .env("PATH", prepended_path(bin_dir))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
}

pub fn find_final_file(
    dir: &Path,
    video_id: &str,
    ext: &str,
    after: std::time::SystemTime,
) -> Option<PathBuf> {
    let marker = format!("[{video_id}]");
    let mut marker_best: Option<(std::time::SystemTime, PathBuf)> = None;
    let mut fallback_best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        let name = path.file_name()?.to_string_lossy().to_string();
        let modified = entry.metadata().and_then(|m| m.modified()).ok()?;
        let marker_hit = !video_id.is_empty() && name.contains(&marker) && name.ends_with(ext);
        let fallback_hit = name.ends_with(ext) && modified >= after;
        if marker_hit
            && marker_best
                .as_ref()
                .map(|(t, _)| modified > *t)
                .unwrap_or(true)
        {
            marker_best = Some((modified, path));
        } else if fallback_hit
            && fallback_best
                .as_ref()
                .map(|(t, _)| modified > *t)
                .unwrap_or(true)
        {
            fallback_best = Some((modified, path));
        }
    }
    marker_best
        .or(fallback_best)
        .map(|(_, p)| p)
}

pub fn cleanup_partials(dir: &Path, video_id: &str) -> usize {
    let marker = format!("[{video_id}]");
    let mut removed = 0;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().map(|n| n.to_string_lossy().to_string()) else {
                continue;
            };
            if !name.contains(&marker) {
                continue;
            }
            let is_partial = name.ends_with(".part")
                || name.contains(".part-")
                || name.ends_with(".ytdl")
                || name.contains(".temp")
                || name.ends_with(".webp")
                || name.ends_with(".jpg")
                || name.ends_with(".jpeg")
                || name.ends_with(".png");
            if is_partial && std::fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

pub async fn run_download_job(
    id: u64,
    stdout: ChildStdout,
    registry: Arc<JobRegistry>,
    fallback_total: Option<u64>,
    on_event: impl Fn(DlEvent),
) {
    let mut lines = BufReader::new(stdout).lines();
    let start = Instant::now();
    let mut prev: Option<(f64, u64)> = None;
    let mut last_emit = Instant::now() - EMIT_INTERVAL;
    let mut stage = "download".to_string();
    let mut last_downloaded: u64 = 0;
    let mut last_total: Option<u64> = None;
    let mut last_pct: f64 = 0.0;
    let mut stream_offset: u64 = 0;
    let mut stream_downloaded: u64 = 0;

    while let Ok(Some(line)) = lines.next_line().await {
        if line.contains("[download] Destination:") {
            stream_offset += stream_downloaded;
            stream_downloaded = 0;
            prev = None;
            continue;
        }
        let Some((downloaded, total)) = parse_progress_line(&line) else {
            let new_stage = if line.contains("[Merger]") {
                Some("merging")
            } else if line.contains("[ExtractAudio]") {
                Some("extracting audio")
            } else if line.contains("[EmbedThumbnail]") || line.contains("[Metadata]") {
                Some("embedding tags")
            } else {
                None
            };
            if let Some(s) = new_stage {
                if stage != s {
                    stage = s.to_string();
                    on_event(DlEvent::Progress(DlProgress {
                        id,
                        pct: last_pct,
                        speed_bps: None,
                        eta_s: None,
                        downloaded: last_downloaded,
                        total: last_total,
                        stage: stage.clone(),
                    }));
                    last_emit = Instant::now();
                }
            }
            continue;
        };
        let effective_total = total.or(fallback_total);
        stream_downloaded = downloaded;
        let cumulative = stream_offset.saturating_add(downloaded);
        let secs = start.elapsed().as_secs_f64();
        let (pct, speed, eta) = compute_metrics(prev, secs, cumulative, effective_total);
        prev = Some((secs, cumulative));
        last_downloaded = cumulative;
        last_total = effective_total;
        last_pct = pct;
        if last_emit.elapsed() >= EMIT_INTERVAL {
            on_event(DlEvent::Progress(DlProgress {
                id,
                pct,
                speed_bps: speed,
                eta_s: eta,
                downloaded: cumulative,
                total: effective_total,
                stage: stage.clone(),
            }));
            last_emit = Instant::now();
        }
    }

    let Some(mut entry) = registry.take(id) else {
        return;
    };

    let status = entry.child.wait().await;
    let stderr = match entry.stderr.take() {
        Some(mut err) => {
            let mut buf = String::new();
            use tokio::io::AsyncReadExt;
            let _ = err.read_to_string(&mut buf).await;
            buf
        }
        None => String::new(),
    };

    match status {
        Ok(s) if s.success() => {
            match find_final_file(&entry.dir, &entry.video_id, &entry.ext, entry.started) {
                Some(path) => on_event(DlEvent::Done(DlDone {
                    id,
                    path: path.to_string_lossy().to_string(),
                })),
                None => {
                    cleanup_partials(&entry.dir, &entry.video_id);
                    on_event(DlEvent::Failed(DlError {
                        id,
                        message: "download finished but output file is missing".into(),
                    }));
                }
            }
        }
        _ => {
            cleanup_partials(&entry.dir, &entry.video_id);
            let tail: Vec<&str> = stderr.lines().rev().take(4).collect();
            let tail = tail.into_iter().rev().collect::<Vec<_>>().join(" | ");
            on_event(DlEvent::Failed(DlError {
                id,
                message: if tail.is_empty() {
                    format!("yt-dlp exited with {}", status.map(|s| s.to_string()).unwrap_or_else(|_| "error".into()))
                } else {
                    tail
                },
            }));
        }
    }
}
