import type { LibraryEntry } from "./library";

/** Mirrors Rust `CoverKind`: `auto` renders the 4-up track-thumb collage. */
export type CoverKind = "auto" | "custom";

export interface Playlist {
  id: number;
  name: string;
  trackCount: number;
  createdAt: number;
  coverKind: CoverKind;
  coverPath: string | null;
  /** Up to four thumbs for the collage (http URL or cached absolute path). */
  coverUrls: string[];
}

/** Mirrors Rust `PlaylistTrack` — LibraryEntry fields are serde-flattened. */
export type PlaylistTrack = {
  itemId: number;
  position: number;
  addedAt: number;
} & LibraryEntry;

/** Mirrors Rust `Artist` — artwork resolves on the frontend from the artist's
 * own track thumbs (auto collage) or a user-picked image (custom). */
export interface Artist {
  id: number;
  name: string;
  trackCount: number;
  coverKind: CoverKind;
  coverPath: string | null;
}

export const COVER_URL_MAX = 4;
