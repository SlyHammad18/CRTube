use tauri::State;

use crate::services::mpris::{Mpris, MprisState, MprisTrack};

/// Load (or replace) the track the desktop media widget shows. The widget only
/// appears once a track is loaded — an idle CRTube owns no MPRIS name.
#[tauri::command]
pub async fn mpris_set_track(mpris: State<'_, Mpris>, track: MprisTrack) -> Result<(), String> {
    mpris.set_track(track).await
}

/// Push the playback snapshot: immediately whenever playback, volume, speed or
/// navigation changes, and at the consumer's cadence while the position advances.
#[tauri::command]
pub async fn mpris_set_state(mpris: State<'_, Mpris>, state: MprisState) -> Result<(), String> {
    mpris.set_state(state).await
}

/// Forward a validated playback command from a secondary local webview to the
/// main player, which remains the sole owner of playback state.
#[tauri::command]
pub fn mpris_command(
    mpris: State<'_, Mpris>,
    action: String,
    value: Option<f64>,
) -> Result<(), String> {
    mpris.send_command(&action, value)
}

/// Drop the player so the shell removes the media widget (empty queue).
#[tauri::command]
pub async fn mpris_clear(mpris: State<'_, Mpris>) -> Result<(), String> {
    mpris.clear().await
}
