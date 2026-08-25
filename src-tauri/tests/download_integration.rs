use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crtube_lib::jobs::JobRegistry;
use crtube_lib::services::download::{
    self, cleanup_partials, find_final_file, run_download_job, DlEvent,
};
use crtube_lib::services::installer;
use crtube_lib::services::ytdlp::{download_args, AudioQuality, DownloadKind, DownloadPlan};

fn bin_dir() -> PathBuf {
    installer::resolve_bin_dir().expect("resolve bin dir (set CRTUBE_BIN_DIR to override)")
}

fn unique_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "crtube-t4-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn plan(kind: DownloadKind, dir: &std::path::Path, quality: AudioQuality) -> DownloadPlan {
    DownloadPlan {
        kind,
        container: "mp4".to_string(),
        height: 720,
        quality,
        download_dir: dir.to_path_buf(),
        title: "Me at the zoo".to_string(),
        video_id: "jNQXAC9IVRw".to_string(),
        template: None,
    }
}

fn ffprobe_json(path: &PathBuf) -> serde_json::Value {
    let out = std::process::Command::new(bin_dir().join("ffprobe"))
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            path.to_string_lossy().to_string().as_str(),
        ])
        .output()
        .expect("ffprobe runs");
    assert!(out.status.success(), "ffprobe failed on {path:?}");
    serde_json::from_slice(&out.stdout).expect("ffprobe json")
}

async fn wait_for_progress(events: &Arc<Mutex<Vec<DlEvent>>>, timeout: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if events
            .lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e, DlEvent::Progress(p) if p.downloaded > 0))
        {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    false
}

