import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "../lib/ipc";
import type { LyricsPayload, LyricsCandidate } from "../types/lyrics";
import { parseLrc, type LrcLine } from "../lib/lrc";
import type { LibraryEntry } from "../types/library";

export type LyricsStatus =
  | "idle"
  | "loading"
  | "loaded"
  | "instrumental"
  | "none"
  | "error";

export interface LyricsState {
  status: LyricsStatus;
  lines: LrcLine[];
  plain: string | null;
  source: "synced" | "plain" | null;
  trackName: string;
  artistName: string;
  cached: boolean;
  override: boolean;
  /** User-tuned display sync offset in ms (positive = lyrics lag audio). */
  offsetMs: number;
  /** LRCLIB search — returns candidate matches so the user can pick one. */
  search: (query: string) => Promise<LyricsCandidate[]>;
  /** Persist a chosen/edited lyric set for this track (sticky per-song override). */
  apply: (payload: LyricsPayload) => void;
  /** Drop any stored override for this track so auto-fetch resumes. */
  clearLyrics: (videoId: string) => void;
  /** Set the display sync offset (ms) absolutely — persisted per-song. */
  setOffset: (ms: number) => void;
  /**
   * Shift the offset by `deltaMs` from the latest committed value. Reads a
   * ref rather than state so a burst of presses (or a press right after the
   * typed field commits) can't land on a stale base and drop a step.
   */
  nudge: (deltaMs: number) => void;
}

const IDLE: LyricsState = {
  status: "idle",
  lines: [],
  plain: null,
  source: null,
  trackName: "",
  artistName: "",
  cached: false,
  override: false,
  offsetMs: 0,
  search: async () => [],
  apply: () => {},
  clearLyrics: () => {},
  setOffset: () => {},
  nudge: () => {},
};

interface Resolved {
  status: LyricsStatus;
  lines: LrcLine[];
  plain: string | null;
  source: "synced" | "plain" | null;
  trackName: string;
  artistName: string;
  cached: boolean;
  offsetMs: number;
}

function resolve(p: LyricsPayload): Resolved {
  const synced = p.synced ? parseLrc(p.synced) : [];
  const offsetMs = p.offsetMs ?? 0;
  if (p.instrumental) {
    return {
      status: "instrumental",
      lines: [],
      plain: null,
      source: null,
      trackName: p.trackName,
      artistName: p.artistName,
      cached: p.cached,
      offsetMs,
    };
  }
  if (synced.length > 0) {
    return {
      status: "loaded",
      lines: synced,
      plain: p.plain,
      source: "synced",
      trackName: p.trackName,
      artistName: p.artistName,
      cached: p.cached,
      offsetMs,
    };
  }
  if (p.plain) {
    const lines = p.plain
      .split(/\r?\n/)
      .map((t, i) => ({ tMs: i * 1000, text: t.trim() }))
      .filter((l) => l.text.length > 0);
    return {
      status: "loaded",
      lines,
      plain: p.plain,
      source: "plain",
      trackName: p.trackName,
      artistName: p.artistName,
      cached: p.cached,
      offsetMs,
    };
  }
  return {
    status: "none",
    lines: [],
    plain: null,
    source: null,
    trackName: p.trackName,
    artistName: p.artistName,
    cached: p.cached,
    offsetMs,
  };
}

/**
 * Lazy LRCLIB-backed lyrics for the current track. Fetches when the active
 * entry changes (≈ first play); Rust caches hits so re-plays are instant.
 * `search` lists candidate matches and `apply` persists a chosen/edited set as
 * a sticky per-song override (the fallback ladder for missing/wrong lyrics).
 */
export function useLyrics(entry: LibraryEntry | null): LyricsState {
  const [state, setState] = useState<LyricsState>(IDLE);
  const reqId = useRef(0);
  /** Last committed offset (ms) — synchronous twin of `state.offsetMs`. */
  const offsetRef = useRef(0);

  const load = useCallback((e: LibraryEntry, override?: { title: string; artist: string }) => {
    const id = ++reqId.current;
    setState((s) => ({ ...s, status: "loading", override: !!override }));
    const title = override?.title ?? e.title;
    const artist = override?.artist ?? e.channel ?? "";
    ipc
      .fetchLyrics(
        e.videoId,
        title,
        artist || undefined,
        e.durationS != null ? Math.round(e.durationS) : undefined,
      )
      .then((payload: LyricsPayload | null) => {
        if (id !== reqId.current) return;
        if (!payload) {
          offsetRef.current = 0;
          setState({ ...IDLE, status: "none", override: !!override });
          return;
        }
        offsetRef.current = payload.offsetMs ?? 0;
        setState({ ...IDLE, ...resolve(payload), override: !!override });
      })
      .catch(() => {
        if (id !== reqId.current) return;
        offsetRef.current = 0;
        setState({ ...IDLE, status: "error", override: !!override });
      });
  }, []);

  useEffect(() => {
    if (!entry) {
      reqId.current++;
      offsetRef.current = 0;
      setState(IDLE);
      return;
    }
    const e = entry;
    load(e);
  }, [entry?.id, load]);

  const search = useCallback(
    (query: string) => ipc.searchLyrics(query.trim()),
    [],
  );

  const apply = useCallback(
    (payload: LyricsPayload) => {
      if (!entry) return;
      const myReq = reqId.current;
      const id = entry.videoId;
      ipc
        .setLyrics(id, payload)
        .then(() => {
          if (reqId.current !== myReq) return;
          // Keep the user's tuned offset — changing the lyric text shouldn't reset it.
          setState((s) => ({ ...IDLE, ...resolve(payload), override: true, offsetMs: s.offsetMs }));
        })
        .catch(() => {
          if (reqId.current !== myReq) return;
          setState({ ...IDLE, status: "error", override: true });
        });
    },
    [entry],
  );

  const setOffset = useCallback(
    (ms: number) => {
      if (!entry) return;
      const clamped = Math.max(-100000, Math.min(100000, Math.round(ms)));
      // Commit synchronously: the next nudge must measure from this value even
      // if the IPC round-trip (and its setState) hasn't landed yet.
      offsetRef.current = clamped;
      const myReq = reqId.current;
      ipc
        .setLyricsOffset(entry.videoId, clamped)
        .then(() => {
          if (reqId.current !== myReq) return;
          setState((s) => ({ ...s, offsetMs: clamped }));
        })
        .catch(() => {});
    },
    [entry],
  );

  const nudge = useCallback(
    (deltaMs: number) => setOffset(offsetRef.current + deltaMs),
    [setOffset],
  );

  const clearLyrics = useCallback(
    (videoId: string) => {
      const myReq = reqId.current;
      ipc
        .clearLyrics(videoId)
        .then(() => {
          if (reqId.current !== myReq) return;
          if (entry) load(entry);
        })
        .catch(() => {});
    },
    [entry, load],
  );

  return { ...state, search, apply, clearLyrics, setOffset, nudge };
}
