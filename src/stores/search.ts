import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { looksLikeUrl } from "../lib/detect";
import type { SearchItem, VideoInfo } from "../types/search";

const PAGE_SIZE = 20;

type SearchStatus = "idle" | "searching" | "loadingMore" | "done" | "error";
type InfoStatus = "idle" | "probing" | "done" | "error";

interface SearchStore {
  query: string;
  page: number;
  items: SearchItem[];
  status: SearchStatus;
  error: string | null;
  hasMore: boolean;
  recent: string[];

  info: VideoInfo | null;
  infoStatus: InfoStatus;
  infoError: string | null;
  probedFrom: string | null;

  search: (query: string) => Promise<void>;
  loadMore: () => Promise<void>;
  probe: (url: string) => Promise<void>;
  submitRaw: (raw: string) => Promise<void>;
  clearInfo: () => void;
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

  info: null,
  infoStatus: "idle",
  infoError: null,
  probedFrom: null,

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
      info: null,
      infoStatus: "idle",
      infoError: null,
      probedFrom: null,
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

  probe: async (url) => {
    set({
      items: [],
      query: "",
      page: 0,
      hasMore: false,
      status: "idle",
      error: null,
      info: null,
      infoStatus: "probing",
      infoError: null,
      probedFrom: url.trim(),
    });
    try {
      const info = await ipc.fetchInfo(url.trim());
      set({ info, infoStatus: "done" });
    } catch (e) {
      set({ infoStatus: "error", infoError: String(e) });
    }
  },

  submitRaw: async (raw) => {
    if (looksLikeUrl(raw)) {
      await get().probe(raw);
    } else {
      await get().search(raw);
    }
  },

  clearInfo: () =>
    set({
      info: null,
      infoStatus: "idle",
      infoError: null,
      probedFrom: null,
    }),
}));
