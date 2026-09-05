import { create } from "zustand";

export type View = "player" | "search" | "downloads" | "library" | "settings";

export interface PlaylistNameDraft {
  mode: "create" | "rename";
  id?: number;
  initial?: string;
}

interface UIState {
  view: View;
  booted: boolean;
  /** §4.8 — right-hand Now Playing pane visibility. */
  nowPlayingOpen: boolean;
  /** In-app fullscreen video overlay (max window size, audio + controls). */
  videoFullscreen: boolean;
  /** When true for a video track, the picture is hidden (thumbnail shown) but
   *  audio keeps playing through the single <video> element. */
  videoDisabled: boolean;
  /** Expanded lyrics view covering the player's songlist + playlist region. */
  lyricsFullscreen: boolean;
  /** Bottom-docked lyrics panel, available from any view via the player bar. */
  lyricsDockOpen: boolean;
  /** Drives the global new/rename playlist dialog (Ctrl+N / F2). */
  playlistName: PlaylistNameDraft | null;
  setView: (view: View) => void;
  setBooted: (booted: boolean) => void;
  setNowPlayingOpen: (open: boolean) => void;
  setVideoFullscreen: (open: boolean) => void;
  setVideoDisabled: (disabled: boolean) => void;
  setLyricsFullscreen: (open: boolean) => void;
  setLyricsDockOpen: (open: boolean) => void;
  openPlaylistName: (draft: PlaylistNameDraft) => void;
  closePlaylistName: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  // §4.1 — the app opens on the Player.
  view: "player",
  booted: false,
  nowPlayingOpen: true,
  videoFullscreen: false,
  videoDisabled: false,
  lyricsFullscreen: false,
  lyricsDockOpen: false,
  playlistName: null,
  setView: (view) => set({ view }),
  setBooted: (booted) => set({ booted }),
  setNowPlayingOpen: (nowPlayingOpen) => set({ nowPlayingOpen }),
  setVideoFullscreen: (open) => set({ videoFullscreen: open }),
  setVideoDisabled: (disabled) => set({ videoDisabled: disabled }),
  setLyricsFullscreen: (open) => set({ lyricsFullscreen: open }),
  setLyricsDockOpen: (open) => set({ lyricsDockOpen: open }),
  openPlaylistName: (draft) => set({ playlistName: draft }),
  closePlaylistName: () => set({ playlistName: null }),
}));