#[tokio::test]
#[ignore = "requires network and installed yt-dlp/ffmpeg"]
async fn downloads_tiny_video_as_mp4() {
    let bin = bin_dir();
    let dir = unique_dir("mp4");
    let p = plan(DownloadKind::Video, &dir, AudioQuality::Best);
    let url = "https://www.youtube.com/watch?v=jNQXAC9IVRw".to_string();

    let args = download_args(&bin, &p, &url);
    let mut child = download::spawn_ytdlp(&bin, &args).expect("spawn");
    let stdout = child.stdout.take().expect("stdout");
    let stderr = child.stderr.take();

    let registry = Arc::new(JobRegistry::default());
    let events: Arc<Mutex<Vec<DlEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let id = registry.insert(crtube_lib::jobs::JobEntry {
        child,
        stderr,
        video_id: p.video_id.clone(),
        ext: p.ext().to_string(),
        dir: dir.clone(),
        started: std::time::SystemTime::now(),
    });

    run_download_job(
        id,
        stdout,
        registry,
        move |e| sink.lock().unwrap().push(e),
    )
    .await;

    let events = events.lock().unwrap();
    let done = events
        .iter()
        .find_map(|e| match e {
            DlEvent::Done(d) => Some(d.clone()),
            _ => None,
        })
        .expect("download completes");
    assert!(events
        .iter()
        .any(|e| matches!(e, DlEvent::Progress(pr) if pr.downloaded > 0)));

    let path = PathBuf::from(&done.path);
    assert!(path.exists(), "final file exists at {:?}", done.path);
    assert!(done.path.ends_with(".mp4"));

    let probe = ffprobe_json(&path);
    let format_name = probe["format"]["format_name"].as_str().unwrap();
    assert!(format_name.contains("mp4"), "container is mp4: {format_name}");
    let duration: f64 = probe["format"]["duration"].as_str().unwrap().parse().unwrap();
    assert!((17.0..=21.0).contains(&duration), "duration ~19s, got {duration}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
#[ignore = "requires network and installed yt-dlp/ffmpeg"]
async fn downloads_mp3_best_with_cover_and_tags() {
    let bin = bin_dir();
    let dir = unique_dir("mp3");
    let p = plan(DownloadKind::Audio, &dir, AudioQuality::Best);
    let url = "https://www.youtube.com/watch?v=jNQXAC9IVRw".to_string();

    let args = download_args(&bin, &p, &url);
    let mut child = download::spawn_ytdlp(&bin, &args).expect("spawn");
    let stdout = child.stdout.take().expect("stdout");
    let stderr = child.stderr.take();

    let registry = Arc::new(JobRegistry::default());
    let events: Arc<Mutex<Vec<DlEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let id = registry.insert(crtube_lib::jobs::JobEntry {
        child,
        stderr,
        video_id: p.video_id.clone(),
        ext: "mp3".to_string(),
        dir: dir.clone(),
        started: std::time::SystemTime::now(),
    });

    run_download_job(id, stdout, registry, move |e| {
        sink.lock().unwrap().push(e)
    })
    .await;

    let done = events
        .lock()
        .unwrap()
        .iter()
        .find_map(|e| match e {
            DlEvent::Done(d) => Some(d.clone()),
            _ => None,
        })
        .expect("mp3 download completes");

    let path = PathBuf::from(&done.path);
    assert!(path.exists(), "mp3 exists at {:?}", done.path);

    let probe = ffprobe_json(&path);
    let format_name = probe["format"]["format_name"].as_str().unwrap();
    assert!(format_name.contains("mp3"), "format is mp3: {format_name}");

    let title = probe["format"]["tags"]["title"].as_str().unwrap_or("");
    assert!(!title.is_empty(), "ID3 title tag embedded, got: {title:?}");

    let has_cover = probe["streams"]
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["disposition"]["attached_pic"].as_i64() == Some(1));
    assert!(has_cover, "embedded cover art stream present");

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
#[ignore = "requires network and installed yt-dlp/ffmpeg"]
async fn cancel_mid_download_leaves_no_partial_files() {
    let bin = bin_dir();
    let dir = unique_dir("cancel");
    let mut p = plan(DownloadKind::Video, &dir, AudioQuality::Best);
    p.video_id = "n61ULEU7CO0".to_string();
    p.title = "Best of lofi hip hop 2021".to_string();
    let url = "https://www.youtube.com/watch?v=n61ULEU7CO0".to_string();

    let args = download_args(&bin, &p, &url);
    let mut child = download::spawn_ytdlp(&bin, &args).expect("spawn");
    let stdout = child.stdout.take().expect("stdout");
    let stderr = child.stderr.take();

    let registry = Arc::new(JobRegistry::default());
    let events: Arc<Mutex<Vec<DlEvent>>> = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let id = registry.insert(crtube_lib::jobs::JobEntry {
        child,
        stderr,
        video_id: p.video_id.clone(),
        ext: p.ext().to_string(),
        dir: dir.clone(),
        started: std::time::SystemTime::now(),
    });

    let runner = tokio::spawn(run_download_job(id, stdout, registry.clone(), move |e| {
        sink.lock().unwrap().push(e)
    }));

    assert!(
        wait_for_progress(&events, Duration::from_secs(90)).await,
        "download made progress before cancel"
    );

    let entry = registry.take(id).expect("job still registered");
    let mut child = entry.child;
    child.kill().await.expect("kill");
    cleanup_partials(&entry.dir, &entry.video_id);

    let _ = tokio::time::timeout(Duration::from_secs(15), runner).await;

    let leftovers: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect();
    assert!(
        leftovers.is_empty(),
        "no partial or final files after cancel, found: {leftovers:?}"
    );

    let events = events.lock().unwrap();
    assert!(
        !events.iter().any(|e| matches!(e, DlEvent::Done(_))),
        "no done event after cancel"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
#[ignore = "requires network and installed yt-dlp/ffmpeg"]
async fn find_final_file_ignores_partials() {
    let dir = unique_dir("find");
    let now = std::time::SystemTime::now();
    std::fs::write(dir.join("Me at the zoo [jNQXAC9IVRw].mp4.part"), "x").unwrap();
    std::fs::write(dir.join("Me at the zoo [jNQXAC9IVRw].mp4"), "x").unwrap();
    std::fs::write(dir.join("Me at the zoo [jNQXAC9IVRw].webp"), "x").unwrap();
    let found = find_final_file(&dir, "jNQXAC9IVRw", "mp4", now).expect("finds final");
    assert!(found.to_string_lossy().ends_with(".mp4"));
    assert_eq!(cleanup_partials(&dir, "jNQXAC9IVRw"), 2);
    assert!(find_final_file(&dir, "jNQXAC9IVRw", "mp4", now).is_some());
    let _ = std::fs::remove_dir_all(&dir);
}
