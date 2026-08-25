import { create } from "zustand";
import type { LibraryEntry } from "../types/library";
import { useSettingsStore } from "./settings";
import { pushToast } from "./toast";

export type RepeatMode = "off" | "all" | "one";

export interface PlayContext {
  type: "library" | "playlist";
  id?: number;
}

/** Mirrors SPEED_MIN/SPEED_MAX in src-tauri settings.rs. */
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4.0;

export function linearOrder(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** Fisher–Yates with the queue index `first` pinned to position 0. */
export function shuffledOrder(n: number, first: number): number[] {
  const rest = linearOrder(n).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first >= 0 ? [first, ...rest] : rest;
}

function stepTo(len: number, i: number, step: 1 | -1, wrap: boolean): number {
  const next = i + step;
  if (next < 0) return wrap ? len - 1 : -1;
  if (next >= len) return wrap ? 0 : -1;
  return next;
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function persistPlayerSetting(patch: {
  player_volume?: number;
  player_speed?: number;
}) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void useSettingsStore.getState().update(patch);
  }, 400);
}

export function fmtSpeed(v: number): string {
  return `${v}×`;
}

interface PlayerState {
  queue: LibraryEntry[];
  /** Permutation of queue indices — linear, or shuffled with current first. */
  order: number[];
  /** Index into `order`; -1 when idle. */
  pos: number;
  playing: boolean;
  currentTimeS: number;
  durationS: number;
  repeat: RepeatMode;
  shuffle: boolean;
  volume: number;
  speed: number;
  context: PlayContext | null;
  /** Monotonic counter so MediaHost applies seek requests exactly once. */
  seekNonce: number;
  seekTargetS: number;

  playAll: (entries: LibraryEntry[], startIdx: number, context: PlayContext | null) => void;
  enqueue: (entry: LibraryEntry) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  setSpeed: (v: number) => void;
  setVolume: (v: number) => void;
  seek: (t: number) => void;
  /** Fed by MediaHost's timeupdate listener. */
  syncTime: (t: number, d: number) => void;
  onEnded: () => void;
  onMediaError: () => void;
  hydrateFromSettings: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  const entryAtOrder = (i: number): LibraryEntry | null => {
    const { queue, order } = get();
    return order[i] != null ? (queue[order[i]] ?? null) : null;
  };

  const applyPos = (i: number) => {
    const entry = get().queue[get().order[i]];
    if (!entry) return false;
    set({
      pos: i,
      playing: true,
      currentTimeS: 0,
      durationS: entry.durationS ?? 0,
    });
    return true;
  };

  /** Walk `step` through the play order, skipping missing files. */
  const advance = (step: 1 | -1, wrap: boolean): boolean => {
    const s = get();
    let i = s.pos;
    for (let n = 0; n < s.order.length; n++) {
      i = stepTo(s.order.length, i, step, wrap);
      if (i === -1) break;
      const entry = s.queue[s.order[i]];
      if (!entry) continue;
      if (entry.status === "missing") {
        pushToast(`Skipped missing — ${entry.title}`);
        continue;
      }
      return applyPos(i);
    }
    return false;
  };

