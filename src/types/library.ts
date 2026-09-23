export interface LibraryEntry {
  id: number;
  videoId: string;
  url?: string;
  title: string;
  channel?: string;
  durationS?: number;
  kind: string;
  quality?: string;
  container: string;
  path: string;
  sizeBytes?: number;
  thumbUrl?: string;
  /** App-only artwork override; does not modify the downloaded media file. */
  customThumbPath?: string;
  status: string;
  createdAt: number;
  favourite: boolean;
}
