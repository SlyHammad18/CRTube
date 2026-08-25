use std::fs::{self, File};
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

const YT_DLP_RELEASE_API: &str =
    "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const YT_DLP_ASSET_LINUX: &str = "yt-dlp";
const YT_DLP_ASSET_WINDOWS: &str = "yt-dlp.exe";
const YT_DLP_ASSET_MACOS: &str = "yt-dlp_macos";
const YT_DLP_CHECKSUMS_ASSET: &str = "SHA2-256SUMS";

const FFMPEG_LINUX_AMD64: &str =
    "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz";
const FFMPEG_LINUX_ARM64: &str =
    "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz";
const FFMPEG_WINDOWS_WIN64: &str =
    "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip";
const FFMPEG_MACOS_UNIVERSAL: &str = "https://evermeet.cx/ffmpeg/getrelease/zip";

#[derive(Debug, Clone, Serialize)]
pub struct ProgressPayload {
    pub tool: String,
    pub stage: String,
    pub pct: u8,
}

#[derive(Debug)]
pub enum ToolError {
    Network(String),
    ChecksumMismatch { asset: String },
    ChecksumUnavailable,
    UnsupportedPlatform,
    Archive(String),
    Io(std::io::Error),
}

impl std::fmt::Display for ToolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Network(m) => write!(f, "network error: {m}"),
            Self::ChecksumMismatch { asset } => {
                write!(f, "sha256 mismatch for {asset}")
            }
            Self::ChecksumUnavailable => write!(f, "release checksums file unavailable"),
            Self::UnsupportedPlatform => write!(f, "platform unsupported"),
            Self::Archive(m) => write!(f, "archive error: {m}"),
            Self::Io(e) => write!(f, "io error: {e}"),
        }
    }
}

impl std::error::Error for ToolError {}

impl From<std::io::Error> for ToolError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

type Result<T> = std::result::Result<T, ToolError>;

#[derive(Deserialize)]
pub struct GhAsset {
    pub name: String,
    pub browser_download_url: String,
}

#[derive(Deserialize)]
pub struct GhRelease {
    pub tag_name: String,
    pub assets: Vec<GhAsset>,
}

pub struct LatestRelease {
    pub tag: String,
    pub asset_url: String,
    pub sums_url: Option<String>,
}

pub fn yt_dlp_asset_name() -> &'static str {
    match std::env::consts::OS {
        "windows" => YT_DLP_ASSET_WINDOWS,
        "macos" => YT_DLP_ASSET_MACOS,
        _ => YT_DLP_ASSET_LINUX,
    }
}

pub fn bin_dir(app: &AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| ToolError::Network(e.to_string()))?
        .join("bin"))
}

pub fn ytdlp_path(bin: &Path) -> PathBuf {
    bin.join(yt_dlp_asset_name())
}

pub fn ffmpeg_path(bin: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    return bin.join("ffmpeg.exe");
    #[cfg(not(target_os = "windows"))]
    bin.join("ffmpeg")
}

pub fn ffprobe_path(bin: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    return bin.join("ffprobe.exe");
    #[cfg(not(target_os = "windows"))]
    bin.join("ffprobe")
}

pub fn parse_checksums(sums: &str, asset: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?;
        (name == asset).then(|| hash.to_ascii_lowercase())
    })
}

pub fn pick_asset<'a>(release: &'a GhRelease, name: &str) -> Option<&'a GhAsset> {
    release.assets.iter().find(|a| a.name == name)
}

pub fn parse_ffmpeg_version(line: &str) -> Option<String> {
    line.strip_prefix("ffmpeg version ")?
        .split_whitespace()
        .next()
        .map(str::to_string)
}

#[allow(dead_code)]
pub fn prepended_path(bin: &Path) -> String {
    let existing = std::env::var("PATH").unwrap_or_default();
    let sep = if cfg!(windows) { ";" } else { ":" };
    format!("{}{sep}{existing}", bin.display())
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("CRTube/0.1 (+https://github.com/SlyHammad18/CRTube)")
        .timeout(Duration::from_secs(30))
        .build()
        .expect("reqwest client")
}

