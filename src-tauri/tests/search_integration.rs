use crtube_lib::services::{installer, ytdlp};

fn bin_dir() -> std::path::PathBuf {
    installer::resolve_bin_dir().expect("resolve bin dir (set CRTUBE_BIN_DIR to override)")
}

#[tokio::test]
#[ignore = "requires network and an installed yt-dlp binary"]
async fn search_known_query_returns_typed_items() {
    let bin = bin_dir();
    let items = ytdlp::search_youtube(&bin, "lofi hip hop", 1)
        .await
        .expect("search succeeds");

    assert!(!items.is_empty(), "expected at least one result");
    let first = &items[0];
    assert!(!first.video_id.is_empty());
    assert!(!first.title.is_empty());
    assert!(first.thumb_url.is_some());

    for item in items.iter().take(5) {
        println!(
            "{} | {} | {:?} | {:?}s",
            item.video_id, item.title, item.channel, item.duration_s
        );
    }
}

#[tokio::test]
#[ignore = "requires network and an installed yt-dlp binary"]
async fn probe_known_url_returns_normalized_info() {
    let bin = bin_dir();
    let info = ytdlp::fetch_info(&bin, "https://www.youtube.com/watch?v=jNQXAC9IVRw")
        .await
        .expect("probe succeeds");

    assert_eq!(info.video_id, "jNQXAC9IVRw");
    assert!(!info.title.is_empty());
    assert_eq!(info.duration_s, Some(19));
    assert!(!info.is_live);
    assert!(!info.formats.is_empty(), "expected normalized formats");

    for fmt in info.formats.iter().take(6) {
        println!(
            "{:?}p {:?}fps {} {:?}",
            fmt.height, fmt.fps, fmt.ext, fmt.filesize
        );
    }
}
