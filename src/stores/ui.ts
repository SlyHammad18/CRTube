import { create } from "zustand";

export type View = "player" | "search" | "downloads" | "library" | "settings";

interface UIState {
  view: View;
  booted: boolean;
  setView: (view: View) => void;
  setBooted: (booted: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  // §4.1 — the app opens on the Player.
  view: "player",
  booted: false,
  setView: (view) => set({ view }),
  setBooted: (booted) => set({ booted }),
}));
