import { convertFileSrc } from "@tauri-apps/api/core";

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