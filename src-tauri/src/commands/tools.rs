use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::services::installer::{self, ToolError};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Versions {
    pub ytdlp: Option<String>,
    pub ffmpeg: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnsureOutcome {
    pub ytdlp: Option<String>,
    pub ffmpeg: Option<String>,
    pub ytdlp_updated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOutcome {
    pub updated: bool,
    pub ytdlp: Option<String>,
}

#[derive(Default)]
pub struct ToolService {
    gate: Mutex<()>,
    versions: std::sync::Mutex<Option<Versions>>,
}

impl ToolService {
    fn cache(&self, versions: Versions) {
        *self.versions.lock().unwrap() = Some(versions);
    }

    fn cached(&self) -> Option<Versions> {
        self.versions.lock().unwrap().clone()
    }
}

#[derive(Clone, Serialize)]
struct StatusPayload<'a> {
    state: &'a str,
}

fn emit_status(app: &AppHandle, state: &str) {
    let _ = app.emit("tools://status", StatusPayload { state });
}

async fn probe_versions(bin: &std::path::Path) -> (Option<String>, Option<String>) {
    let ytdlp = installer::probe_ytdlp(bin).await;
    let ffmpeg = installer::probe_ffmpeg(bin).await;
    (ytdlp, ffmpeg)
}

async fn ensure_tools_flow(
    app: &AppHandle,
    svc: &ToolService,
) -> Result<EnsureOutcome, String> {
    let bin = installer::bin_dir(app).map_err(|e| e.to_string())?;
    tokio::fs::create_dir_all(&bin).await.map_err(|e| e.to_string())?;

    let ffmpeg_version =
        installer::ensure_ffmpeg(app, &bin).await.map_err(|e| e.user_message())?;

    let current_ytdlp = installer::probe_ytdlp(&bin).await;
    let settings = crate::commands::settings::load_settings(app);

    let needs_check = match &current_ytdlp {
        None => true,
        Some(_) if settings.autoupdate_ytdlp => true,
        Some(_) => false,
    };

    let (ytdlp_version, ytdlp_updated) = if needs_check {
        match installer::fetch_latest_ytdlp().await {
            Ok(latest) => match current_ytdlp.as_deref() {
                Some(v) if v == latest.tag => (latest.tag.clone(), false),
                _ => {
                    let updated = current_ytdlp.is_some();
                    match install_latest_ytdlp(app, &bin, &latest).await {
                        Ok(version) => (version, updated),
                        Err(e) => match &current_ytdlp {
                            // Offline / checksum / download failure while an
                            // existing yt-dlp is present: keep using it instead
                            // of failing the whole boot.
                            Some(v) => {
                                emit_status(app, "ready");
                                (v.clone(), false)
                            }
                            None => return Err(format!("Couldn't install yt-dlp: {}", e.user_message())),
                        },
                    }
                }
            },
            Err(e) => match &current_ytdlp {
                Some(v) => (v.clone(), false),
                None => {
                    return Err(format!(
                        "Couldn't check for tools (offline?): {}",
                        e.user_message()
                    ))
                }
            },
        }
    } else {
        (current_ytdlp.clone().expect("checked above"), false)
    };

    let outcome = EnsureOutcome {
        ytdlp_updated,
        ytdlp: Some(ytdlp_version),
        ffmpeg: Some(ffmpeg_version),
    };
    svc.cache(Versions {
        ytdlp: outcome.ytdlp.clone(),
        ffmpeg: outcome.ffmpeg.clone(),
    });
    Ok(outcome)
}

async fn install_latest_ytdlp(
    app: &AppHandle,
    bin: &std::path::Path,
    latest: &installer::LatestRelease,
) -> Result<String, ToolError> {
    let expected = installer::fetch_expected_sha(latest).await?;
    installer::install_ytdlp(app, bin, latest, &expected).await?;
    Ok(installer::probe_ytdlp(bin)
        .await
        .unwrap_or_else(|| latest.tag.clone()))
}

async fn update_ytdlp_flow(
    app: &AppHandle,
    svc: &ToolService,
    force: bool,
) -> Result<UpdateOutcome, String> {
    let bin = installer::bin_dir(app).map_err(|e| e.to_string())?;
    tokio::fs::create_dir_all(&bin).await.map_err(|e| e.to_string())?;

    let latest = installer::fetch_latest_ytdlp().await.map_err(|e| e.user_message())?;
    let current = installer::probe_ytdlp(&bin).await;

    if !force && current.as_deref() == Some(latest.tag.as_str()) {
        return Ok(UpdateOutcome {
            updated: false,
            ytdlp: current,
        });
    }

    let installed = install_latest_ytdlp(app, &bin, &latest)
        .await
        .map_err(|e| e.user_message())?;

    let ffmpeg = svc.cached().and_then(|v| v.ffmpeg);
    svc.cache(Versions {
        ytdlp: Some(installed.clone()),
        ffmpeg,
    });

    Ok(UpdateOutcome {
        updated: true,
        ytdlp: Some(installed),
    })
}

async fn run_tracked<T>(
    app: &AppHandle,
    gate: &Mutex<()>,
    flow: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let _permit = gate.lock().await;
    emit_status(app, "updating");
    match flow.await {
        Ok(v) => {
            emit_status(app, "ready");
            Ok(v)
        }
        Err(e) => {
            emit_status(app, "error");
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn ensure_tools(
    app: AppHandle,
    svc: State<'_, ToolService>,
) -> Result<EnsureOutcome, String> {
    run_tracked(&app, &svc.gate, ensure_tools_flow(&app, &svc)).await
}

#[tauri::command]
pub async fn tool_versions(
    app: AppHandle,
    svc: State<'_, ToolService>,
) -> Result<Versions, String> {
    if let Some(v) = svc.cached() {
        return Ok(v);
    }
    let bin = installer::bin_dir(&app).map_err(|e| e.to_string())?;
    let (ytdlp, ffmpeg) = probe_versions(&bin).await;
    let versions = Versions { ytdlp, ffmpeg };
    svc.cache(versions.clone());
    Ok(versions)
}

#[tauri::command]
pub async fn update_ytdlp(
    app: AppHandle,
    svc: State<'_, ToolService>,
    force: bool,
) -> Result<UpdateOutcome, String> {
    run_tracked(&app, &svc.gate, update_ytdlp_flow(&app, &svc, force)).await
}
