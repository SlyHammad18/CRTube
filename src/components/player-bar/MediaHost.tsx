import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  selectCurrentEntry,
  usePlayerStore,
  SPEED_MAX,
  SPEED_MIN,
} from "../../stores/player";
import { ipc } from "../../lib/ipc";
import { useSlotEls } from "./mediaSlots";

/**
 * Owns the app's single <video> element (plays audio-only files too) and
 * portals it between slots without ever unmounting it — playback survives
 * every view switch. Also binds global player hotkeys (DESIGN §4.8).
 */
export function MediaHost() {
  const entry = usePlayerStore(selectCurrentEntry);
  const [holder, setHolder] = useState<HTMLDivElement | null>(null);
  const els = useSlotEls();
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekNonceRef = useRef(-1);

  const isVideo = entry != null && entry.kind === "video" && entry.path !== "";
  const dest: HTMLDivElement | null =
    (isVideo ? (els.primary ?? els.secondary) : null) ?? holder;

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
            void el.play().catch(() => {});
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
    if (playing) void el.play().catch(() => {});
    else el.pause();
  }, [playing]);

  const speed = usePlayerStore((s) => s.speed);
  useEffect(() => {
    const el = videoRef.current;
    if (el) el.playbackRate = Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed));
  }, [speed]);

  const volume = usePlayerStore((s) => s.volume);
  useEffect(() => {
    const el = videoRef.current;
    if (el) el.volume = volume;
  }, [volume]);

  const seekNonce = usePlayerStore((s) => s.seekNonce);
  const seekTargetS = usePlayerStore((s) => s.seekTargetS);
  useEffect(() => {
    const el = videoRef.current;
    if (!el || seekNonceRef.current === seekNonce) return;
    seekNonceRef.current = seekNonce;
    if (Number.isFinite(seekTargetS)) el.currentTime = seekTargetS;
  }, [seekNonce, seekTargetS]);

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

  // --- element -> store (synthetic events follow the portaled node) -------

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

  const onEnded = () => usePlayerStore.getState().onEnded();

  const onError = () => {
    const el = videoRef.current;
    // Ignore the reset we trigger ourselves via removeAttribute("src").
    if (!el || (!el.error && !el.dataset.path)) return;
    usePlayerStore.getState().onMediaError();
  };

  return (
    <>
      {/* Hidden home for the element when nothing visual claims it.
          Never `display:none` — that can stall some media pipelines. */}
      <div
        ref={setHolder}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 h-px w-px overflow-hidden opacity-0"
      />
      {dest &&
        createPortal(
          <video
            ref={videoRef}
            playsInline
            preload="metadata"
            className="h-full w-full bg-void object-cover"
            onTimeUpdate={onTimeUpdate}
            onDurationChange={onDurationChange}
            onEnded={onEnded}
            onError={onError}
          />,
          dest,
        )}
    </>
  );
}
