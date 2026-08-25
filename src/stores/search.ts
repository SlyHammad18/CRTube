import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { looksLikeUrl } from "../lib/detect";
import { useSheetStore } from "./sheet";
import type { SearchItem } from "../types/search";

const PAGE_SIZE = 20;

type SearchStatus = "idle" | "searching" | "loadingMore" | "done" | "error";

interface SearchStore {
  query: string;
  page: number;
  items: SearchItem[];
  status: SearchStatus;
  error: string | null;
  hasMore: boolean;
  recent: string[];

  search: (query: string) => Promise<void>;
  loadMore: () => Promise<void>;
  submitRaw: (raw: string) => Promise<void>;
  clear: () => void;
}

function rememberRecent(recent: string[], query: string): string[] {
  return [query, ...recent.filter((r) => r !== query)].slice(0, 8);
}

export const useSearchStore = create<SearchStore>((set, get) => ({
  query: "",
  page: 0,
  items: [],
  status: "idle",
  error: null,
  hasMore: false,
  recent: [],

  search: async (query) => {
    const q = query.trim();
    if (!q) return;
    set({
      query: q,
      page: 1,
      items: [],
      status: "searching",
      error: null,
      hasMore: false,
    });
    try {
      const items = await ipc.searchYoutube(q, 1);
      set((s) => ({
        items,
        status: "done",
        hasMore: items.length >= PAGE_SIZE,
        recent: rememberRecent(s.recent, q),
      }));
    } catch (e) {
      set({ status: "error", error: String(e), items: [] });
    }
  },

  loadMore: async () => {
    const { query, page, status, hasMore } = get();
    if (status === "searching" || status === "loadingMore" || !hasMore) return;
    const next = page + 1;
    set({ status: "loadingMore", error: null });
    try {
      const more = await ipc.searchYoutube(query, next);
      set((s) => ({
        page: next,
        items: [...s.items, ...more],
        status: "done",
        hasMore: more.length >= PAGE_SIZE,
      }));
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  submitRaw: async (raw) => {
    if (looksLikeUrl(raw)) {
      useSheetStore.getState().openForUrl(raw);
      return;
    }
    await get().search(raw);
  },

  clear: () =>
    set({
      query: "",
      page: 0,
      items: [],
      status: "idle",
      error: null,
      hasMore: false,
    }),
}));
