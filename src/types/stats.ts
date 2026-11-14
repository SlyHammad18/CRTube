/** Mirrors the Rust `services::stats` types and command payloads. */

export type StatsRange = "day" | "week" | "month" | "year" | "all";

export interface StatsOverview {
  /** Total content seconds (playback-speed adjusted). */
  totalSeconds: number;
  /** Completed ≥30s listens (Spotify-style stream threshold). */
  plays: number;
  /** Distinct tracks played in the window. */
  tracks: number;
}

export interface StatsTopTrack {
  videoId: string;
  title: string;
  channel?: string;
  seconds: number;
  plays: number;
  /** Original/cached thumb (falls back to the stream row's thumb). */
  thumbUrl?: string;
  /** User-selected app artwork — preferred when present. */
  customThumbPath?: string;
}

export interface StatsTopArtist {
  name: string;
  seconds: number;
  plays: number;
  /** Library artist id for artwork/lookup — absent for stream-only artists. */
  artistId?: number;
}

export interface StatsBucket {
  label: string;
  seconds: number;
}

/** One flush of the listening recorder (`stats_record_listen`). */
export interface ListenEvent {
  videoId: string;
  /** Content seconds played since the previous flush of this session. */
  seconds: number;
  /** Closing row of a listening session that reached the play threshold. */
  completed: boolean;
  /** Stream metadata; only recorded for videos that were never downloaded. */
  title?: string;
  channel?: string;
  thumbUrl?: string;
}
