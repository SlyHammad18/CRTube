import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { joinArtists } from "../lib/format";
import type { LibraryEntry } from "../types/library";
import { usePlayerStore } from "./player";
import { usePlaylistsStore } from "./playlists";
import { pushToast } from "./toast";

export type LibraryFilter = "all" | "audio" | "video";
export type LibraryDensity = "grid" | "list";

interface LibraryStore {
  entries: LibraryEntry[];
  ids: Set<string>;
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

export const useLibraryStore = create<LibraryStore>((set) => ({
  entries: [],
  ids: new Set(),
  loaded: false,
  filter: "all",
  searchQuery: "",
  density: "grid",

  setFilter: (filter) => set({ filter }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setDensity: (density) => set({ density }),

  refresh: async () => {
    try {
      const entries = await ipc.listLibrary();
      set({ entries, ids: new Set(entries.map((e) => e.videoId)), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  removeLocal: (id) =>
    set((s) => {
      const entries = s.entries.filter((e) => e.id !== id);
      return { entries, ids: new Set(entries.map((e) => e.videoId)) };
    }),

  setFavourite: (id, favourite) => {
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id ? { ...e, favourite } : e)),
    }));
    void ipc.setFavourite(id, favourite).catch(() => {
      set((s) => ({
        entries: s.entries.map((e) =>
          e.id === id ? { ...e, favourite: !favourite } : e,
        ),
      }));
    });
  },

  renameEntry: (id, title, artists) => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const nextArtists = artists
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    const nextChannel = nextArtists.length ? nextArtists.join(", ") : undefined;
    set((s) => ({
      entries: s.entries.map((e) =>
        e.id === id
          ? { ...e, title: nextTitle, channel: nextChannel }
          : e,
      ),
    }));
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
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === id
              ? {
                  ...e,
                  title: title.trim(),
                  channel: joinArtists(artists) || undefined,
                }
              : e,
          ),
        }));
        usePlaylistsStore.getState().patchOpenTrack(id, {
          title: title.trim(),
          channel: joinArtists(artists) || undefined,
        });
      });
  },
}));
