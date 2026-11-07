import type { DownloadRequest } from "./ipc";
import type { VideoInfo } from "../types/search";

export function watchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export interface DownloadChoice {
  kind: "video" | "audio";
  container?: string;
  height?: number | null;
  quality?: "best" | "192" | "128";
  embedThumbnail?: boolean;
  embedMetadata?: boolean;
}

/** Build the IPC `DownloadRequest` for a track, including the best-effort
 *  `expectedSize` estimate from probed formats — mirrors the pinned
 *  `bv*[ext=…][height<=…]+ba[ext=m4a]` / `-x --audio-quality` selectors so the
 *  queue can show a live percentage even when yt-dlp reports no total.
 *  Shared by the FormatSheet and the preview popup's download bar. */
export function buildDownloadRequest(opts: {
  videoId: string;
  title: string;
  channel?: string;
  durationS?: number;
  thumbUrl?: string;
  info?: VideoInfo | null;
  downloadDir?: string;
  choice: DownloadChoice;
}): DownloadRequest {
  const { videoId, title, channel, durationS, thumbUrl, info, downloadDir, choice } = opts;
  const formats = info?.formats ?? [];
  const bestAudioSize = Math.max(
    0,
    ...formats.filter((f) => f.height == null).map((f) => f.filesize ?? 0),
  );
  const videoRows = formats.filter((f) => f.height != null);
  const target = choice.height ?? 0;
  const vidSizePool =
    videoRows.filter((f) => f.height === target).length > 0
      ? videoRows.filter((f) => f.height === target)
      : videoRows.filter((f) => f.height != null && f.height <= target);
  const preferredVideoSize = Math.max(
    0,
    ...vidSizePool
      .filter((f) => f.ext === choice.container)
      .map((f) => f.filesize ?? 0),
  );
  const videoSize =
    preferredVideoSize || Math.max(0, ...vidSizePool.map((f) => f.filesize ?? 0));
  const videoTotal = videoSize + bestAudioSize;
  const expectedSize =
    choice.kind === "video"
      ? videoTotal > 0
        ? videoTotal
        : undefined
      : bestAudioSize > 0
        ? bestAudioSize
        : undefined;

  return {
    url: watchUrl(videoId),
    kind: choice.kind,
    videoId,
    title,
    channel,
    durationS,
    container: choice.kind === "video" ? choice.container : undefined,
    height: choice.kind === "video" ? (choice.height ?? undefined) : undefined,
    quality: choice.kind === "audio" ? choice.quality : undefined,
    thumbUrl,
    downloadDir,
    embedThumbnail: choice.kind === "audio" ? (choice.embedThumbnail ?? true) : true,
    embedMetadata: choice.kind === "audio" ? (choice.embedMetadata ?? true) : true,
    expectedSize,
  };
}
