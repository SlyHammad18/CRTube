import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { DotsSixVertical, MusicNotes, X } from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ipc } from "../../lib/ipc";
import { activeIndex } from "../../lib/lrc";
import { fmtDuration, isUrduScript, stripMediaExt } from "../../lib/format";
import { useLyrics } from "../../hooks/useLyrics";
import type { LyricsOverlaySnapshot } from "../../types/lyricsOverlay";

const SNAP_DEBOUNCE_MS = 140;
const SNAPSHOT_POLL_MS = 200;
const SNAPSHOT_TIMEOUT_MS = 1000;
const CLOCK_TICK_MS = 50;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("lyrics overlay snapshot timed out")),
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

function useOverlaySnapshot(): LyricsOverlaySnapshot | null {
  const [snapshot, setSnapshot] = useState<LyricsOverlaySnapshot | null>(null);

  useEffect(() => {
    let alive = true;
    let requestId = 0;
    let timer: number | undefined;
    const poll = async () => {
      const id = ++requestId;
      try {
        const next = await withTimeout(
          ipc.lyricsOverlaySnapshot(),
          SNAPSHOT_TIMEOUT_MS,
        );
        if (!alive || id !== requestId) return;
        if (next === null) {
          setSnapshot(null);
          return;
        }
        // The Rust response must carry the ordering token. Treat a malformed
        // response as transient rather than silently disabling stale-sample
        // protection with `undefined`.
        if (Number.isFinite(next.sequence)) {
          setSnapshot(next);
        }
      } catch {
        // Keep the last good snapshot. A transient IPC/DB stall should not
        // blank the overlay or stop the next poll from being scheduled.
      } finally {
        if (alive && id === requestId) {
          timer = window.setTimeout(poll, SNAPSHOT_POLL_MS);
        }
      }
    };
    void poll();
    return () => {
      alive = false;
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  return snapshot;
}

function useInterpolatedPosition(snapshot: LyricsOverlaySnapshot | null): number {
  const [positionS, setPositionS] = useState(0);
  const clock = useRef({ base: 0, at: 0, playing: false, speed: 1 });
  const lastTrackId = useRef<number | null>(null);
  const lastSequence = useRef(-1);

  useEffect(() => {
    if (!snapshot) {
      lastTrackId.current = null;
      lastSequence.current = -1;
      clock.current = {
        base: 0,
        at: performance.now(),
        playing: false,
        speed: 1,
      };
      setPositionS(0);
      return;
    }

    if (!Number.isFinite(snapshot.sequence)) return;
    const sameTrack = lastTrackId.current === snapshot.entry.id;
    if (sameTrack && snapshot.sequence <= lastSequence.current) return;
    lastTrackId.current = snapshot.entry.id;
    lastSequence.current = snapshot.sequence;

    clock.current = {
      base: snapshot.positionS,
      at: performance.now(),
      playing: snapshot.playing,
      speed: snapshot.speed,
    };
    setPositionS(snapshot.positionS);
  }, [snapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = clock.current;
      const elapsed = current.playing
        ? ((performance.now() - current.at) / 1000) * current.speed
        : 0;
      setPositionS(current.base + elapsed);
    }, CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  return positionS;
}

function useMagneticSnap() {
  useEffect(() => {
    const win = getCurrentWindow();
    let timer: number | undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void win
      .onMoved(() => {
        if (timer != null) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          void ipc.snapLyricsOverlay().catch(() => {});
        }, SNAP_DEBOUNCE_MS);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });

    return () => {
      disposed = true;
      if (timer != null) window.clearTimeout(timer);
      unlisten?.();
    };
  }, []);
}

function LyricLine({
  text,
  active,
  reduced,
}: {
  text: string;
  active: boolean;
  reduced: boolean;
}) {
  const urdu = isUrduScript(text);
  return (
    <motion.p
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: active ? 1 : 0.62, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.18 }}
      dir="auto"
      className={`text-center ${
        urdu ? "font-urdu text-right" : ""
      } ${
        active
          ? `line-clamp-2 ${urdu ? "font-urdu" : "font-display"} text-18 font-semibold leading-snug text-ink`
          : "line-clamp-1 text-12 leading-snug text-mute"
      }`}
    >
      {text}
    </motion.p>
  );
}

