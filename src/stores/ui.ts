import { create } from "zustand";

export type View = "search" | "downloads" | "library" | "settings";

interface UIState {
  view: View;
  booted: boolean;
  setView: (view: View) => void;
  setBooted: (booted: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  view: "search",
  booted: false,
  setView: (view) => set({ view }),
  setBooted: (booted) => set({ booted }),
}));
