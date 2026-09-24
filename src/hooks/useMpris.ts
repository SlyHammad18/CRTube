import { useEffect, useRef } from "react";
import { ipc, type MprisState } from "../lib/ipc";
import { selectCurrentEntry, usePlayerStore } from "../stores/player";
import type { LibraryEntry } from "../types/library";
import { useLyricsOverlayStore } from "../stores/lyricsOverlay";

/**
 * MPRIS exposes `Position` as a non-signalled property that consumers poll, so
 * the frontend only has to keep it roughly current.
 */
const POSITION_PUSH_MS = 1000;
const OVERLAY_POSITION_PUSH_MS = 200;
const MPRIS_STATE_TIMEOUT_MS = 1500;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("MPRIS state update timed out")),
      timeoutMs,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Publishes the player to the desktop media widget (MPRIS on Linux) and applies
 * the widget's commands back to the player store.
 *
 * The Rust side owns the `org.mpris.MediaPlayer2` objects; this hook keeps them
 * fed. Unlike the player WebKitGTK registers for the webview, ours advertises a
 * desktop entry and `CanRaise`, which is what makes clicking the widget raise
 * CRTube.
 */
export function useMpris() {
  const entry = usePlayerStore(selectCurrentEntry);
  const overlayEnabled = useLyricsOverlayStore((s) => s.enabled);
  const positionPushMs = overlayEnabled
    ? OVERLAY_POSITION_PUSH_MS
    : POSITION_PUSH_MS;
  const sequence = useRef(0);

  // WebKitGTK registers an MPRIS player of its own as soon as audio plays, and
  // carries over whatever the page publishes as media-session metadata. That
  // player is inert (no desktop entry, `CanRaise` false), so the shell would
  // list a second, dead CRTube next to ours. Publishing *empty* metadata keeps
  // WebKit's now-playing title empty, and it skips registration without one
  // (`MediaSessionGLib::ensureMprisSessionRegistered`) — while our own player
  // below carries the real title, artist and artwork.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({});
    return () => {
      navigator.mediaSession.metadata = null;
    };
  }, []);

  // Track + artwork: released when the queue empties (the shell then drops the
  // media widget instead of leaving an inert entry behind).
  useEffect(() => {
    const trackSequence = ++sequence.current;
    if (!entry) {
      void ipc.mprisClear().catch(() => {});
      return;
    }
    let alive = true;
    void artUrlFor(entry)
      .then((artUrl) => {
        if (!alive) return undefined;
        return ipc.mprisSetTrack({
          id: entry.id,
          title: entry.title,
          artist: entry.channel,
          durationS: entry.durationS,
          artUrl,
          sequence: trackSequence,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [entry]);

  // Playback state: reported immediately whenever something other than the
  // clock changes, and otherwise at the consumer's polling cadence.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let inFlight = false;
    let pending: MprisState | null = null;
    let last = {
      trackId: -1,
      playing: false,
      volume: -1,
      muted: false,
      speed: -1,
    };

    // Keep at most one state IPC in flight. If the player changes again while
    // Rust is busy, retain only the newest snapshot instead of building a queue
    // of stale positions.
    const flush = async () => {
      if (inFlight) return;
      inFlight = true;
      while (!disposed && pending !== null) {
        const next = pending;
        pending = null;
        try {
          await withTimeout(
            ipc.mprisSetState(next),
            MPRIS_STATE_TIMEOUT_MS,
          );
        } catch {
          // The next player update will retry; do not block the publisher.
        }
      }
      inFlight = false;
    };

    const enqueue = (
      state: Omit<MprisState, "sequence" | "sampledAtMs">,
    ) => {
      pending = {
        ...state,
        sequence: ++sequence.current,
        sampledAtMs: Date.now(),
      };
      void flush();
    };

    const push = () => {
      timer = undefined;
      const player = usePlayerStore.getState();
      const trackId = player.queue[player.order[player.pos]]?.id ?? 0;
      // Every push reports the queue's navigation ability: the widget greys out
      // next/previous when the queue has nowhere to go.
      const canNavigate = player.order.length > 1;
      enqueue({
        trackId,
        playing: player.playing,
        positionS: player.currentTimeS,
        volume: player.volume,
        muted: player.muted,
        speed: player.speed,
        canNext: canNavigate,
        canPrevious: canNavigate,
      });
      last = {
        trackId,
        playing: player.playing,
        volume: player.volume,
        muted: player.muted,
        speed: player.speed,
      };
    };

    push();
    const unsubscribe = usePlayerStore.subscribe(() => {
      const player = usePlayerStore.getState();
      const trackId = player.queue[player.order[player.pos]]?.id ?? 0;
      if (
        trackId !== last.trackId ||
        player.playing !== last.playing ||
        player.volume !== last.volume ||
        player.muted !== last.muted ||
        player.speed !== last.speed
      ) {
        if (timer != null) clearTimeout(timer);
        push();
        return;
      }
      if (timer == null) timer = setTimeout(push, positionPushMs);
    });

    return () => {
      disposed = true;
      pending = null;
      unsubscribe();
      if (timer != null) clearTimeout(timer);
    };
  }, [positionPushMs]);

  // Widget -> app. The player store owns playback; MPRIS only asks it to move.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void ipc
      .onMprisCommand(({ action, value }) => {
        const player = usePlayerStore.getState();
        switch (action) {
          case "play":
            if (!player.playing) player.toggle();
            break;
          case "pause":
            if (player.playing) player.toggle();
            break;
          case "playpause":
            player.toggle();
            break;
          case "next":
            player.next();
            break;
          case "previous":
            player.prev();
            break;
          case "stop":
            if (player.playing) player.toggle();
            player.seek(0);
            break;
          case "seek":
            if (typeof value === "number") player.seek(value);
            break;
          case "set_volume":
            if (typeof value === "number") {
              player.setVolume(value);
              if (value > 0 && player.muted) player.setMuted(false);
            }
            break;
          case "set_rate":
            if (typeof value === "number") player.setSpeed(value);
            break;
        }
      })
      .then((fn) => {
        // Registering is async, so a teardown that lands first (StrictMode's
        // double-invoke, an HMR remount) would otherwise leave its listener
        // behind — and two live listeners toggle twice, cancelling each other
        // out so play/pause looks dead.
        if (cancelled) fn();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}

/**
 * Artwork URL for the widget: a remote thumbnail when there is one, else the
 * cached thumb from the loopback streamer — `file://` is not readable by the
 * shell, and the streamer is what already serves the player.
 */
async function artUrlFor(entry: LibraryEntry): Promise<string | undefined> {
  const thumb = entry.thumbUrl ?? "";
  if (thumb.startsWith("http://") || thumb.startsWith("https://")) return thumb;
  try {
    return (await ipc.thumbMediaUrl(entry.videoId)) ?? undefined;
  } catch {
    return undefined;
  }
}
