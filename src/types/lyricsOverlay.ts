import type { LibraryEntry } from "./library";

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
  lyricsRevision: number;
}
