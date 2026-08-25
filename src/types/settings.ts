export interface AppSettings {
  download_dir: string;
  concurrent: number;
  autoupdate_ytdlp: boolean;
  filename_template?: string | null;
}
