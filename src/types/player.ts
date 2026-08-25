import type { LibraryEntry } from "./library";

export interface Playlist {
  id: number;
  name: string;
  trackCount: number;
  createdAt: number;
}

/** Mirrors Rust `PlaylistTrack` — LibraryEntry fields are serde-flattened. */
export type PlaylistTrack = {
  itemId: number;
  position: number;
  addedAt: number;
} & LibraryEntry;