  return {
    queue: [],
    order: [],
    pos: -1,
    playing: false,
    currentTimeS: 0,
    durationS: 0,
    repeat: "off",
    shuffle: false,
    volume: 1,
    speed: 1,
    context: null,
    seekNonce: 0,
    seekTargetS: 0,

    playAll: (entries, startIdx, context) => {
      const playable = entries.filter((e) => e.status !== "missing");
      if (playable.length === 0) {
        pushToast("No playable tracks");
        return;
      }
      // Start at the requested track, or the next playable one after it.
      let startEntry =
        entries[Math.min(Math.max(startIdx, 0), entries.length - 1)];
      if (!startEntry || startEntry.status === "missing") {
        for (let n = 1; n <= entries.length; n++) {
          const probe = entries[(startIdx + n) % entries.length];
          if (probe.status !== "missing") {
            startEntry = probe;
            break;
          }
        }
      }
      if (!startEntry) return;
      const playableStart = Math.max(0, playable.indexOf(startEntry));
      const order = get().shuffle
        ? shuffledOrder(playable.length, playableStart)
        : linearOrder(playable.length);
      const pos = Math.max(0, order.indexOf(playableStart));
      set({
        queue: playable,
        order,
        context,
        pos,
        playing: true,
        currentTimeS: 0,
        durationS: startEntry.durationS ?? 0,
      });
    },

    enqueue: (entry) => {
      if (entry.status === "missing") {
        pushToast(`Skipped missing — ${entry.title}`);
        return;
      }
      const s = get();
      if (s.queue.some((e) => e.id === entry.id)) {
        pushToast("Already in queue");
        return;
      }
      const queue = [...s.queue, entry];
      const order = [...s.order, queue.length - 1];
      if (s.pos < 0) {
        set({ queue, order, pos: 0, playing: true, currentTimeS: 0 });
      } else {
        set({ queue, order });
        pushToast(`Queued — ${entry.title}`);
      }
    },

    toggle: () => {
      const s = get();
      if (s.queue.length === 0) return;
      if (s.pos < 0) {
        applyPos(0);
        return;
      }
      set({ playing: !s.playing });
    },

    next: () => {
      if (!advance(1, true)) pushToast("Nothing else in queue");
    },

    prev: () => {
      if (get().currentTimeS > 3) {
        get().seek(0);
        return;
      }
      if (!advance(-1, true)) get().seek(0);
    },

    cycleRepeat: () =>
      set((s) => ({
        repeat:
          s.repeat === "off" ? "all" : s.repeat === "all" ? "one" : "off",
      })),

    toggleShuffle: () => {
      const s = get();
      const curQueueIdx = s.pos >= 0 ? s.order[s.pos] : -1;
      if (!s.shuffle) {
        set({
          shuffle: true,
          order: shuffledOrder(s.queue.length, curQueueIdx),
          pos: curQueueIdx >= 0 ? 0 : -1,
        });
      } else {
        set({
          shuffle: false,
          order: linearOrder(s.queue.length),
          pos: curQueueIdx,
        });
      }
    },

    setSpeed: (v) => {
      const speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, v));
      set({ speed });
      persistPlayerSetting({ player_speed: speed });
    },

    setVolume: (v) => {
      const volume = Math.min(1, Math.max(0, v));
      set({ volume });
      persistPlayerSetting({ player_volume: volume });
    },

    seek: (t) =>
      set((s) => ({
        seekTargetS: t,
        seekNonce: s.seekNonce + 1,
        currentTimeS: t,
      })),

    syncTime: (t, d) => {
      const s = get();
      if (d && d !== s.durationS) set({ durationS: d });
      if (Math.abs(t - s.currentTimeS) >= 0.2 || t < s.currentTimeS) {
        set({ currentTimeS: t });
      }
    },

    onEnded: () => {
      const s = get();
      if (s.repeat === "one") {
        s.seek(0);
        set({ playing: true });
        return;
      }
      if (!advance(1, s.repeat === "all")) set({ playing: false });
    },

    onMediaError: () => {
      const entry = entryAtOrder(get().pos);
      pushToast(
        `Can't play ${entry?.container ?? "this format"} in-app — try opening it externally`,
      );
      if (!advance(1, true)) set({ playing: false });
    },

    hydrateFromSettings: () => {
      const st = useSettingsStore.getState().settings;
      if (!st) return;
      set({
        volume: Math.min(1, Math.max(0, st.player_volume)),
        speed: Math.min(SPEED_MAX, Math.max(SPEED_MIN, st.player_speed)),
      });
    },
  };
});

/** Stable selector for the track under the playhead. */
export function selectCurrentEntry(s: PlayerState): LibraryEntry | null {
  if (s.pos < 0) return null;
  return s.queue[s.order[s.pos]] ?? null;
}
