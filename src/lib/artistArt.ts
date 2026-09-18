import type { LibraryEntry } from "../types/library";
import type { Artist, Playlist } from "../types/player";
import { parseArtists } from "./format";

/** Tracks whose artist credits include `name` (case-sensitive match on parsed credits). */
export function artistTracks(entries: LibraryEntry[], name: string): LibraryEntry[] {
  return entries.filter((e) => parseArtists(e.channel).includes(name));
}

/** FNV-1a — tiny stable hash so each artist's collage pick is random-looking
 * but identical across renders and restarts. */
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seeded Fisher–Yates so the 4-up pick stays stable per name (no flicker). */
function seededShuffle(arr: string[], key: string): string[] {
  let seed = hashSeed(key);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Up to four distinct of the artist's own track thumbnails. No random filler:
 * fewer than four of their own covers renders fewer cells (1 full / 2 halves /
 * 3 L+stacked), and none at all falls back to the monogram. Picks are stable
 * per name. */
export function artistCoverUrls(entries: LibraryEntry[], name: string): string[] {
  const seen = new Set<string>();
  const own: string[] = [];
  for (const e of artistTracks(entries, name)) {
    const t = e.thumbUrl;
    if (t && t.trim() !== "" && !seen.has(t)) {
      seen.add(t);
      own.push(t);
    }
  }
  if (own.length > 4) {
    return seededShuffle(own, name).slice(0, 4);
  }
  return own;
}

/** Shape-compatible stand-in so artist art can reuse the collage renderer.
 * A custom uploaded cover passes through; otherwise the artist's own covers
 * are collaged. */
export function artistArtModel(
  artist: Pick<Artist, "id" | "name" | "coverKind" | "coverPath">,
  entries: LibraryEntry[],
): Pick<Playlist, "id" | "name" | "coverKind" | "coverPath" | "coverUrls"> {
  return {
    id: artist.id,
    name: artist.name,
    coverKind: artist.coverKind,
    coverPath: artist.coverPath,
    coverUrls:
      artist.coverKind === "custom" && artist.coverPath
        ? [artist.coverPath]
        : artistCoverUrls(entries, artist.name),
  };
}
