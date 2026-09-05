import { useEffect, useLayoutEffect, useRef } from "react";
import {
  selectCurrentEntry,
  usePlayerStore,
  SPEED_MAX,
  SPEED_MIN,
} from "../../stores/player";
import { ipc } from "../../lib/ipc";
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

  const isVideo = entry != null && entry.kind === "video" && entry.path !== "";

  // When video playback is disabled, the picture is hidden (thumbnail shows
  // behind the slot) but the element keeps decoding/playing audio. We force the
  // "none" stage so the overlay is never positioned — applyLayout hides it via
  // visibility without pausing the media.
  const showVideo = isVideo && !videoDisabled;

  // Auto-disable per track: when the "Disable video playback" setting is on,
  // reset `videoDisabled` to true for each new video track (and immediately when
  // the setting is toggled on). The in-player button stays enabled and toggles
  // `videoDisabled` freely within a track, so clicking it plays video that one
  // time; the next track re-applies the setting.
  const lastVideoId = useRef<number | null>(null);
  const prevAuto = useRef(autoDisableVideo);
  useEffect(() => {
    const id = entry?.id ?? null;
    const trackChanged = id !== lastVideoId.current;
    const settingJustOn = autoDisableVideo && !prevAuto.current;
    lastVideoId.current = id;
    prevAuto.current = autoDisableVideo;
    if (autoDisableVideo && (trackChanged || settingJustOn)) {
      if (isVideo) useUIStore.getState().setVideoDisabled(true);
    }
  }, [entry, isVideo, autoDisableVideo]);

  // Sync with system MediaSession API (MPRIS on Linux desktop / GNOME
  // Notification Center). Artwork must be an http(s) URL: WebKit only
  // publishes artwork its own image loader fetched (so file:// is refused from
  // our origin), and the shell then fetches the published mpris:artUrl itself
  // (so Tauri's asset:// is unknown to it). Cached thumbs therefore come from
  // the loopback media server.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (!entry) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      return;
    }

    const setMetadata = (artSrc: string) => {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: entry.title,
        artist: entry.channel || "CRTube",
        album: "CRTube",
        artwork: artSrc
          ? [
              { src: artSrc, sizes: "512x512" },
              { src: artSrc, sizes: "256x256" },
              { src: artSrc, sizes: "96x96" },
            ]
          : [],
      });
    };

    const thumbUrl = entry.thumbUrl ?? "";
    if (thumbUrl.startsWith("http://") || thumbUrl.startsWith("https://")) {
      setMetadata(thumbUrl);
      return;
    }

    // Local cached thumb — publish the loopback stream URL once known.
    let alive = true;
    void ipc
      .thumbMediaUrl(entry.videoId)
      .then((url) => {
        if (alive) setMetadata(url ?? "");
      })
      .catch(() => {
        if (alive) setMetadata("");
      });
    return () => {
      alive = false;
    };
  }, [entry]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;

    const setHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null,
    ) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Ignore unsupported actions
      }
    };

    setHandler("play", () => {
      if (!usePlayerStore.getState().playing) usePlayerStore.getState().toggle();
    });
    setHandler("pause", () => {
      if (usePlayerStore.getState().playing) usePlayerStore.getState().toggle();
    });
    setHandler("previoustrack", () => usePlayerStore.getState().prev());
    setHandler("nexttrack", () => usePlayerStore.getState().next());
    setHandler("seekto", (details) => {
      if (details.seekTime != null) {
        usePlayerStore.getState().seek(details.seekTime);
      }
    });

    return () => {
      setHandler("play", null);
      setHandler("pause", null);
      setHandler("previoustrack", null);
      setHandler("nexttrack", null);
      setHandler("seekto", null);
    };
  }, []);

  // Which stage the live video overlays, and whether it's visible at all.
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

  const entryId = entry?.id;
  const entryPath = entry?.path;
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!entry || !entryPath) {
      el.pause();
      el.removeAttribute("src");
      el.load();
      return;
    }
    if (el.dataset.path !== entryPath) {
      let alive = true;
      void ipc
        .mediaUrl(entry.id)
        .then((url) => {
          if (!alive) return;
          if (!url) {
            usePlayerStore.getState().onMediaError();
            return;
          }
          el.dataset.path = entryPath;
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
        .catch(() => usePlayerStore.getState().onMediaError());
      return () => {
        alive = false;
      };
    }
  }, [entry, entryId, entryPath]);

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
  useEffect(() => {
    const el = videoRef.current;
    if (!el || seekNonceRef.current === seekNonce) return;
    seekNonceRef.current = seekNonce;
    if (Number.isFinite(seekTargetS)) el.currentTime = seekTargetS;
  }, [seekNonce, seekTargetS]);

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

  const lastSyncSec = useRef(-1);
  const syncPositionState = (currentTime: number, duration: number) => {
    if (
      typeof navigator === "undefined" ||
      !("mediaSession" in navigator) ||
      !("setPositionState" in navigator.mediaSession) ||
      duration <= 0 ||
      !Number.isFinite(duration)
    ) {
      return;
    }
    const sec = Math.floor(currentTime);
    if (sec === lastSyncSec.current) return;
    lastSyncSec.current = sec;
    try {
      navigator.mediaSession.setPositionState({
        duration: Math.max(0, duration),
        playbackRate: usePlayerStore.getState().speed,
        position: Math.min(Math.max(0, currentTime), duration),
      });
    } catch {
      // Ignore
    }
  };

  const onTimeUpdate = () => {
    const el = videoRef.current;
    if (!el) return;
    const dur = Number.isFinite(el.duration) ? el.duration : 0;
    usePlayerStore.getState().syncTime(el.currentTime, dur);
    syncPositionState(el.currentTime, dur);
  };

  const onDurationChange = () => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration)) return;
    usePlayerStore.getState().syncTime(el.currentTime, el.duration);
    syncPositionState(el.currentTime, el.duration);
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
    if (!el || (!el.error && !el.dataset.path)) return;
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
    />
  );
}
