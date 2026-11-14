import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type {
  StatsBucket,
  StatsOverview,
  StatsRange,
  StatsTopArtist,
  StatsTopTrack,
} from "../types/stats";

export interface StatsData {
  overview: StatsOverview;
  topTracks: StatsTopTrack[];
  topArtists: StatsTopArtist[];
  timeline: StatsBucket[];
}

interface StatsState {
  range: StatsRange;
  loaded: boolean;
  loading: boolean;
  data: StatsData | null;
  setRange: (range: StatsRange) => void;
  /** Refetch the active range (called on view mount and range switches). */
  refresh: () => void;
}

/** Per-range cache so pill switches don't flash empty while refetching. */
const cache = new Map<StatsRange, StatsData>();

/** Fetch all four stats payloads for a range, tolerating partial failures. */
async function fetchRange(range: StatsRange): Promise<StatsData> {
  const [overviewR, tracksR, artistsR, timelineR] = await Promise.allSettled([
    ipc.statsOverview(range),
    ipc.statsTopTracks(range),
    ipc.statsTopArtists(range),
    ipc.statsTimeline(range),
  ]);
  return {
    overview: overviewR.status === "fulfilled"
      ? overviewR.value
      : { totalSeconds: 0, plays: 0, tracks: 0 },
    topTracks: tracksR.status === "fulfilled" ? tracksR.value : [],
    topArtists: artistsR.status === "fulfilled" ? artistsR.value : [],
    timeline: timelineR.status === "fulfilled" ? timelineR.value : [],
  };
}

export const useStatsStore = create<StatsState>((set, get) => ({
  // Today (hourly bars) is the default lens; larger windows zoom out daily /
  // monthly / yearly.
  range: "day",
  loaded: false,
  loading: false,
  data: null,

  setRange: (range) => {
    // Serve the cached snapshot immediately, then refresh it in place —
    // listening data can be stale from the moment playback resumed.
    set({ range, data: cache.get(range) ?? null });
    void get().refresh();
  },

  refresh: () => {
    const range = get().range;
    set({ loading: true });
    void fetchRange(range)
      .then((data) => {
        cache.set(range, data);
        // Ignore a response for an earlier pill switch.
        if (get().range !== range) return;
        set({ data, loaded: true, loading: false });
      })
      .catch(() => set({ loading: false }));
  },
}));
