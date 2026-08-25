import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { LibraryEntry } from "../types/library";

interface LibraryStore {
  entries: LibraryEntry[];
  ids: Set<string>;
  loaded: boolean;
  refresh: () => Promise<void>;
  removeLocal: (id: number) => void;
}

export const useLibraryStore = create<LibraryStore>((set) => ({
  entries: [],
  ids: new Set(),
  loaded: false,

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
}));
