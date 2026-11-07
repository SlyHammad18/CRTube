import type { LibraryEntry } from "./library";
import type { StreamTrack } from "./player";

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

/** The playing track as the overlay sees it: a library row (with favourite +
 *  playlist support) or a live stream described by its video id. */
export type LyricsOverlayEntry =
  | ({ trackKind: "library" } & LibraryEntry)
  | ({ trackKind: "stream" } & StreamTrack);

export interface LyricsOverlaySnapshot {
  entry: LyricsOverlayEntry;
  /** Monotonic playback sequence used to reject stale overlay snapshots. */
  sequence: number;
  positionS: number;
  playing: boolean;
  /** Media stalled (stream resolving/rebuffering): freezes the overlay clock. */
  buffering: boolean;
  speed: number;
  volume: number;
  muted: boolean;
  canNext: boolean;
  canPrevious: boolean;
  shuffle: boolean;
  repeat: LyricsRepeatMode;
  lyricsRevision: number;
}
