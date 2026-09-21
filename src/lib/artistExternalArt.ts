/**
 * Artist image resolution with a two-source fallback chain:
 *  1. Deezer API (via Rust IPC — avoids CORS) — high-quality artist photos
 *  2. Wikipedia REST API (direct fetch — has CORS) — handles disambiguation
 *     with a search fallback
 *
 * Results are cached in localStorage so repeat visits avoid IPC/network
 * requests entirely.
 */

import { ipc } from "./ipc";

const CACHE_KEY = "crtube-artist-img-v2";
const OLD_CACHE_KEY = "crtube-artist-img";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for hits
const CACHE_MISS_TTL_MS = 24 * 60 * 60 * 1000; // 1 day for misses

interface CacheEntry {
  url: string;
  ts: number;
}

/** In-memory mirror of the persisted cache + in-flight request dedup. */
const memory = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string | null>>();

function readCache(): Map<string, CacheEntry> {
  if (memory.size > 0) return memory;
  try {
    // One-time cleanup of the pre-v2 cache (held Wikipedia URLs).
    try { localStorage.removeItem(OLD_CACHE_KEY); } catch { /* ignore */ }

    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return memory;
    const obj = JSON.parse(raw) as Record<string, CacheEntry>;
    for (const [k, v] of Object.entries(obj)) memory.set(k, v);
  } catch {
    // corrupt cache — ignore
  }
  return memory;
}

function writeCache(cache: Map<string, CacheEntry>) {
  try {
    const obj = Object.fromEntries(cache);
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function storeHit(cache: Map<string, CacheEntry>, key: string, url: string) {
  const entry = { url, ts: Date.now() };
  cache.set(key, entry);
  memory.set(key, entry);
  writeCache(cache);
}

function storeMiss(cache: Map<string, CacheEntry>, key: string) {
  const entry = { url: "", ts: Date.now() };
  cache.set(key, entry);
  memory.set(key, entry);
  writeCache(cache);
}

// ---------------------------------------------------------------------------
// Source 1: Deezer API via Rust IPC
// ---------------------------------------------------------------------------

async function viaDeezer(name: string): Promise<string | null> {
  try {
    return await ipc.searchArtistImage(name);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Source 2: Wikipedia REST API (direct fetch — has CORS)
// ---------------------------------------------------------------------------

async function viaSummary(name: string): Promise<string | null> {
  try {
    const encoded = encodeURIComponent(name.trim());
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      type?: string;
      thumbnail?: { source?: string };
    };
    if (data.type === "disambiguation" || !data.thumbnail?.source) return null;
    return data.thumbnail.source;
  } catch {
    return null;
  }
}

async function viaWikipediaSearch(name: string): Promise<string | null> {
  try {
    const q = encodeURIComponent(`${name.trim()} band`);
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${q}&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=330&origin=*`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      query?: {
        pages?: Record<string, { thumbnail?: { source?: string } }>;
      };
    };
    const pages = data.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0];
    return page?.thumbnail?.source ?? null;
  } catch {
    return null;
  }
}

async function viaWikipedia(name: string): Promise<string | null> {
  const url = await viaSummary(name);
  if (url) return url;
  return viaWikipediaSearch(name);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch a cover image URL for the given artist name.
 * Tries Deezer first (via Rust IPC), then Wikipedia (direct fetch).
 * Returns a URL or `null` on any failure. Cached for 7 days (hits) or
 * 1 day (misses). Deduplicated while a request is in flight.
 */
export async function fetchArtistImage(name: string): Promise<string | null> {
  const key = name.trim().toLowerCase();
  if (!key) return null;

  // Check cache first
  const cache = readCache();
  const cached = cache.get(key);
  if (cached) {
    const ttl = cached.url ? CACHE_TTL_MS : CACHE_MISS_TTL_MS;
    if (Date.now() - cached.ts < ttl) {
      return cached.url || null;
    }
  }

  // Reuse an in-flight request for the same artist
  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      // Source 1: Deezer (via Rust, no CORS)
      const deezerUrl = await viaDeezer(name);
      if (deezerUrl) {
        storeHit(cache, key, deezerUrl);
        return deezerUrl;
      }

      // Source 2: Wikipedia (direct fetch, has CORS)
      const wikiUrl = await viaWikipedia(name);
      if (wikiUrl) {
        storeHit(cache, key, wikiUrl);
        return wikiUrl;
      }

      // Cache the miss briefly to avoid hammering APIs on every render.
      storeMiss(cache, key);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}
