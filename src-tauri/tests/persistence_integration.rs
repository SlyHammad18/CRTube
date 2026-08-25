use std::path::PathBuf;
use std::sync::Arc;

use crtube_lib::jobs::JobRegistry;
use crtube_lib::services::db::{self, Db, DownloadRecord};
use crtube_lib::services::download::{self, run_download_job, DlEvent};
use crtube_lib::services::installer;
use crtube_lib::services::ytdlp::{download_args, AudioQuality, DownloadKind, DownloadPlan};
use std::sync::Mutex as StdMutex;

fn bin_dir() -> PathBuf {
    installer::resolve_bin_dir().expect("resolve bin dir")
}

#[tokio::test]
#[ignore = "requires network and installed yt-dlp/ffmpeg"]
async fn download_lands_in_db_and_persists_across_restart() {
    let bin = bin_dir();
    let work = std::env::temp_dir().join(format!(
        "crtube-t5-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    ));
    let dl_dir = work.join("downloads");
    std::fs::create_dir_all(&dl_dir).unwrap();

    let plan = DownloadPlan {
        kind: DownloadKind::Video,
        container: "mp4".to_string(),
        height: 720,
        quality: AudioQuality::Best,
        download_dir: dl_dir.clone(),
        title: "Me at the zoo".to_string(),
        video_id: "jNQXAC9IVRw".to_string(),
        template: None,
    };
    let args = download_args(&bin, &plan, "https://www.youtube.com/watch?v=jNQXAC9IVRw");
    let mut child = download::spawn_ytdlp(&bin, &args).expect("spawn");
    let stdout = child.stdout.take().expect("stdout");
    let stderr = child.stderr.take();

    let registry = Arc::new(JobRegistry::default());
    let events: Arc<StdMutex<Vec<DlEvent>>> = Arc::new(StdMutex::new(Vec::new()));
    let sink = events.clone();
    let id = registry.insert(crtube_lib::jobs::JobEntry {
        child,
        stderr,
        video_id: plan.video_id.clone(),
        ext: plan.ext().to_string(),
        dir: dl_dir.clone(),
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
        .expect("download completes");
    let final_path = PathBuf::from(&done.path);
    assert!(final_path.exists());

    let size_bytes = std::fs::metadata(&final_path).unwrap().len();

    let record = DownloadRecord {
        video_id: "jNQXAC9IVRw".to_string(),
        url: "https://www.youtube.com/watch?v=jNQXAC9IVRw".to_string(),
        title: "Me at the zoo".to_string(),
        channel: Some("jawed".to_string()),
        duration_s: Some(19),
        kind: "video".to_string(),
        quality: Some("720p".to_string()),
        container: "mp4".to_string(),
        path: done.path.clone(),
        size_bytes: Some(size_bytes),
        thumb_url: None,
    };

    let db_path = work.join("library.db");
    let conn = db::open(&db_path).expect("open db");
    let row_id = db::insert_download(&conn, &record).expect("insert");
    drop(conn);

    let restart = db::open(&db_path).expect("reopen db (restart simulation)");
    assert!(db::has_download(&restart, "jNQXAC9IVRw").unwrap());

    let entries = db::list_and_sync_statuses(&restart).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].id, row_id);
    assert_eq!(entries[0].status, "done");
    assert_eq!(entries[0].size_bytes, Some(size_bytes));
    assert_eq!(entries[0].path, done.path);
    drop(restart);

    let vanished = work.join("moved.mp4");
    std::fs::rename(&final_path, &vanished).unwrap();
    let restart2 = db::open(&db_path).unwrap();
    let entries = db::list_and_sync_statuses(&restart2).unwrap();
    assert_eq!(entries[0].status, "missing");

    std::fs::rename(&vanished, &final_path).unwrap();
    let entries = db::list_and_sync_statuses(&restart2).unwrap();
    assert_eq!(entries[0].status, "done");

    let _ = std::fs::remove_dir_all(&work);
    let _ = Db;
}
