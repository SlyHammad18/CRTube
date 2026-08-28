export function fmtDuration(seconds?: number | null): string | null {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) {
    return null;
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function fmtCount(n?: number | null): string | null {
  if (n === undefined || n === null || Number.isNaN(n)) return null;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function fmtEta(seconds?: number | null): string | null {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) {
    return null;
  }
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function fmtBytes(bytes?: number | null): string | null {
  if (bytes === undefined || bytes === null || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const digits = value >= 100 || i === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[i]}`;
}

const MEDIA_EXT = /\.(mp3|mp4|webm|m4a|flac|ogg|wav|aac|opus)$/i;

/** Strip a trailing media-file extension (e.g. `.mp3`, `.MP4`) from a name. */
export function stripMediaExt(name: string): string {
  return name.replace(MEDIA_EXT, "");
}

/** Split a stored `channel` string into individual artist names. */
export function parseArtists(channel?: string | null): string[] {
  if (!channel) return [];
  return channel
    .split(",")
    .map((a) => a.trim())
    .filter((a) => a.length > 0);
}

/** Join artist names into the single `channel` display string. */
export function joinArtists(artists: string[]): string {
  return artists
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .join(", ");
}
