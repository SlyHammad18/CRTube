import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { LibraryEntry } from "../types/library";

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
}));
