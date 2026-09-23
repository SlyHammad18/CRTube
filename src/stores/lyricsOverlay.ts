import { useEffect } from "react";
import { create } from "zustand";
import { ipc } from "../lib/ipc";
import { pushToast } from "./toast";
import type { LyricsOverlayPrefs } from "../types/lyricsOverlay";

interface LyricsOverlayState {
  enabled: boolean;
  ready: boolean;
  busy: boolean;
  refresh: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  toggle: () => Promise<void>;
}

const DEFAULT_PREFS: LyricsOverlayPrefs = {
  enabled: false,
  x: null,
  y: null,
};

export const useLyricsOverlayStore = create<LyricsOverlayState>((set, get) => ({
  enabled: DEFAULT_PREFS.enabled,
  ready: false,
  busy: false,
  refresh: async () => {
    try {
      const prefs = await ipc.getLyricsOverlayPrefs();
      set({ enabled: prefs.enabled, ready: true });
    } catch {
      set({ ready: true });
    }
  },
  setEnabled: async (enabled) => {
    if (get().busy) return;
    set({ busy: true });
    try {
      const prefs = await ipc.setLyricsOverlayEnabled(enabled);
      set({ enabled: prefs.enabled, ready: true });
    } catch (error) {
      pushToast(`Floating lyrics failed — ${String(error)}`);
      throw error;
    } finally {
      set({ busy: false });
    }
  },
  toggle: async () => {
    await get().setEnabled(!get().enabled);
  },
}));

/** Keep the main-window toggle in sync when the overlay is closed from itself. */
export function useLyricsOverlayController() {
  const refresh = useLyricsOverlayStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [refresh]);
}
