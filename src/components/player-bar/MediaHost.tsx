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

  const isVideo = entry != null && entry.kind === "video" && entry.path !== "";

  // Which stage the live video overlays, and whether it's visible at all.
  const els = useSlotEls();
  const stage: "fullscreen" | "primary" | "secondary" | "none" =
    videoFullscreen && isVideo
      ? "fullscreen"
      : isVideo
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
  // Runs whenever the stage could change, and via a rAF loop + observers so
  // it tracks CSS transitions (PlayerBar spring, view slide) without ever
  // reparenting the element.

  const applyLayout = () => {
    const el = videoRef.current;
    if (!el) return;

    let target: HTMLDivElement | null = null;
    let objectFit: "cover" | "contain" = "cover";
    let z = 10;
    let radius = 10;

    if (stage === "fullscreen") {
      target = els.fullscreen;
      objectFit = "contain";
      z = 96;
      radius = 0;
    } else if (stage === "primary") {
      target = els.primary;
    } else if (stage === "secondary") {
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

  useLayoutEffect(() => {
    applyLayout();
  }, [stage, els.primary, els.secondary, els.fullscreen]);

  useEffect(() => {
    if (stage === "none") return;
    const el = videoRef.current;
    if (!el) return;

    const onResize = () => applyLayout();
    const onScroll = () => applyLayout();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);

    let ro: ResizeObserver | null = null;
    const target =
      stage === "fullscreen"
        ? els.fullscreen
        : stage === "primary"
          ? els.primary
          : stage === "secondary"
            ? els.secondary
            : null;
    if (target && "ResizeObserver" in window) {
      ro = new ResizeObserver(() => applyLayout());
      ro.observe(target);
    }

    // rAF loop tracks CSS transitions/animations of the stage box.
    let raf = 0;
    const tick = () => {
      applyLayout();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
      ro?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [stage, els.primary, els.secondary, els.fullscreen]);

  // --- global hotkeys (§4.8): space / arrows ------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      const s = usePlayerStore.getState();
      switch (e.key) {
        case " ":
          e.preventDefault();
          s.toggle();
          break;
        case "ArrowLeft":
          e.preventDefault();
          s.seek(Math.max(0, s.currentTimeS - 5));
          break;
        case "ArrowRight": {
          e.preventDefault();
          const max = s.durationS > 0 ? s.durationS - 0.05 : s.currentTimeS + 5;
          s.seek(Math.min(max, s.currentTimeS + 5));
          break;
        }
        case "ArrowUp":
          e.preventDefault();
          s.setVolume(s.volume + 0.1);
          break;
        case "ArrowDown":
          e.preventDefault();
          s.setVolume(s.volume - 0.1);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- element -> store (synthetic events follow the stable node) ---------

  const onTimeUpdate = () => {
    const el = videoRef.current;
    if (!el) return;
    usePlayerStore.getState().syncTime(
      el.currentTime,
      Number.isFinite(el.duration) ? el.duration : 0,
    );
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