export function LyricsOverlay() {
  const reduce = useReducedMotion();
  const snapshot = useOverlaySnapshot();
  const positionS = useInterpolatedPosition(snapshot);
  const entry = snapshot?.entry ?? null;
  const lyrics = useLyrics(entry, snapshot?.lyricsRevision);
  const trackKey = entry ? `${entry.id}:${entry.videoId}` : null;
  const lyricsMatch = lyrics.trackKey === trackKey;
  useMagneticSnap();

  const active = useMemo(() => {
    if (!lyricsMatch || lyrics.source !== "synced" || lyrics.lines.length === 0) {
      return null;
    }
    const index = activeIndex(
      lyrics.lines,
      Math.max(0, positionS * 1000 - lyrics.offsetMs),
    );
    const currentIndex = Math.max(0, Math.min(index, lyrics.lines.length - 1));
    const displayLine = (lineIndex: number, role: string) => {
      const line = lyrics.lines[lineIndex];
      return line
        ? { key: `${role}-${line.tMs}-${line.text}`, text: line.text }
        : null;
    };
    return {
      previous: currentIndex > 0 ? displayLine(currentIndex - 1, "previous") : null,
      current: displayLine(currentIndex, "current"),
      next:
        currentIndex + 1 < lyrics.lines.length
          ? displayLine(currentIndex + 1, "next")
          : null,
    };
  }, [lyricsMatch, lyrics.lines, lyrics.offsetMs, lyrics.source, positionS]);

  const beginDrag = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    void getCurrentWindow().startDragging().catch(() => {});
  };

  const close = () => {
    void ipc.setLyricsOverlayEnabled(false).catch(() => {});
  };

  let content: React.ReactNode;
  if (!entry) {
    content = (
      <div className="grid h-full place-items-center font-mono text-12 text-dim">
        &gt; nothing playing_
      </div>
    );
  } else if (!lyricsMatch || lyrics.status === "loading" || lyrics.status === "idle") {
    content = (
      <div className="grid h-full place-items-center font-mono text-12 text-dim">
        &gt; loading lyrics_
      </div>
    );
  } else if (lyrics.status === "instrumental") {
    content = (
      <div className="grid h-full place-items-center">
        <span className="rounded-full border border-line px-3 py-1 font-mono text-11 uppercase tracking-wide text-dim">
          instrumental
        </span>
      </div>
    );
  } else if (lyrics.status === "none" || lyrics.status === "error") {
    content = (
      <div className="grid h-full place-items-center font-mono text-12 text-dim">
        &gt; no lyrics_
      </div>
    );
  } else if (lyrics.source === "plain") {
    content = (
      <div className="h-full overflow-y-auto whitespace-pre-wrap px-4 py-2 text-center text-12 leading-relaxed text-mute">
        {lyrics.plain}
      </div>
    );
  } else if (active) {
    content = (
      <div className="flex h-full flex-col justify-center gap-1.5 px-5 text-center">
        {active.previous && (
          <LyricLine
            key={active.previous.key}
            text={active.previous.text}
            active={false}
            reduced={!!reduce}
          />
        )}
        {active.current && (
          <LyricLine
            key={active.current.key}
            text={active.current.text}
            active
            reduced={!!reduce}
          />
        )}
        {active.next && (
          <LyricLine
            key={active.next.key}
            text={active.next.text}
            active={false}
            reduced={!!reduce}
          />
        )}
      </div>
    );
  }

  return (
    <div className="h-full w-full p-1">
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-card border border-line bg-panel/95 shadow-panel">
        <div className="flex h-8 shrink-0 items-center border-b border-line bg-void/35">
          <button
            type="button"
            aria-label="Drag floating lyrics"
            title="Drag to move · edges snap automatically"
            onMouseDown={beginDrag}
            className="flex min-w-0 flex-1 cursor-grab items-center gap-2 px-2 text-left active:cursor-grabbing"
          >
            <DotsSixVertical size={13} weight="bold" className="shrink-0 text-dim" aria-hidden />
            <MusicNotes size={12} weight="light" className="shrink-0 text-ice" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-11 font-medium text-ink">
              {entry?.title ?? "Floating lyrics"}
            </span>
            {entry?.channel && (
              <span className="max-w-28 shrink-0 truncate text-11 text-mute">
                {stripMediaExt(entry.channel)}
              </span>
            )}
          </button>
          <button
            type="button"
            aria-label="Close floating lyrics"
            title="Close floating lyrics"
            onClick={close}
            className="mr-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-card text-dim transition-colors duration-150 hover:bg-signal hover:text-void active:scale-[0.98]"
          >
            <X size={12} weight="light" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1">{content}</div>

        <div className="flex h-6 shrink-0 items-center justify-between border-t border-line px-2 font-mono text-11 text-mute">
          <span className="tabular-nums">
            {fmtDuration(positionS) ?? "0:00"} / {fmtDuration(entry?.durationS) ?? "—"}
          </span>
          <span className="flex items-center gap-1.5">
            {snapshot?.playing && <span className="h-1 w-1 rounded-full bg-ice" aria-hidden />}
            {snapshot?.playing ? "live" : "paused"}
          </span>
        </div>
      </div>
    </div>
  );
}
