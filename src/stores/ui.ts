import { create } from "zustand";

export type View = "player" | "search" | "downloads" | "library" | "settings";

interface UIState {
  view: View;
  booted: boolean;
  /** §4.8 — right-hand Now Playing pane visibility. */
  nowPlayingOpen: boolean;
  /** In-app fullscreen video overlay (max window size, audio + controls). */
  videoFullscreen: boolean;
  setView: (view: View) => void;
  setBooted: (booted: boolean) => void;
  setNowPlayingOpen: (open: boolean) => void;
  setVideoFullscreen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  // §4.1 — the app opens on the Player.
  view: "player",
  booted: false,
  nowPlayingOpen: true,
  videoFullscreen: false,
  setView: (view) => set({ view }),
  setBooted: (booted) => set({ booted }),
  setNowPlayingOpen: (nowPlayingOpen) => set({ nowPlayingOpen }),
  setVideoFullscreen: (open) => set({ videoFullscreen: open }),
}));
