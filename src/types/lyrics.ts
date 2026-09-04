export interface LyricsPayload {
  synced: string | null;
  plain: string | null;
  instrumental: boolean;
  trackName: string;
  artistName: string;
  cached: boolean;
  /** User-tuned display sync offset in ms (positive = lyrics lag audio). */
  offsetMs: number;
}

/** A single LRCLIB search hit offered to the user so they can pick the best match. */
export interface LyricsCandidate {
  trackName: string;
  artistName: string;
  synced: boolean;
  plain: boolean;
  instrumental: boolean;
  durationS: number | null;
  syncedLyrics: string | null;
  plainLyrics: string | null;
}
