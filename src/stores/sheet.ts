import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { SearchItem, VideoInfo } from "../types/search";

export interface SheetPrefill {
  videoId: string;
  title: string;
  channel?: string;
  durationS?: number;
  thumbUrl?: string;
}

interface SheetStore {
  open: boolean;
  prefill: SheetPrefill | null;
  info: VideoInfo | null;
  loading: boolean;
  error: string | null;
  sourceUrl: string | null;

  openForCard: (item: SearchItem) => void;
  openForUrl: (url: string) => void;
  retry: () => void;
  close: () => void;
}

function watch_url(video_id: string) {
  return `https://www.youtube.com/watch?v=${video_id}`;
}

async function fetchInfo(
  set: (partial: Partial<SheetStore>) => void,
  url: string,
  prefill: SheetPrefill | null,
) {
  set({
    open: true,
    prefill,
    info: null,
    loading: true,
    error: null,
    sourceUrl: url,
  });
  try {
    const info = await ipc.fetchInfo(url);
    set({ info, loading: false });
  } catch (e) {
    set({ loading: false, error: String(e) });
  }
}

export const useSheetStore = create<SheetStore>((set, get) => ({
  open: false,
  prefill: null,
  info: null,
  loading: false,
  error: null,
  sourceUrl: null,

  openForCard: (item) => {
    const prefill: SheetPrefill = {
      videoId: item.videoId,
      title: item.title,
      channel: item.channel,
      durationS: item.durationS,
      thumbUrl: item.thumbUrl,
    };
    void fetchInfo(set, watch_url(item.videoId), prefill);
  },

  openForUrl: (url) => {
    void fetchInfo(set, url.trim(), null);
  },

  retry: () => {
    const { sourceUrl, prefill } = get();
    if (sourceUrl) void fetchInfo(set, sourceUrl, prefill);
  },

  close: () => set({ open: false }),
}));
