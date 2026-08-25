import { useCallback, useEffect, useRef, useState } from "react";
import { ipc } from "../lib/ipc";
import type { LyricsPayload } from "../types/lyrics";
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
  refetch: (o?: { title: string; artist: string }) => void;
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
  refetch: () => {},
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
 * `refetch` supports a manual artist/title override (the fallback ladder).
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

  const refetch = useCallback(
    (o?: { title: string; artist: string }) => {
      if (entry) load(entry, o);
    },
    [entry, load],
  );

  return { ...state, refetch };
}
