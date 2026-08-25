export interface SearchItem {
  videoId: string;
  title: string;
  channel?: string;
  durationS?: number;
  views?: number;
  thumbUrl?: string;
}

export interface FormatInfo {
  height?: number;
  fps?: number;
  ext: string;
  filesize?: number;
  vcodec?: string;
  acodec?: string;
}

export interface VideoInfo {
  videoId: string;
  title: string;
  channel?: string;
  durationS?: number;
  thumbUrl?: string;
  isLive: boolean;
  formats: FormatInfo[];
}
