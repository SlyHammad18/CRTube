import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { AppSettings } from "../types/settings";

interface SettingsStore {
  settings: AppSettings | null;
  load: () => Promise<void>;
  setDownloadDir: (dir: string) => Promise<void>;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,

  load: async () => {
    try {
      const settings = await ipc.getSettings();
      set({ settings });
    } catch {
      set({ settings: null });
    }
  },

  update: async (patch) => {
    const current = get().settings;
    if (!current) return;
    const next = { ...current, ...patch };
    set({ settings: next });
    try {
      const saved = await ipc.setSettings(next);
      set({ settings: saved });
    } catch {
      set({ settings: current });
    }
  },

  setDownloadDir: (dir) => get().update({ download_dir: dir }),
}));
