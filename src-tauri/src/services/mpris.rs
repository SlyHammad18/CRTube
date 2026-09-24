use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use zbus::object_server::{InterfaceRef, SignalEmitter};
use zbus::zvariant::{ObjectPath, OwnedObjectPath, Value};

/// Object path every MPRIS player exposes.
const MPRIS_PATH: &str = "/org/mpris/MediaPlayer2";

/// Bus name the shell discovers the player by (`org.mpris.MediaPlayer2.*`).
/// Per-instance, as the spec's unique-instance-identifier asks: two CRTube
/// windows each get their own widget instead of one silently losing the name.
fn bus_name() -> String {
    format!(
        "org.mpris.MediaPlayer2.crtube.instance{}",
        std::process::id()
    )
}

/// Desktop entry the shell resolves us to: a click on the media widget makes
/// GNOME activate this entry, which raises the running CRTube window.
const DESKTOP_ENTRY: &str = "CRTube";

/// Window label created in `lib.rs::create_main_window`.
const MAIN_WINDOW: &str = "main";
/// Player commands for the frontend; mirrored in `src/lib/ipc.ts`.
pub const COMMAND_EVENT: &str = "mpris://command";

/// Playback speed bounds, mirroring `SPEED_MIN`/`SPEED_MAX` in the frontend.
const RATE_MIN: f64 = 0.25;
const RATE_MAX: f64 = 4.0;

const NO_BUS: &str = "no session bus connection";
const MAX_SAMPLE_AGE_MS: u64 = 5_000;

/// Track pushed by the frontend whenever the queue entry under the playhead
/// changes.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MprisTrack {
    pub id: i64,
    pub title: String,
    pub artist: Option<String>,
    pub duration_s: Option<f64>,
    pub art_url: Option<String>,
    /// Monotonic publisher sequence used to reject a late track update.
    #[serde(default)]
    pub sequence: u64,
}

/// Playback state pushed by the frontend, throttled for the position and sent
/// immediately when transport or volume changes.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MprisState {
    /// Track this state belongs to; prevents a late state from another queue
    /// item from overwriting the current track.
    #[serde(default)]
    pub track_id: i64,
    /// Monotonic publisher sequence used to reject out-of-order IPC calls.
    #[serde(default)]
    pub sequence: u64,
    /// Wall-clock time at which the frontend sampled `position_s`, used to
    /// correct for IPC latency without trusting a delayed sample forever.
    #[serde(default)]
    pub sampled_at_ms: Option<u64>,
    pub playing: bool,
    pub position_s: f64,
    pub volume: f64,
    pub muted: bool,
    pub speed: f64,
    pub can_next: bool,
    pub can_previous: bool,
}

#[derive(Debug, Clone, Copy)]
pub struct OverlayPlaybackSnapshot {
    pub track_id: i64,
    pub sequence: u64,
    pub position_s: f64,
    pub playing: bool,
    pub speed: f64,
}

/// A playback command from the media widget, forwarded to the frontend — the
/// player store owns playback, the shell only asks it to move.
#[derive(Debug, Clone, Serialize)]
pub struct MprisCommand {
    pub action: String,
    pub value: Option<f64>,
}

#[derive(Default)]
struct Track {
    id: i64,
    title: String,
    artist: Option<String>,
    duration_us: i64,
    art_url: Option<String>,
}

struct Snapshot {
    track: Track,
    playing: bool,
    position_us: i64,
    position_updated_at: Instant,
    volume: f64,
    muted: bool,
    rate: f64,
    can_next: bool,
    can_previous: bool,
    last_track_sequence: u64,
    last_state_sequence: u64,
    pending_state: Option<MprisState>,
}

