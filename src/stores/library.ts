import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { joinArtists } from "../lib/format";
import type { LibraryEntry } from "../types/library";
import { usePlayerStore } from "./player";
import { usePlaylistsStore } from "./playlists";
import { pushToast } from "./toast";

export type LibraryFilter = "all" | "audio" | "video";
export type LibraryDensity = "grid" | "list";

// Debounce refresh to prevent overlapping calls.
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const REFRESH_DEBOUNCE_MS = 300;

interface LibraryStore {
  entries: LibraryEntry[];
  ids: Set<string>;
  /** O(1) lookup by numeric entry id (for FavouriteButton & friends). */
  entryById: Map<number, LibraryEntry>;
  loaded: boolean;
  filter: LibraryFilter;
  searchQuery: string;
  density: LibraryDensity;
  setFilter: (filter: LibraryFilter) => void;
  setSearchQuery: (query: string) => void;
  setDensity: (density: LibraryDensity) => void;
  refresh: () => Promise<void>;
  removeLocal: (id: number) => void;
  setFavourite: (id: number, favourite: boolean) => void;
  renameEntry: (id: number, title: string, artists: string[]) => void;
}

export function entriesToById(entries: LibraryEntry[]): Map<number, LibraryEntry> {
  const m = new Map<number, LibraryEntry>();
  for (const e of entries) m.set(e.id, e);
  return m;
}

export const useLibraryStore = create<LibraryStore>((set) => ({
  entries: [],
  ids: new Set(),
  entryById: new Map(),
  loaded: false,
  filter: "all",
  searchQuery: "",
  density: "grid",

  setFilter: (filter) => set({ filter }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setDensity: (density) => set({ density }),

  refresh: async () => {
    // Debounce: if a refresh is already scheduled, skip this one.
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => { refreshTimer = null; }, REFRESH_DEBOUNCE_MS);
    try {
      const entries = await ipc.listLibrary();
      set({
        entries,
        ids: new Set(entries.map((e) => e.videoId)),
        entryById: entriesToById(entries),
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },

  removeLocal: (id) =>
    set((s) => {
      const removed = s.entries.find((e) => e.id === id);
      if (!removed) return {};
      const entries = s.entries.filter((e) => e.id !== id);
      const ids = new Set(s.ids);
      ids.delete(removed.videoId);
      const entryById = new Map(s.entryById);
      entryById.delete(id);
      return { entries, ids, entryById };
    }),

  setFavourite: (id, favourite) => {
    set((s) => {
      const idx = s.entries.findIndex((e) => e.id === id);
      if (idx < 0 || s.entries[idx].favourite === favourite) return {};
      const entries = s.entries.slice();
      entries[idx] = { ...entries[idx], favourite };
      const entryById = new Map(s.entryById);
      entryById.set(id, entries[idx]);
      return { entries, entryById };
    });
    void ipc.setFavourite(id, favourite).catch(() => {
      set((s) => {
        const idx = s.entries.findIndex((e) => e.id === id);
        if (idx < 0) return {};
        const entries = s.entries.slice();
        entries[idx] = { ...entries[idx], favourite: !favourite };
        const entryById = new Map(s.entryById);
        entryById.set(id, entries[idx]);
        return { entries, entryById };
      });
    });
  },

  renameEntry: (id, title, artists) => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const nextArtists = artists
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    const nextChannel = nextArtists.length ? nextArtists.join(", ") : undefined;
    set((s) => {
      const idx = s.entries.findIndex((e) => e.id === id);
      if (idx < 0) return {};
      const entries = s.entries.slice();
      entries[idx] = { ...entries[idx], title: nextTitle, channel: nextChannel };
      const entryById = new Map(s.entryById);
      entryById.set(id, entries[idx]);
      return { entries, entryById };
    });
    // Keep a currently-playing copy and the open playlist view in sync.
    usePlayerStore.getState().patchEntry(id, {
      title: nextTitle,
      channel: nextChannel,
    });
    usePlaylistsStore.getState().patchOpenTrack(id, {
      title: nextTitle,
      channel: nextChannel,
    });
    void ipc
      .renameEntry(id, nextTitle, nextArtists)
      .then(() => {
        void useLibraryStore.getState().refresh();
        const sel = usePlaylistsStore.getState().selection;
        if (sel.type === "playlist") void usePlaylistsStore.getState().refresh();
      })
      .catch((e) => {
        console.error("renameEntry failed", e);
        pushToast(`Rename failed — ${String(e)}`);
        set((s) => {
          const idx = s.entries.findIndex((e) => e.id === id);
          if (idx < 0) return {};
          const entries = s.entries.slice();
          entries[idx] = {
            ...entries[idx],
            title: title.trim(),
            channel: joinArtists(artists) || undefined,
          };
          const entryById = new Map(s.entryById);
          entryById.set(id, entries[idx]);
          return { entries, entryById };
        });
        usePlaylistsStore.getState().patchOpenTrack(id, {
          title: title.trim(),
          channel: joinArtists(artists) || undefined,
        });
      });
  },
}));
