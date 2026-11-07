import { useLibraryStore } from "../stores/library";
import { usePlayerStore } from "../stores/player";
import type { StreamTrack } from "../types/player";

/** Everything needed to play a YouTube result as a stream. */
export type StreamItem = Omit<StreamTrack, "source" | "kind">;

/**
 * Play a YouTube search result: the downloaded library copy when one exists
 * (full quality, instant start), otherwise a live stream straight from
 * YouTube via the loopback relay — no download required. A "video" request
 * falls back to streaming when only an audio-only copy exists locally.
 */
export function playResult(item: StreamItem, kind: StreamTrack["kind"]): void {
  const existing = useLibraryStore
    .getState()
    .entries.find((e) => e.videoId === item.videoId && e.status !== "missing");
  if (existing && !(kind === "video" && existing.kind !== "video")) {
    usePlayerStore.getState().playAll([existing], 0, { type: "library" });
    return;
  }
  usePlayerStore.getState().playStream(item, kind);
}