fn download_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("CRTube/0.1 (+https://github.com/SlyHammad18/CRTube)")
        .build()
        .expect("reqwest client")
}

pub async fn fetch_latest_ytdlp() -> Result<LatestRelease> {
    let rel: GhRelease = client()
        .get(YT_DLP_RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| ToolError::Network(e.to_string()))?
        .json()
        .await
        .map_err(|e| ToolError::Network(e.to_string()))?;

    let tag = rel.tag_name.trim().to_string();
    let asset = pick_asset(&rel, yt_dlp_asset_name())
        .ok_or_else(|| ToolError::Network("yt-dlp asset missing from release".into()))?;
    let sums_url = pick_asset(&rel, YT_DLP_CHECKSUMS_ASSET)
        .map(|a| a.browser_download_url.clone());

    Ok(LatestRelease {
        tag,
        asset_url: asset.browser_download_url.clone(),
        sums_url,
    })
}

pub async fn fetch_expected_sha(latest: &LatestRelease) -> Result<String> {
    let url = latest.sums_url.as_ref().ok_or(ToolError::ChecksumUnavailable)?;
    let text = client()
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| ToolError::Network(e.to_string()))?
        .text()
        .await
        .map_err(|e| ToolError::Network(e.to_string()))?;
    parse_checksums(&text, yt_dlp_asset_name()).ok_or(ToolError::ChecksumUnavailable)
}

async fn download_to(
    url: &str,
    dest: &Path,
    mut on_pct: impl FnMut(u8),
) -> Result<()> {
    let resp = download_client()
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| ToolError::Network(e.to_string()))?;

    let total = resp.content_length();
    let mut file = File::create(dest)?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit = Instant::now();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| ToolError::Network(e.to_string()))?;
        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        if let Some(t) = total.filter(|t| *t > 0) {
            let pct = ((downloaded as f64 / t as f64) * 100.0) as u8;
            if last_emit.elapsed() >= Duration::from_millis(150) {
                on_pct(pct.min(99));
                last_emit = Instant::now();
            }
        }
    }
    file.sync_all()?;
    on_pct(100);
    Ok(())
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut f = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn atomic_install(tmp: &Path, final_path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(tmp, fs::Permissions::from_mode(0o755))?;
    }
    fs::rename(tmp, final_path)?;
    Ok(())
}

fn tmp_sibling(final_path: &Path, suffix: &str) -> PathBuf {
    let pid = std::process::id();
    final_path.with_file_name(format!(
        ".{}.tmp-{suffix}-{pid}",
        final_path.file_name().and_then(|n| n.to_str()).unwrap_or("tool")
    ))
}

fn cleanup(path: &Path) {
    let _ = fs::remove_file(path);
}

pub async fn probe_binary_version(path: &Path, args: &[&str]) -> Option<String> {
    let out = tokio::process::Command::new(path)
        .args(args)
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout)
        .ok()?
        .lines()
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

pub async fn probe_ytdlp(bin: &Path) -> Option<String> {
    probe_binary_version(&ytdlp_path(bin), &["--version"]).await
}

pub async fn probe_ffmpeg(bin: &Path) -> Option<String> {
    let raw = probe_binary_version(&ffmpeg_path(bin), &["-version"]).await?;
    parse_ffmpeg_version(&raw)
}

fn emit(app: &AppHandle, tool: &str, stage: &str, pct: u8) {
    let _ = app.emit(
        "tools://progress",
        ProgressPayload {
            tool: tool.to_string(),
            stage: stage.to_string(),
            pct,
        },
    );
}

