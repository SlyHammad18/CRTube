import { create } from "zustand";

export type View = "player" | "search" | "downloads" | "library" | "settings";

interface UIState {
  view: View;
  booted: boolean;
  /** §4.8 — right-hand Now Playing pane visibility. */
  nowPlayingOpen: boolean;
  /** In-app fullscreen video overlay (max window size, audio + controls). */
  videoFullscreen: boolean;
  /** Expanded lyrics view covering the player's songlist + playlist region. */
  lyricsFullscreen: boolean;
  /** Bottom-docked lyrics panel, available from any view via the player bar. */
  lyricsDockOpen: boolean;
  setView: (view: View) => void;
  setBooted: (booted: boolean) => void;
  setNowPlayingOpen: (open: boolean) => void;
  setVideoFullscreen: (open: boolean) => void;
  setLyricsFullscreen: (open: boolean) => void;
  setLyricsDockOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  // §4.1 — the app opens on the Player.
  view: "player",
  booted: false,
  nowPlayingOpen: true,
  videoFullscreen: false,
  lyricsFullscreen: false,
  lyricsDockOpen: false,
  setView: (view) => set({ view }),
  setBooted: (booted) => set({ booted }),
  setNowPlayingOpen: (nowPlayingOpen) => set({ nowPlayingOpen }),
  setVideoFullscreen: (open) => set({ videoFullscreen: open }),
  setLyricsFullscreen: (open) => set({ lyricsFullscreen: open }),
  setLyricsDockOpen: (open) => set({ lyricsDockOpen: open }),
}));
