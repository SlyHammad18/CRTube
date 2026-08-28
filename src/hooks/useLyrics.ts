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
  /** LRCLIB search — returns candidate matches so the user can pick one. */
  search: (query: string) => Promise<LyricsCandidate[]>;
  /** Persist a chosen/edited lyric set for this track (sticky per-song override). */
  apply: (payload: LyricsPayload) => void;
  /** Drop any stored override for this track so auto-fetch resumes. */
  clearLyrics: (videoId: string) => void;
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
  search: async () => [],
  apply: () => {},
  clearLyrics: () => {},
};

interface Resolved {
  status: LyricsStatus;
  lines: LrcLine[];
  plain: string | null;
  source: "synced" | "plain" | null;
  trackName: string;
  artistName: string;
  cached: boolean;
}

function resolve(p: LyricsPayload): Resolved {
  const synced = p.synced ? parseLrc(p.synced) : [];
  if (p.instrumental) {
    return {
      status: "instrumental",
      lines: [],
      plain: null,
      source: null,
      trackName: p.trackName,
      artistName: p.artistName,
      cached: p.cached,
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
          setState({ ...IDLE, status: "none", override: !!override });
          return;
        }
        setState({ ...IDLE, ...resolve(payload), override: !!override });
      })
      .catch(() => {
        if (id !== reqId.current) return;
        setState({ ...IDLE, status: "error", override: !!override });
      });
  }, []);

  useEffect(() => {
    if (!entry) {
      reqId.current++;
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
          setState({ ...IDLE, ...resolve(payload), override: true });
        })
        .catch(() => {
          if (reqId.current !== myReq) return;
          setState({ ...IDLE, status: "error", override: true });
        });
    },
    [entry],
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

  return { ...state, search, apply, clearLyrics };
}