pub async fn install_ytdlp(
    app: &AppHandle,
    bin: &Path,
    latest: &LatestRelease,
    expected_sha: &str,
) -> Result<()> {
    emit(app, "ytdlp", "query", 3);
    let dest_tmp = tmp_sibling(&ytdlp_path(bin), "dl");

    let dl_result = download_to(&latest.asset_url, &dest_tmp, |pct| {
        let scaled = 5 + (pct as u32 * 80 / 100) as u8;
        emit(app, "ytdlp", "download", scaled.min(85));
    })
    .await;
    if let Err(e) = dl_result {
        cleanup(&dest_tmp);
        return Err(e);
    }

    emit(app, "ytdlp", "verify", 90);
    let got = match sha256_file(&dest_tmp) {
        Ok(h) => h,
        Err(e) => {
            cleanup(&dest_tmp);
            return Err(e);
        }
    };
    if got != expected_sha.trim().to_ascii_lowercase() {
        cleanup(&dest_tmp);
        return Err(ToolError::ChecksumMismatch {
            asset: yt_dlp_asset_name().to_string(),
        });
    }

    emit(app, "ytdlp", "install", 96);
    let final_path = ytdlp_path(bin);
    if let Err(e) = atomic_install(&dest_tmp, &final_path) {
        cleanup(&dest_tmp);
        return Err(e);
    }

    emit(app, "ytdlp", "done", 100);
    Ok(())
}

#[cfg(target_os = "linux")]
async fn extract_ffmpeg_archive(app: &AppHandle, archive: &Path, bin: &Path) -> Result<()> {
    let file = File::open(archive)?;
    let decompressed = xz2::read::XzDecoder::new(BufReader::new(file));
    let mut tar = tar::Archive::new(decompressed);

    for entry in tar.entries().map_err(|e| ToolError::Archive(e.to_string()))? {
        let mut entry = entry.map_err(|e| ToolError::Archive(e.to_string()))?;
        let name = entry
            .path()
            .map_err(|e| ToolError::Archive(e.to_string()))?
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        if name != "ffmpeg" && name != "ffprobe" {
            continue;
        }
        let target = bin.join(&name);
        let tmp = tmp_sibling(&target, "x");
        let mut out = File::create(&tmp)?;
        std::io::copy(&mut entry, &mut out)?;
        out.sync_all()?;
        drop(out);
        atomic_install(&tmp, &target)?;

        let pct = if name == "ffmpeg" { 85 } else { 97 };
        emit(app, "ffmpeg", "extract", pct);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
async fn extract_ffmpeg_archive(app: &AppHandle, archive: &Path, bin: &Path) -> Result<()> {
    let file = File::open(archive)?;
    let mut zip = zip::ZipArchive::new(BufReader::new(file))
        .map_err(|e| ToolError::Archive(e.to_string()))?;

    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| ToolError::Archive(e.to_string()))?;
        let name = entry
            .enclosed_name()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
            .unwrap_or_default();
        if name != "ffmpeg.exe" && name != "ffprobe.exe" || entry.is_dir() {
            continue;
        }
        let target = bin.join(&name);
        let tmp = tmp_sibling(&target, "x");
        let mut out = File::create(&tmp)?;
        std::io::copy(&mut entry, &mut out)?;
        out.sync_all()?;
        drop(out);
        atomic_install(&tmp, &target)?;

        let pct = if name == "ffmpeg.exe" { 85 } else { 97 };
        emit(app, "ffmpeg", "extract", pct);
    }
    Ok(())
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
async fn extract_ffmpeg_archive(_app: &AppHandle, _archive: &Path, _bin: &Path) -> Result<()> {
    Err(ToolError::UnsupportedPlatform)
}

fn ffmpeg_bundle_url(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("linux", "x86_64") => Some(FFMPEG_LINUX_AMD64),
        ("linux", "aarch64") => Some(FFMPEG_LINUX_ARM64),
        ("windows", "x86_64") => Some(FFMPEG_WINDOWS_WIN64),
        ("macos", _) => Some(FFMPEG_MACOS_UNIVERSAL),
        _ => None,
    }
}

