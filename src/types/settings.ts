export type UrduFontPref = "naskh" | "custom";

export interface AppSettings {
  download_dir: string;
  concurrent: number;
  autoupdate_ytdlp: boolean;
  youtube_cookies: string;
  youtube_cookies_file: string;
  disable_video_playback: boolean;
  filename_template?: string | null;
  player_volume: number;
  player_speed: number;
  /** Urdu lyrics font — "custom" uses the file picked via pick_urdu_font. */
  urdu_font: UrduFontPref;
  /** Cached font file in {app_data}/fonts/ backing urdu_font: "custom". */
  urdu_custom_file?: string | null;
  /** Caption Deck font size (px) — Latin lines. */
  lyrics_size_latin: number;
  /** Caption Deck font size (px) — Urdu lines (active line ×4⁄3). */
  lyrics_size_urdu: number;
}
