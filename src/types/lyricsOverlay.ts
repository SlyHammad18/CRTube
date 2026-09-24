import type { LibraryEntry } from "./library";

export type LyricsRepeatMode = "off" | "all" | "one";

export interface LyricsOverlayPrefs {
  enabled: boolean;
  x: number | null;
  y: number | null;
}

export interface LyricsOverlayPosition {
  x: number;
  y: number;
}

export interface LyricsOverlaySnapshot {
  entry: LibraryEntry;
  /** Monotonic playback sequence used to reject stale overlay snapshots. */
  sequence: number;
  positionS: number;
  playing: boolean;
  speed: number;
  volume: number;
  muted: boolean;
  canNext: boolean;
  canPrevious: boolean;
  shuffle: boolean;
  repeat: LyricsRepeatMode;
  lyricsRevision: number;
}