pub async fn ensure_ffmpeg(app: &AppHandle, bin: &Path) -> Result<String> {
    if let Some(v) = probe_ffmpeg(bin).await {
        return Ok(v);
    }
    fs::create_dir_all(bin)?;

    emit(app, "ffmpeg", "query", 2);
    if std::env::consts::OS == "macos" {
        return Err(ToolError::UnsupportedPlatform);
    }
    let url =
        ffmpeg_bundle_url(std::env::consts::OS, std::env::consts::ARCH)
            .ok_or(ToolError::UnsupportedPlatform)?;
    let dest_tmp = tmp_sibling(&ffmpeg_path(bin), "dl");

    let dl_result = download_to(url, &dest_tmp, |pct| {
        let scaled = 4 + (pct as u32 * 66 / 100) as u8;
        emit(app, "ffmpeg", "download", scaled.min(70));
    })
    .await;
    if let Err(e) = dl_result {
        cleanup(&dest_tmp);
        return Err(e);
    }

    emit(app, "ffmpeg", "extract", 72);
    if let Err(e) = extract_ffmpeg_archive(app, &dest_tmp, bin).await {
        cleanup(&dest_tmp);
        return Err(e);
    }
    cleanup(&dest_tmp);

    let version = probe_ffmpeg(bin)
        .await
        .ok_or_else(|| ToolError::Archive("extracted ffmpeg is not runnable".into()))?;
    let _ = probe_binary_version(&ffprobe_path(bin), &["-version"])
        .await
        .ok_or_else(|| ToolError::Archive("extracted ffprobe is not runnable".into()))?;

    emit(app, "ffmpeg", "done", 100);
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_urls_are_https_and_mapped() {
        assert!(YT_DLP_RELEASE_API.starts_with("https://"));
        assert_eq!(YT_DLP_CHECKSUMS_ASSET, "SHA2-256SUMS");
        assert!(yt_dlp_asset_name().starts_with("yt-dlp"));

        for (os, arch, url) in [
            ("linux", "x86_64", FFMPEG_LINUX_AMD64),
            ("linux", "aarch64", FFMPEG_LINUX_ARM64),
            ("windows", "x86_64", FFMPEG_WINDOWS_WIN64),
            ("macos", "x86_64", FFMPEG_MACOS_UNIVERSAL),
        ] {
            let picked = ffmpeg_bundle_url(os, arch).unwrap();
            assert_eq!(picked, url);
            assert!(picked.starts_with("https://"), "{picked}");
        }
        assert!(ffmpeg_bundle_url("plan9", "x86_64").is_none());
    }

    #[test]
    fn parses_checksum_file_for_asset() {
        let sums = "\
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  yt-dlp
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  yt-dlp.exe
cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc  yt-dlp_macos
";
        let hit = parse_checksums(sums, "yt-dlp").unwrap();
        assert!(hit.starts_with("aaaa"));
        assert_eq!(hit.len(), 64);
        assert_eq!(parse_checksums(sums, "missing"), None);
    }

    #[test]
    fn picks_named_asset_from_release() {
        let rel: GhRelease = serde_json::from_value(serde_json::json!({
            "tag_name": "2026.08.20",
            "assets": [
                {"name": "yt-dlp", "browser_download_url": "https://x/yt-dlp"},
                {"name": "SHA2-256SUMS", "browser_download_url": "https://x/sums"}
            ]
        }))
        .unwrap();
        assert_eq!(pick_asset(&rel, "yt-dlp").unwrap().browser_download_url, "https://x/yt-dlp");
        assert_eq!(pick_asset(&rel, "SHA2-256SUMS").unwrap().browser_download_url, "https://x/sums");
        assert!(pick_asset(&rel, "nope").is_none());
        assert_eq!(rel.tag_name, "2026.08.20");
    }

    #[test]
    fn parses_ffmpeg_version_lines() {
        assert_eq!(
            parse_ffmpeg_version("ffmpeg version 7.0.2-static https://johnvansickle.com/ffmpeg/ Copyright (c) 2000-2024"),
            Some("7.0.2-static".to_string())
        );
        assert_eq!(
            parse_ffmpeg_version("ffmpeg version N-111815-gb0a0e4e0a9-20240526 Copyright"),
            Some("N-111815-gb0a0e4e0a9-20240526".to_string())
        );
        assert_eq!(parse_ffmpeg_version("not ffmpeg"), None);
    }

    #[cfg(unix)]
    #[test]
    fn prepends_bin_dir_to_path() {
        let p = Path::new("/opt/crtube/bin");
        let joined = prepended_path(p);
        assert!(joined.starts_with("/opt/crtube/bin:"));
    }
}
