export interface LyricsPayload {
  synced: string | null;
  plain: string | null;
  instrumental: boolean;
  trackName: string;
  artistName: string;
  cached: boolean;
}
