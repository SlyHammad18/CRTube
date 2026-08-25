use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::jobs::{JobEntry, JobRegistry};
use crate::services::db::{self, Db, DownloadRecord};
use crate::services::download::{self, DlEvent};
use crate::services::installer;
use crate::services::thumbs;
use crate::services::ytdlp::{self, AudioQuality, DownloadKind, DownloadPlan};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOpts {
    pub url: String,
    pub kind: String,
    pub video_id: String,
    pub title: String,
    pub channel: Option<String>,
    pub duration_s: Option<u64>,
    pub container: Option<String>,
    pub height: Option<u32>,
    pub quality: Option<String>,
    pub thumb_url: Option<String>,
    pub download_dir: Option<String>,
    pub embed_thumbnail: Option<bool>,
    pub embed_metadata: Option<bool>,
    pub expected_size: Option<u64>,
}

#[derive(Serialize)]
pub struct Started {
    pub id: u64,
}

fn parse_kind(s: &str) -> Result<DownloadKind, String> {
    match s {
        "video" => Ok(DownloadKind::Video),
        "audio" => Ok(DownloadKind::Audio),
        other => Err(format!("unknown download kind: {other}")),
    }
}

fn parse_quality(s: &str) -> Result<AudioQuality, String> {
    match s {
        "best" => Ok(AudioQuality::Best),
        "192" => Ok(AudioQuality::Q192),
        "128" => Ok(AudioQuality::Q128),
        other => Err(format!("unknown audio quality: {other}")),
    }
}

fn quality_label(kind: DownloadKind, height: u32, quality: AudioQuality) -> String {
    match kind {
        DownloadKind::Video => format!("{height}p"),
        DownloadKind::Audio => quality.code().to_string(),
    }
}

fn emit_event(app: &AppHandle, event: DlEvent) {
    match event {
        DlEvent::Progress(p) => {
            let _ = app.emit("dl://progress", &p);
        }
        DlEvent::Done(d) => {
            let _ = app.emit("dl://done", &d);
        }
        DlEvent::Failed(e) => {
            let _ = app.emit("dl://error", &e);
        }
        DlEvent::Cancelled => {}
    }
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    registry: State<'_, Arc<JobRegistry>>,
    db: State<'_, Arc<Db>>,
    opts: DownloadOpts,
) -> Result<Started, String> {
    let url = opts.url.trim().to_string();
    if url.is_empty() {
        return Err("empty download url".into());
    }

    let kind = parse_kind(&opts.kind)?;
    let container = match kind {
        DownloadKind::Audio => "mp3".to_string(),
        DownloadKind::Video => opts
            .container
            .clone()
            .unwrap_or_else(|| "mp4".to_string())
            .to_lowercase(),
    };
    if kind == DownloadKind::Video && !["mp4", "webm", "mkv"].contains(&container.as_str()) {
        return Err(format!("unsupported container: {container}"));
    }
    let quality = match &opts.quality {
        Some(q) => parse_quality(q)?,
        None => AudioQuality::Best,
    };

    let settings = crate::commands::settings::load_settings(&app);
    let dir: PathBuf = match &opts.download_dir {
        Some(d) if !d.trim().is_empty() => PathBuf::from(d.trim()),
        _ => settings.effective_download_dir(),
    };
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;

    let bin_dir = installer::bin_dir(&app).map_err(|e| e.to_string())?;
    let plan = DownloadPlan {
        kind,
        container: container.clone(),
        height: opts.height.unwrap_or(1080).max(144),
        quality,
        download_dir: dir,
        title: opts.title.trim().to_string(),
        video_id: opts.video_id.trim().to_string(),
        template: settings.filename_template.clone(),
        embed_thumbnail: opts.embed_thumbnail.unwrap_or(true),
        embed_metadata: opts.embed_metadata.unwrap_or(true),
    };
    if plan.title.is_empty() || plan.video_id.is_empty() {
        return Err("missing video title or id".into());
    }

    if registry.has_video(&plan.video_id) {
        return Err("This video is already downloading".into());
    }
    if let Ok(conn) = db.0.lock() {
        if db::has_download(&conn, &plan.video_id).unwrap_or(false) {
            return Err("This video is already in your library".into());
        }
    }

    let args = ytdlp::download_args(&bin_dir, &plan, &url);
    let mut child = download::spawn_ytdlp(&bin_dir, &args)
        .map_err(|e| format!("failed to spawn yt-dlp: {e}"))?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take();

    let id = registry.insert(JobEntry {
        child,
        stderr,
        video_id: plan.video_id.clone(),
        ext: plan.ext().to_string(),
        dir: plan.download_dir.clone(),
        started: std::time::SystemTime::now(),
    });

    if let Some(thumb_url) = opts.thumb_url.clone() {
        let app2 = app.clone();
        let video_id = plan.video_id.clone();
        tauri::async_runtime::spawn(async move {
            let _ = thumbs::cache_thumbnail(&app2, &video_id, &thumb_url).await;
        });
    }

    let record = DownloadRecord {
        video_id: plan.video_id.clone(),
        url,
        title: plan.title.clone(),
        channel: opts.channel.clone(),
        duration_s: opts.duration_s,
        kind: match plan.kind {
            DownloadKind::Video => "video".to_string(),
            DownloadKind::Audio => "audio".to_string(),
        },
        quality: Some(quality_label(plan.kind, plan.height, plan.quality)),
        container: container.clone(),
        path: String::new(),
        size_bytes: None,
        thumb_url: opts.thumb_url.clone(),
    };
    let video_id = plan.video_id.clone();
    let thumb_remote = opts.thumb_url.clone();
    let db = db.inner().clone();
    let app2 = app.clone();

    let registry = registry.inner().clone();
    tauri::async_runtime::spawn(download::run_download_job(
        id,
        stdout,
        registry,
        opts.expected_size,
        move |event| {
            if let DlEvent::Done(done) = &event {
                let size_bytes = std::fs::metadata(&done.path).ok().map(|m| m.len());
                let thumb_local = thumbs::thumbs_dir(&app2)
                    .map(|p| p.join(format!("{video_id}.jpg")))
                    .filter(|p| p.exists())
                    .map(|p| p.to_string_lossy().to_string());
                let mut record = record.clone();
                record.path = done.path.clone();
                record.size_bytes = size_bytes;
                record.thumb_url = thumb_local.or_else(|| thumb_remote.clone());
                if let Ok(conn) = db.0.lock() {
                    let _ = db::insert_download(&conn, &record);
                }
            }
            emit_event(&app2, event);
        },
    ));

    Ok(Started { id })
}

#[tauri::command]
pub async fn cancel_download(registry: State<'_, Arc<JobRegistry>>, id: u64) -> Result<(), String> {
    let Some(entry) = registry.take(id) else {
        return Ok(());
    };
    let mut child = entry.child;
    child.kill().await.map_err(|e| e.to_string())?;
    download::cleanup_partials(&entry.dir, &entry.video_id);
    Ok(())
}