impl Snapshot {
    fn new() -> Self {
        Self {
            track: Track::default(),
            playing: false,
            position_us: 0,
            position_updated_at: Instant::now(),
            volume: 1.0,
            muted: false,
            rate: 1.0,
            can_next: false,
            can_previous: false,
            last_track_sequence: 0,
            last_state_sequence: 0,
            pending_state: None,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct StateChanges {
    status: bool,
    volume: bool,
    rate: bool,
    navigation: bool,
}

/// Apply one publisher state only if it belongs to the current track and is
/// newer than the last state already accepted by the overlay/MPRIS boundary.
fn apply_state(snapshot: &mut Snapshot, state: &MprisState) -> Option<StateChanges> {
    if state.track_id != snapshot.track.id {
        if state.track_id != 0 {
            let replace = snapshot
                .pending_state
                .as_ref()
                .is_none_or(|pending| state.sequence >= pending.sequence);
            if replace {
                snapshot.pending_state = Some(state.clone());
            }
        }
        return None;
    }
    snapshot.pending_state = None;
    if state.sequence > 0 {
        if state.sequence <= snapshot.last_state_sequence {
            return None;
        }
        snapshot.last_state_sequence = state.sequence;
    }

    let changes = StateChanges {
        status: snapshot.playing != state.playing,
        volume: snapshot.volume != state.volume || snapshot.muted != state.muted,
        rate: snapshot.rate != state.speed,
        navigation: snapshot.can_next != state.can_next
            || snapshot.can_previous != state.can_previous,
    };

    snapshot.playing = state.playing;
    snapshot.position_us = sampled_position_us(state, unix_time_ms());
    snapshot.position_updated_at = Instant::now();
    snapshot.volume = state.volume.clamp(0.0, 1.0);
    snapshot.muted = state.muted;
    snapshot.rate = state.speed.clamp(RATE_MIN, RATE_MAX);
    snapshot.can_next = state.can_next;
    snapshot.can_previous = state.can_previous;
    Some(changes)
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn sampled_position_us(state: &MprisState, now_ms: u64) -> i64 {
    let mut position_s = state.position_s;
    if state.playing {
        if let Some(sampled_at_ms) = state.sampled_at_ms {
            let age_ms = now_ms
                .saturating_sub(sampled_at_ms)
                .min(MAX_SAMPLE_AGE_MS);
            position_s += age_ms as f64 / 1_000.0 * state.speed.clamp(RATE_MIN, RATE_MAX);
        }
    }
    position_to_us(position_s)
}

fn position_to_us(seconds: f64) -> i64 {
    if !seconds.is_finite() {
        return 0;
    }
    (seconds.max(0.0) * 1_000_000.0)
        .min(i64::MAX as f64) as i64
}

/// Return the playback position at `now`, advancing the last accepted sample
/// while the media is playing. This keeps the overlay smooth even when the
/// frontend's next `timeupdate`/IPC sample is late.
fn position_at(snapshot: &Snapshot, now: Instant) -> i64 {
    let elapsed = now
        .checked_duration_since(snapshot.position_updated_at)
        .unwrap_or(Duration::ZERO);
    let elapsed_us = if snapshot.playing {
        (elapsed.as_secs_f64() * snapshot.rate.max(0.0) * 1_000_000.0)
            .min(i64::MAX as f64) as i64
    } else {
        0
    };
    snapshot.position_us.saturating_add(elapsed_us)
}

fn rebase_position(snapshot: &mut Snapshot, now: Instant) {
    snapshot.position_us = position_at(snapshot, now);
    snapshot.position_updated_at = now;
}

/// `mpris:trackid` for a queue entry; MPRIS requires an object path.
fn track_path(id: i64) -> String {
    format!("{MPRIS_PATH}/track/{id}")
}

/// `Stopped` until a track is loaded, then whatever the transport says.
fn status_for(snapshot: &Snapshot) -> &'static str {
    if snapshot.track.id == 0 {
        "Stopped"
    } else if snapshot.playing {
        "Playing"
    } else {
        "Paused"
    }
}

/// The `Metadata` dictionary the widget reads title, artist and artwork from.
fn metadata_for(track: &Track) -> zbus::fdo::Result<HashMap<&'static str, Value<'static>>> {
    let mut metadata = HashMap::new();
    let track_id = OwnedObjectPath::try_from(track_path(track.id))
        .map_err(|e| zbus::fdo::Error::Failed(e.to_string()))?;
    metadata.insert("mpris:trackid", Value::from(track_id));
    if track.duration_us > 0 {
        metadata.insert("mpris:length", Value::from(track.duration_us));
    }
    metadata.insert("xesam:title", Value::from(track.title.clone()));
    if let Some(artist) = &track.artist {
        metadata.insert("xesam:artist", Value::from(vec![artist.clone()]));
    }
    metadata.insert("xesam:album", Value::from("CRTube"));
    if let Some(art_url) = &track.art_url {
        metadata.insert("mpris:artUrl", Value::from(art_url.clone()));
    }
    Ok(metadata)
}

/// Owns the MPRIS player the desktop media widget talks to.
///
/// We publish this ourselves because the MPRIS player WebKitGTK registers while
/// the webview plays audio hardcodes `DesktopEntry` empty and `CanRaise` false
/// (see `MediaSessionGLib.cpp`), leaving GNOME's click handler with nothing to
/// call. Owning the player is what makes a click on the thumbnail raise CRTube.
///
/// WebKitGTK only registers a player of its own when the page publishes
/// media-session metadata carrying a title (`MediaSessionGLib.cpp` bails out
/// without one) — and this app deliberately publishes none any more, so the
/// shell lists a single, thumbnail-carrying entry.
pub struct Mpris {
    app: AppHandle,
    connection: Option<zbus::Connection>,
    /// Well-known name this instance owns while a track is loaded.
    name: String,
    state: Arc<Mutex<Snapshot>>,
    /// Whether the well-known name is currently owned (a track is loaded).
    owned: Mutex<bool>,
}

impl Mpris {
    pub async fn connect(app: AppHandle) -> Self {
        let connection = match zbus::Connection::session().await {
            Ok(connection) => Some(connection),
            Err(e) => {
                eprintln!("crtube: media controls unavailable: {e}");
                None
            }
        };
        Self {
            app,
            connection,
            name: bus_name(),
            state: Arc::new(Mutex::new(Snapshot::new())),
            owned: Mutex::new(false),
        }
    }

    /// Load a track: publish (or refresh) the player and its metadata.
    pub async fn set_track(&self, track: MprisTrack) -> Result<(), String> {
        let pending_changes = {
            let mut snapshot = self.lock()?;
            if track.sequence > 0 && track.sequence <= snapshot.last_track_sequence {
                return Ok(());
            }
            let same_track = snapshot.track.id == track.id;
            if track.sequence > 0 {
                snapshot.last_track_sequence = track.sequence;
            }
            snapshot.track = Track {
                id: track.id,
                title: track.title,
                artist: track.artist.filter(|artist| !artist.trim().is_empty()),
                duration_us: (track.duration_s.unwrap_or(0.0).max(0.0) * 1e6) as i64,
                art_url: track.art_url,
            };
            if !same_track {
                snapshot.position_us = 0;
                snapshot.position_updated_at = Instant::now();
            }
            snapshot
                .pending_state
                .take()
                .and_then(|state| {
                    (state.track_id == track.id)
                        .then(|| apply_state(&mut snapshot, &state))
                        .flatten()
                })
                .unwrap_or_default()
        };
        self.register().await?;
        self.emit_metadata().await?;
        self.emit_playback_status().await?;
        if pending_changes.volume {
            self.emit_volume().await?;
        }
        if pending_changes.rate {
            self.emit_rate().await?;
        }
        if pending_changes.navigation {
            self.emit_navigation().await?;
        }
        Ok(())
    }

    /// Apply a playback state snapshot, signalling only what changed.
    pub async fn set_state(&self, state: MprisState) -> Result<(), String> {
        let changes = {
            let mut snapshot = self.lock()?;
            apply_state(&mut snapshot, &state)
        };
        let Some(changes) = changes else {
            return Ok(());
        };

        if !self.owned()? {
            // Nothing is published yet, so there is nobody to signal; the next
            // `set_track` reads this snapshot when it registers.
            return Ok(());
        }
        if changes.status {
            self.emit_playback_status().await?;
        }
        if changes.volume {
            self.emit_volume().await?;
        }
        if changes.rate {
            self.emit_rate().await?;
        }
        if changes.navigation {
            self.emit_navigation().await?;
        }
        Ok(())
    }

    /// Drop the player: releasing the name makes the shell remove the widget,
    /// so an idle CRTube leaves no dead media entry behind.
    pub async fn clear(&self) -> Result<(), String> {
        {
            let mut snapshot = self.lock()?;
            let last_track_sequence = snapshot.last_track_sequence;
            let last_state_sequence = snapshot.last_state_sequence;
            *snapshot = Snapshot::new();
            // Do not let an IPC request from before clear become "new" after
            // the player is reset and the same database track is loaded again.
            snapshot.last_track_sequence = last_track_sequence;
            snapshot.last_state_sequence = last_state_sequence;
        }
        let Some(connection) = self.connection.as_ref() else {
            return Ok(());
        };
        let owned = {
            let mut owned = self.owned.lock().map_err(|e| e.to_string())?;
            std::mem::replace(&mut *owned, false)
        };
        if owned {
            connection
                .release_name(self.name.as_str())
                .await
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn owned(&self) -> Result<bool, String> {
        Ok(*self.owned.lock().map_err(|e| e.to_string())?)
    }

    fn lock(&self) -> Result<MutexGuard<'_, Snapshot>, String> {
        self.state.lock().map_err(|e| e.to_string())
    }

    /// Lightweight playback snapshot for the separate floating lyrics webview.
    /// It intentionally does not depend on DBus ownership, so the overlay also
    /// works on systems without a session media bus.
    pub fn overlay_snapshot(&self) -> Result<Option<OverlayPlaybackSnapshot>, String> {
        let snapshot = self.lock()?;
        if snapshot.track.id == 0 {
            return Ok(None);
        }
        let position_us = position_at(&snapshot, Instant::now());
        Ok(Some(OverlayPlaybackSnapshot {
            track_id: snapshot.track.id,
            sequence: snapshot.last_state_sequence,
            position_s: position_us as f64 / 1_000_000.0,
            playing: snapshot.playing,
            speed: snapshot.rate,
        }))
    }

    /// Export the MPRIS objects and own the bus name. Idempotent: the objects
    /// stay registered, only the name is requested again after a `clear`.
    async fn register(&self) -> Result<(), String> {
        let connection = self.connection.as_ref().ok_or_else(|| NO_BUS.to_string())?;
        let server = connection.object_server();
        server
            .at(
                MPRIS_PATH,
                RootIface {
                    app: self.app.clone(),
                },
            )
            .await
            .map_err(|e| e.to_string())?;
        server
            .at(
                MPRIS_PATH,
                PlayerIface {
                    app: self.app.clone(),
                    state: self.state.clone(),
                },
            )
            .await
            .map_err(|e| e.to_string())?;

        {
            let mut owned = self.owned.lock().map_err(|e| e.to_string())?;
            if *owned {
                return Ok(());
            }
            *owned = true;
        }
        if let Err(e) = connection.request_name(self.name.as_str()).await {
            *self.owned.lock().map_err(|e| e.to_string())? = false;
            return Err(e.to_string());
        }
        Ok(())
    }

    async fn player(&self) -> Result<InterfaceRef<PlayerIface>, String> {
        self.connection
            .as_ref()
            .ok_or_else(|| NO_BUS.to_string())?
            .object_server()
            .interface::<_, PlayerIface>(MPRIS_PATH)
            .await
            .map_err(|e| e.to_string())
    }

    async fn emit_metadata(&self) -> Result<(), String> {
        let player = self.player().await?;
        let iface = player.get().await;
        iface
            .metadata_changed(player.signal_emitter())
            .await
            .map_err(|e| e.to_string())
    }

    async fn emit_playback_status(&self) -> Result<(), String> {
        let player = self.player().await?;
        let iface = player.get().await;
        iface
            .playback_status_changed(player.signal_emitter())
            .await
            .map_err(|e| e.to_string())
    }

    async fn emit_volume(&self) -> Result<(), String> {
        let player = self.player().await?;
        let iface = player.get().await;
        iface
            .volume_changed(player.signal_emitter())
            .await
            .map_err(|e| e.to_string())
    }

    async fn emit_rate(&self) -> Result<(), String> {
        let player = self.player().await?;
        let iface = player.get().await;
        iface
            .rate_changed(player.signal_emitter())
            .await
            .map_err(|e| e.to_string())
    }

    async fn emit_navigation(&self) -> Result<(), String> {
        let player = self.player().await?;
        let iface = player.get().await;
        iface
            .can_go_next_changed(player.signal_emitter())
            .await
            .map_err(|e| e.to_string())?;
        iface
            .can_go_previous_changed(player.signal_emitter())
            .await
            .map_err(|e| e.to_string())
    }
}

/// `org.mpris.MediaPlayer2` — identity and activation.
struct RootIface {
    app: AppHandle,
}

#[zbus::interface(name = "org.mpris.MediaPlayer2")]
impl RootIface {
    /// Declared by the spec, but a media widget must not be able to close the
    /// app, so `CanQuit` stays false and the method is not exported.
    #[zbus(property)]
    fn can_quit(&self) -> bool {
        false
    }

    #[zbus(property)]
    fn can_raise(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn has_track_list(&self) -> bool {
        false
    }

    #[zbus(property)]
    fn identity(&self) -> String {
        "CRTube".to_string()
    }

    #[zbus(property)]
    fn desktop_entry(&self) -> String {
        DESKTOP_ENTRY.to_string()
    }

    #[zbus(property)]
    fn supported_uri_schemes(&self) -> Vec<String> {
        Vec::new()
    }

    #[zbus(property)]
    fn supported_mime_types(&self) -> Vec<String> {
        Vec::new()
    }

    /// Fallback for shells that call `Raise` instead of activating the desktop
    /// entry. GNOME prefers the desktop entry (its own activation carries the
    /// tokens Wayland needs), so this path is best-effort.
    async fn raise(&self) -> zbus::fdo::Result<()> {
        if let Some(window) = self.app.get_webview_window(MAIN_WINDOW) {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        Ok(())
    }
}

/// `org.mpris.MediaPlayer2.Player` — what the widget reads and drives.
struct PlayerIface {
    app: AppHandle,
    state: Arc<Mutex<Snapshot>>,
}

impl PlayerIface {
    fn snapshot(&self) -> zbus::fdo::Result<MutexGuard<'_, Snapshot>> {
        self.state
            .lock()
            .map_err(|_| zbus::fdo::Error::Failed("player state poisoned".into()))
    }

    fn emit_command(&self, action: &str, value: Option<f64>) {
        let command = MprisCommand {
            action: action.to_string(),
            value,
        };
        if let Err(e) = self.app.emit(COMMAND_EVENT, command) {
            eprintln!("crtube: media widget command failed: {e}");
        }
    }

    /// `mpris:trackid` for the loaded entry; MPRIS wants an object path.
    fn track_path(&self) -> String {
        track_path(self.snapshot().map(|s| s.track.id).unwrap_or(0))
    }
}

#[zbus::interface(name = "org.mpris.MediaPlayer2.Player")]
impl PlayerIface {
    async fn next(&self) {
        self.emit_command("next", None);
    }

    async fn previous(&self) {
        self.emit_command("previous", None);
    }

    async fn pause(&self) {
        self.emit_command("pause", None);
    }

    async fn play(&self) {
        self.emit_command("play", None);
    }

    async fn play_pause(&self) {
        self.emit_command("playpause", None);
    }

    async fn stop(&self) {
        self.emit_command("stop", None);
    }

    /// Relative seek in microseconds, as the spec defines it.
    async fn seek(
        &self,
        offset_us: i64,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> zbus::fdo::Result<()> {
        let target_us = {
            let snapshot = self.snapshot()?;
            position_at(&snapshot, Instant::now())
                .saturating_add(offset_us)
                .max(0)
        };
        self.emit_command("seek", Some(target_us as f64 / 1e6));
        emitter
            .seeked(target_us)
            .await
            .map_err(|e| zbus::fdo::Error::Failed(e.to_string()))
    }

    async fn set_position(
        &self,
        track_id: ObjectPath<'_>,
        position_us: i64,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
    ) -> zbus::fdo::Result<()> {
        if track_id.as_str() != self.track_path() {
            return Ok(());
        }
        let target_us = position_us.max(0);
        self.emit_command("seek", Some(target_us as f64 / 1e6));
        emitter
            .seeked(target_us)
            .await
            .map_err(|e| zbus::fdo::Error::Failed(e.to_string()))
    }

    #[zbus(property)]
    fn playback_status(&self) -> zbus::fdo::Result<String> {
        let snapshot = self.snapshot()?;
        Ok(status_for(&snapshot).to_string())
    }

    #[zbus(property)]
    fn metadata(&self) -> zbus::fdo::Result<HashMap<&'static str, Value<'static>>> {
        let snapshot = self.snapshot()?;
        metadata_for(&snapshot.track)
    }

    /// Read-only and never signalled: consumers poll it at their own pace.
    #[zbus(property(emits_changed_signal = "false"))]
    fn position(&self) -> zbus::fdo::Result<i64> {
        let snapshot = self.snapshot()?;
        Ok(position_at(&snapshot, Instant::now()))
    }

    #[zbus(property)]
    fn rate(&self) -> zbus::fdo::Result<f64> {
        Ok(self.snapshot()?.rate)
    }

    #[zbus(property)]
    fn set_rate(&self, rate: f64) -> zbus::fdo::Result<()> {
        let rate = rate.clamp(RATE_MIN, RATE_MAX);
        {
            let mut snapshot = self.snapshot()?;
            let now = Instant::now();
            rebase_position(&mut snapshot, now);
            snapshot.rate = rate;
        }
        self.emit_command("set_rate", Some(rate));
        Ok(())
    }

    #[zbus(property)]
    fn minimum_rate(&self) -> f64 {
        RATE_MIN
    }

    #[zbus(property)]
    fn maximum_rate(&self) -> f64 {
        RATE_MAX
    }

    /// Zero while muted, mirroring what the app would play.
    #[zbus(property)]
    fn volume(&self) -> zbus::fdo::Result<f64> {
        let snapshot = self.snapshot()?;
        Ok(if snapshot.muted { 0.0 } else { snapshot.volume })
    }

    #[zbus(property)]
    fn set_volume(&self, volume: f64) -> zbus::fdo::Result<()> {
        let volume = volume.clamp(0.0, 1.0);
        {
            let mut snapshot = self.snapshot()?;
            snapshot.volume = volume;
            if volume > 0.0 {
                snapshot.muted = false;
            }
        }
        self.emit_command("set_volume", Some(volume));
        Ok(())
    }

    #[zbus(property)]
    fn can_control(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_play(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_pause(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_seek(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_go_next(&self) -> zbus::fdo::Result<bool> {
        Ok(self.snapshot()?.can_next)
    }

    #[zbus(property)]
    fn can_go_previous(&self) -> zbus::fdo::Result<bool> {
        Ok(self.snapshot()?.can_previous)
    }

    #[zbus(signal)]
    async fn seeked(signal_emitter: &SignalEmitter<'_>, position_us: i64) -> zbus::Result<()>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playback_status_follows_the_transport() {
        let mut snapshot = Snapshot::new();
        assert_eq!(status_for(&snapshot), "Stopped");

        snapshot.track.id = 83;
        assert_eq!(status_for(&snapshot), "Paused");

        snapshot.playing = true;
        assert_eq!(status_for(&snapshot), "Playing");
    }

    #[test]
    fn overlay_position_advances_between_samples_only_while_playing() {
        let mut snapshot = Snapshot::new();
        let now = Instant::now();
        snapshot.playing = true;
        snapshot.rate = 1.0;
        snapshot.position_us = 1_000_000;
        snapshot.position_updated_at = now - Duration::from_secs(2);

        assert_eq!(position_at(&snapshot, now), 3_000_000);

        snapshot.playing = false;
        assert_eq!(position_at(&snapshot, now), 1_000_000);
    }

    #[test]
    fn delayed_state_sample_advances_by_its_age_up_to_the_cap() {
        let mut state = state(7, 4, 10.0);
        state.sampled_at_ms = Some(1_000);

        assert_eq!(sampled_position_us(&state, 1_500), 10_500_000);
        assert_eq!(
            sampled_position_us(&state, 1_000 + MAX_SAMPLE_AGE_MS + 1_000),
            15_000_000
        );
    }

    #[test]
    fn metadata_carries_the_track_identity_and_artwork() {
        let metadata = metadata_for(&Track {
            id: 83,
            title: "My Ideal".into(),
            artist: Some("Chet Baker".into()),
            duration_us: 260_832_000,
            art_url: Some("http://127.0.0.1:46553/tok/thumbs/s4-Osj48HsM".into()),
        })
        .expect("metadata");

        assert_eq!(
            metadata["mpris:trackid"],
            Value::from(OwnedObjectPath::try_from("/org/mpris/MediaPlayer2/track/83").unwrap())
        );
        assert_eq!(metadata["mpris:length"], Value::from(260_832_000i64));
        assert_eq!(metadata["xesam:title"], Value::from("My Ideal"));
        assert_eq!(
            metadata["xesam:artist"],
            Value::from(vec!["Chet Baker".to_string()])
        );
        assert_eq!(metadata["xesam:album"], Value::from("CRTube"));
        assert_eq!(
            metadata["mpris:artUrl"],
            Value::from("http://127.0.0.1:46553/tok/thumbs/s4-Osj48HsM")
        );
    }

    #[test]
    fn metadata_omits_what_the_track_does_not_have() {
        let metadata = metadata_for(&Track {
            id: 4,
            title: "Untitled".into(),
            ..Track::default()
        })
        .expect("metadata");

        assert!(!metadata.contains_key("mpris:length"));
        assert!(!metadata.contains_key("xesam:artist"));
        assert!(!metadata.contains_key("mpris:artUrl"));
        assert_eq!(
            metadata["mpris:trackid"],
            Value::from(OwnedObjectPath::try_from("/org/mpris/MediaPlayer2/track/4").unwrap())
        );
    }

    fn state(track_id: i64, sequence: u64, position_s: f64) -> MprisState {
        MprisState {
            track_id,
            sequence,
            sampled_at_ms: None,
            playing: true,
            position_s,
            volume: 1.0,
            muted: false,
            speed: 1.0,
            can_next: true,
            can_previous: true,
        }
    }

    #[test]
    fn stale_state_is_ignored_without_rewinding_position() {
        let mut snapshot = Snapshot::new();
        snapshot.track.id = 7;

        assert!(apply_state(&mut snapshot, &state(7, 4, 10.0)).is_some());
        assert!(apply_state(&mut snapshot, &state(7, 3, 1.0)).is_none());
        assert_eq!(snapshot.position_us, 10_000_000);
        assert_eq!(snapshot.last_state_sequence, 4);

        // A newer sequence may legitimately move backward for a user seek.
        assert!(apply_state(&mut snapshot, &state(7, 5, 2.0)).is_some());
        assert_eq!(snapshot.position_us, 2_000_000);
    }

    #[test]
    fn state_before_track_metadata_is_replayed_for_that_track() {
        let mut snapshot = Snapshot::new();
        assert!(apply_state(&mut snapshot, &state(7, 4, 10.0)).is_none());
        assert!(snapshot.pending_state.is_some());

        snapshot.track.id = 7;
        let pending = snapshot.pending_state.take().expect("pending state");
        assert!(apply_state(&mut snapshot, &pending).is_some());
        assert_eq!(snapshot.position_us, 10_000_000);
    }

    #[test]
    fn state_for_another_track_is_ignored() {
        let mut snapshot = Snapshot::new();
        snapshot.track.id = 7;

        assert!(apply_state(&mut snapshot, &state(8, 5, 10.0)).is_none());
        assert_eq!(snapshot.position_us, 0);
        assert_eq!(snapshot.last_state_sequence, 0);
    }
}
