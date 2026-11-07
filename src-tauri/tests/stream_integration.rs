use crtube_lib::services::{installer, ytdlp};

fn bin_dir() -> std::path::PathBuf {
    installer::resolve_bin_dir().expect("resolve bin dir (set CRTUBE_BIN_DIR to override)")
}

/// "Me at the zoo" — the canonical tiny, always-available test video.
const VIDEO_ID: &str = "jNQXAC9IVRw";

#[tokio::test]
#[ignore = "requires network and an installed yt-dlp binary"]
async fn stream_video_kind_resolves_a_muxed_progressive_url() {
    let bin = bin_dir();
    let src = ytdlp::extract_stream_source(&bin, VIDEO_ID, ytdlp::StreamKind::Video, "", "")
        .await
        .expect("video stream extraction succeeds");

    assert!(src.url.starts_with("https://"), "progressive https url");
    assert_eq!(src.ext, "mp4", "muxed fallback prefers mp4");
    assert!(
        src.height.is_none_or(|h| h <= 360),
        "preview height capped at 360 for fast startup, got {:?}",
        src.height
    );
    println!("video stream: {:?}p {} {}", src.height, src.ext, src.url);
}

#[tokio::test]
#[ignore = "requires network and an installed yt-dlp binary"]
async fn stream_audio_kind_resolves_an_audio_only_url() {
    let bin = bin_dir();
    let src = ytdlp::extract_stream_source(&bin, VIDEO_ID, ytdlp::StreamKind::Audio, "", "")
        .await
        .expect("audio stream extraction succeeds");

    assert!(src.url.starts_with("https://"), "progressive https url");
    assert!(
        src.height.is_none(),
        "audio-only formats carry no height, got {:?}",
        src.height
    );
    println!("audio stream: {} {}", src.ext, src.url);
}

#[tokio::test]
#[ignore = "requires network and an installed yt-dlp binary"]
async fn resolved_stream_url_serves_range_requests_with_extracted_headers() {
    let bin = bin_dir();
    let src = ytdlp::extract_stream_source(&bin, VIDEO_ID, ytdlp::StreamKind::Video, "", "")
        .await
        .expect("video stream extraction succeeds");

    let mut req = reqwest::Client::new()
        .get(&src.url)
        .header(reqwest::header::RANGE, "bytes=0-1023");
    if let Some(ua) = src.user_agent.as_deref() {
        req = req.header(reqwest::header::USER_AGENT, ua);
    }
    let resp = req.send().await.expect("upstream fetch succeeds");

    assert_eq!(
        resp.status(),
        reqwest::StatusCode::PARTIAL_CONTENT,
        "upstream must honor byte ranges (got {})",
        resp.status()
    );
    let headers = resp.headers().clone();
    let bytes = resp.bytes().await.expect("body readable");
    assert_eq!(bytes.len(), 1024);
    assert!(
        headers
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|cr| cr.starts_with("bytes 0-1023/")),
        "expected Content-Range for the requested slice"
    );
}

#[tokio::test]
#[ignore = "requires network and an installed yt-dlp binary"]
async fn resolved_stream_url_without_ua_still_returns_partial_content() {
    // Sanity: even a bare Range fetch should get 206 from googlevideo when the
    // extraction used the same client defaults; if YouTube ever starts
    // enforcing the UA, this test failing signals the proxy MUST send it.
    let bin = bin_dir();
    let src = ytdlp::extract_stream_source(&bin, VIDEO_ID, ytdlp::StreamKind::Video, "", "")
        .await
        .expect("video stream extraction succeeds");

    let resp = reqwest::Client::new()
        .get(&src.url)
        .header(reqwest::header::RANGE, "bytes=0-1023")
        .send()
        .await
        .expect("upstream fetch succeeds");

    assert!(
        resp.status().is_success(),
        "expected 2xx from googlevideo, got {}",
        resp.status()
    );
}
