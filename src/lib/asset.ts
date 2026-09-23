import { convertFileSrc } from "@tauri-apps/api/core";
import type { LibraryEntry } from "../types/library";

/**
 * Resolve an artwork source (thumbnail, cover, artist photo) for an `<img>`.
 * Remote https URLs pass through as-is; local cached paths — which travel over
 * IPC as plain strings per the architecture contract — are routed through the
 * Tauri asset protocol (`$APPDATA/...` entries configured in tauri.conf.json).
 */
export function imgSrcOf(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed)
    ? trimmed
    : convertFileSrc(trimmed);
}

/** Effective library artwork: a user override when present, otherwise YouTube's. */
export function entryArtworkUrl(
  entry: Pick<LibraryEntry, "thumbUrl" | "customThumbPath">,
): string | undefined {
  return entryArtworkPath(entry) ?? undefined;
}

/** Raw effective path, for backends that resolve or persist artwork themselves. */
export function entryArtworkPath(
  entry: Pick<LibraryEntry, "thumbUrl" | "customThumbPath">,
): string | null | undefined {
  const custom = entry.customThumbPath?.trim();
  return custom || entry.thumbUrl?.trim() || undefined;
}
