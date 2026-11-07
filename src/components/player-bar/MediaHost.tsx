import { useEffect, useLayoutEffect, useRef } from "react";
import {
  selectCurrentEntry,
  usePlayerStore,
  SPEED_MAX,
  SPEED_MIN,
} from "../../stores/player";
import { ipc } from "../../lib/ipc";
import { isStreamTrack } from "../../types/player";
import { pushToast } from "../../stores/toast";
import { useSlotEls } from "./mediaSlots";
import { useUIStore } from "../../stores/ui";
import { useSettingsStore } from "../../stores/settings";

/**
 * Owns the app's single <video> element (plays audio-only files too) and keeps
 * it mounted in ONE stable place for the entire app lifetime. WebKitGTK's
 * GStreamer video sink is a native surface bound to the element's DOM ancestor,
 * so reparenting the node (the old portal approach) tore that surface down and
 * caused black screens + dead controls on Linux.
 *
 * Instead of portaling the node between slots, we leave it where it is and
 * *position* it over the active stage via CSS (top/left/width/height from the
 * target slot's bounding rect). The node never reloads or reparents, so
 * playback is continuous across every view and fullscreen. Playback hotkeys
 * (DESIGN §4.8) are bound here too.
 */
export function MediaHost() {
  const entry = usePlayerStore(selectCurrentEntry);
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekNonceRef = useRef(-1);
  const videoFullscreen = useUIStore((s) => s.videoFullscreen);
  const videoDisabled = useUIStore((s) => s.videoDisabled);
  const autoDisableVideo = useSettingsStore(
    (s) => s.settings?.disable_video_playback ?? false,
  );

  const isVideo =
    entry != null &&
    (isStreamTrack(entry)
      ? entry.kind === "video"
      : entry.kind === "video" && entry.path !== "");

  // Stream picture control is the entry's audio⇄video kind toggle; the global
  // `videoDisabled` flag (and the "disable video playback" setting) only
  // govern DOWNLOADED files.
  const isStream = entry != null && isStreamTrack(entry);
  const showVideo = isStream ? isVideo : isVideo && !videoDisabled;

  // Auto-disable per track: when the "Disable video playback" setting is on,
  // reset `videoDisabled` to true for each new DOWNLOADED video track (and
  // immediately when the setting is toggled on). Stream tracks are excluded —
  // their kind toggle governs the picture.
  const lastTrackKey = useRef<string | null>(null);
  const prevAuto = useRef(autoDisableVideo);
  useEffect(() => {
    const key = entry
      ? isStreamTrack(entry)
        ? entry.videoId
        : String(entry.id)
      : null;
    const trackChanged = key !== lastTrackKey.current;
    const settingJustOn = autoDisableVideo && !prevAuto.current;
    lastTrackKey.current = key;
    prevAuto.current = autoDisableVideo;
    if (
      autoDisableVideo &&
      (trackChanged || settingJustOn) &&
      isVideo &&
      entry != null &&
      !isStreamTrack(entry)
    ) {
      useUIStore.getState().setVideoDisabled(true);
    }
  }, [entry, isVideo, autoDisableVideo]);

  // --- imperative sync: store -> element ----------------------------------
  const els = useSlotEls();
  const stage: "fullscreen" | "primary" | "secondary" | "none" =
    videoFullscreen && showVideo
      ? "fullscreen"
      : showVideo
        ? els.primary
          ? "primary"
          : els.secondary
            ? "secondary"
            : "none"
        : "none";

  // --- imperative sync: store -> element ----------------------------------

  // Stable identity of the current media source. Changing it (re)resolves the
  // loopback URL: library entries serve the downloaded file, stream tracks
  // relay a yt-dlp-resolved URL whose signed upstream expires (→ one silent
  // retry in onError).
  const stream =
    entry && isStreamTrack(entry)
      ? { videoId: entry.videoId, kind: entry.kind }
      : null;
  const libraryId = entry && !isStreamTrack(entry) ? entry.id : undefined;
  const libraryPath = entry && !isStreamTrack(entry) ? entry.path : undefined;
  const srcKey = stream
    ? `stream:${stream.videoId}:${stream.kind}`
    : libraryId != null && libraryPath
      ? `lib:${libraryId}:${libraryPath}`
      : null;
  // Latest stream identity for the error handler (no stale closures).
  const streamRef = useRef<
    { videoId: string; kind: "audio" | "video"; srcKey: string } | null
  >(null);
  streamRef.current = stream ? { ...stream, srcKey: srcKey! } : null;
  // One forced re-resolve per source key; reset on every successful load.
  const retriedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!entry || !srcKey) {
      el.pause();
      el.removeAttribute("src");
      el.dataset.srcKey = "";
      el.load();
      usePlayerStore.getState().setBuffering(false);
      return;
    }
    if (el.dataset.srcKey !== srcKey) {
      // Stop the previous source RIGHT NOW: resolving the new one can take
      // seconds (stream extraction), and the old audio must not keep playing
      // underneath. The store's buffering flag covers the gap until canplay.
      el.pause();
      el.removeAttribute("src");
      el.dataset.srcKey = "";
      el.load();
      usePlayerStore.getState().setBuffering(true);
      let alive = true;
      const resolve = stream
        ? ipc.streamMediaUrl(stream.videoId, stream.kind)
        : ipc.mediaUrl(libraryId!);
      void resolve
        .then((url) => {
          if (!alive) return;
          if (!url) {
            delete el.dataset.srcKey;
            onResolveFailed();
            return;
          }
          el.dataset.srcKey = srcKey;
          retriedKeyRef.current = null;
          el.src = url;
          el.load();
          if (usePlayerStore.getState().playing) {
            void el.play().catch((e) => {
              if (e?.name !== "AbortError") {
                // Surface resolved once metadata is ready.
                const retry = () => {
                  if (usePlayerStore.getState().playing) void el.play().catch(() => {});
                  el.removeEventListener("loadeddata", retry);
                  el.removeEventListener("canplay", retry);
                };
                el.addEventListener("loadeddata", retry);
                el.addEventListener("canplay", retry);
              }
            });
          }
        })
        .catch(() => {
          if (!alive) return;
          delete el.dataset.srcKey;
          onResolveFailed();
        });
      return () => {
        alive = false;
      };
    }
  }, [entry, srcKey, stream]);

  const playing = usePlayerStore((s) => s.playing);
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !el.currentSrc) return;
    if (playing) {
      void el.play().catch((e) => {
        if (e?.name !== "AbortError") {
          const retry = () => {
            if (usePlayerStore.getState().playing) void el.play().catch(() => {});
            el.removeEventListener("loadeddata", retry);
            el.removeEventListener("canplay", retry);
          };
          el.addEventListener("loadeddata", retry);
          el.addEventListener("canplay", retry);
        }
      });
    } else {
      el.pause();
      // Nothing is attempting to play — the buffering label must not linger.
      usePlayerStore.getState().setBuffering(false);
    }
  }, [playing]);

  const speed = usePlayerStore((s) => s.speed);
  useEffect(() => {
    const el = videoRef.current;
    if (el) el.playbackRate = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
  }, [speed]);

  const volume = usePlayerStore((s) => s.volume);
  const muted = usePlayerStore((s) => s.muted);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = muted;
    el.volume = volume;
  }, [volume, muted]);

  const seekNonce = usePlayerStore((s) => s.seekNonce);
  const seekTargetS = usePlayerStore((s) => s.seekTargetS);
  // A seek requested before the media has loaded (e.g. the resume-session
  // restore at boot) is stashed here and applied once metadata is available —
  // setting `currentTime` on a HAVE_NOTHING element is unreliable.
  const pendingSeekRef = useRef<number | null>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el || seekNonceRef.current === seekNonce) return;
    seekNonceRef.current = seekNonce;
    if (Number.isFinite(seekTargetS)) {
      if (el.readyState >= 2) {
        el.currentTime = seekTargetS;
      } else {
        pendingSeekRef.current = seekTargetS;
      }
    }
  }, [seekNonce, seekTargetS]);

  // Apply any pending seek as soon as the current source has metadata.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const apply = () => {
      if (pendingSeekRef.current == null) return;
      if (el.readyState < 1) return;
      el.currentTime = pendingSeekRef.current;
      pendingSeekRef.current = null;
    };
    el.addEventListener("loadedmetadata", apply);
    apply();
    return () => el.removeEventListener("loadedmetadata", apply);
  }, [srcKey]);

  // --- layout: keep the single node positioned over the active stage ------
  // The node is `position: fixed`, so it does NOT move with page scroll and
  // only needs re-positioning when (a) the stage changes, (b) the window
  // resizes, or (c) an ancestor is mid-transition (PlayerBar spring, view
  // slide). We therefore run the getBoundingClientRect layout loop for a
  // *bounded* window after each of those triggers instead of every frame
  // forever — a perpetual rAF read forces a synchronous reflow that starves
  // the compositor and makes every other animation stutter.

  // Latest stage in a ref so the single scheduled rAF tick never reads a stale
  // closure value (a previously-scheduled frame from an earlier render).
  const stageRef = useRef(stage);
  stageRef.current = stage;

  const applyLayout = () => {
    const el = videoRef.current;
    if (!el) return;

    let target: HTMLDivElement | null = null;
    let objectFit: "cover" | "contain" = "cover";
    let z = 10;
    let radius = 10;

    const s = stageRef.current;
    if (s === "fullscreen") {
      target = els.fullscreen;
      objectFit = "contain";
      z = 96;
      radius = 0;
    } else if (s === "primary") {
      target = els.primary;
    } else if (s === "secondary") {
      target = els.secondary;
    }

    if (!target) {
      // No visible stage (audio-only, or between view transitions): keep the
      // element alive but invisible. Never display:none — that stalls media.
      el.style.visibility = "hidden";
      return;
    }

    const r = target.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) {
      el.style.visibility = "hidden";
      return;
    }

    el.style.position = "fixed";
    el.style.top = `${r.top}px`;
    el.style.left = `${r.left}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
    el.style.objectFit = objectFit;
    el.style.borderRadius = `${radius}px`;
    el.style.zIndex = `${z}`;
    el.style.visibility = "visible";
  };

  // Bounded rAF tracker: keeps the node glued to the stage only while an
  // ancestor transition is actually in flight, then idles (zero main-thread
  // cost). Always (re)schedules the latest tick so no stale closure survives.
  const trackUntilRef = useRef(0);
  const rafRef = useRef(0);

  const tick = () => {
    const el = videoRef.current;
    if (el && performance.now() < trackUntilRef.current && stageRef.current !== "none") {
      applyLayout();
      el.style.willChange = "top, left, width, height";
      rafRef.current = requestAnimationFrame(tick);
    } else {
      rafRef.current = 0;
      if (el) el.style.willChange = "auto";
    }
  };

  const kick = (ms: number) => {
    trackUntilRef.current = Math.max(
      trackUntilRef.current,
      performance.now() + ms,
    );
    if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  };

  useLayoutEffect(() => {
    applyLayout();
    if (stageRef.current !== "none") kick(450);
  }, [stage, els.primary, els.secondary, els.fullscreen]);

  useEffect(() => {
    if (stageRef.current === "none") return;
    const el = videoRef.current;
    if (!el) return;

    const onResize = () => {
      applyLayout();
      kick(450);
    };
    window.addEventListener("resize", onResize);

    let ro: ResizeObserver | null = null;
    const target =
      stageRef.current === "fullscreen"
        ? els.fullscreen
        : stageRef.current === "primary"
          ? els.primary
          : stageRef.current === "secondary"
            ? els.secondary
            : null;
    if (target && "ResizeObserver" in window) {
      ro = new ResizeObserver(() => {
        applyLayout();
        kick(450);
      });
      ro.observe(target);
    }

    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [stage, els.primary, els.secondary, els.fullscreen]);

  // --- element -> store (synthetic events follow the stable node) ---------

  // Buffering truth model: the flag goes up when a new source starts
  // resolving (the resolve effect) or the element stalls mid-playback
  // (`waiting` — only while playing; a paused element isn't waiting on
  // anything), and comes down on the first decoded frame (loadeddata),
  // readiness (canplay), playback (playing), or seek completion (seeked).
  // The `seeked` + timeupdate signals matter because WebKitGTK/GStreamer
  // resumes playback after a stalled seek by firing ONLY `seeked` with
  // readyState parked at HAVE_CURRENT_DATA — `canplay`/`playing` never
  // refire, and without `seeked` the veil would stay up while frames flow.
  // The element's own `pause` event is deliberately unused (queued task,
  // races the resolve flag); a user pause clears via the store's `playing`
  // effect below.
  const onWaiting = () => {
    const el = videoRef.current;
    if (el && !el.paused) usePlayerStore.getState().setBuffering(true);
  };
  const onBufferedReady = () => usePlayerStore.getState().setBuffering(false);

  /** Resolve/extraction failed for the current source. Stream video is the
   *  special case: many videos expose no muxed (directly playable) format, so
   *  instead of killing the whole track we fall back to its audio stream. */
  const onResolveFailed = () => {
    usePlayerStore.getState().setBuffering(false);
    const cur = streamRef.current;
    if (cur && cur.kind === "video") {
      usePlayerStore.getState().setStreamKind("audio");
      pushToast("Video stream unavailable for this track — playing audio");
      return;
    }
    usePlayerStore.getState().onMediaError();
  };

  const onTimeUpdate = () => {
    const el = videoRef.current;
    if (!el) return;
    // Backstop for the buffering flag: frames are advancing and data is
    // current — nothing is being waited on, whatever event was missed.
    if (!el.paused && !el.ended && el.readyState >= 2) {
      usePlayerStore.getState().setBuffering(false);
    }
    const dur = Number.isFinite(el.duration) ? el.duration : 0;
    usePlayerStore.getState().syncTime(el.currentTime, dur);
  };

  const onDurationChange = () => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    usePlayerStore.getState().syncTime(el.currentTime, el.duration);
  };

  const onEnded = () => {
    const store = usePlayerStore.getState();
    const repeatOne = store.repeat === "one";
    store.onEnded();
    const el = videoRef.current;
    // Repeat-one keeps `playing` true and the same entry, so neither the
    // `playing` nor the entry effect re-fires to resume the paused element.
    if (el && repeatOne && usePlayerStore.getState().playing) {
      el.currentTime = 0;
      void el.play().catch(() => {});
    }
  };

  const onError = () => {
    const el = videoRef.current;
    // Ignore the reset we trigger ourselves via removeAttribute("src").
    if (!el || !el.error) return;
    usePlayerStore.getState().setBuffering(false);
    // A stream's signed upstream URL can expire mid-playback (the relay answers
    // 502 → element error). Re-resolve once, silently, preserving the playhead.
    const cur = streamRef.current;
    if (cur && retriedKeyRef.current !== cur.srcKey) {
      retriedKeyRef.current = cur.srcKey;
      const at = el.currentTime;
      usePlayerStore.getState().setBuffering(true);
      void ipc
        .streamMediaUrl(cur.videoId, cur.kind, true)
        .then((url) => {
          const still = streamRef.current;
          if (!still || still.srcKey !== cur.srcKey) return; // track moved on
          if (!url) {
            onResolveFailed();
            return;
          }
          pendingSeekRef.current = at;
          el.dataset.srcKey = cur.srcKey;
          el.src = url;
          el.load();
          if (usePlayerStore.getState().playing) void el.play().catch(() => {});
        })
        .catch(() => {
          if (streamRef.current && streamRef.current.srcKey === cur.srcKey) {
            onResolveFailed();
          }
        });
      return;
    }
    usePlayerStore.getState().onMediaError();
  };

  return (
    <video
      ref={videoRef}
      playsInline
      preload="auto"
      className="pointer-events-none bg-void"
      style={{ position: "fixed", top: 0, left: 0, width: 0, height: 0, visibility: "hidden" }}
      onTimeUpdate={onTimeUpdate}
      onDurationChange={onDurationChange}
      onEnded={onEnded}
      onError={onError}
      onWaiting={onWaiting}
      onLoadedData={onBufferedReady}
      onCanPlay={onBufferedReady}
      onPlaying={onBufferedReady}
      onSeeked={onBufferedReady}
    />
  );
}
