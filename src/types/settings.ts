export interface AppSettings {
  download_dir: string;
  concurrent: number;
  autoupdate_ytdlp: boolean;
  youtube_cookies: string;
  youtube_cookies_file: string;
  filename_template?: string | null;
  player_volume: number;
  player_speed: number;
}
