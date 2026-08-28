import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { Playlist, PlaylistTrack } from "../types/player";
import { pushToast } from "./toast";
import { useLibraryStore } from "./library";

export type PlayerSelection =
  | { type: "library"; recent: boolean }
  | { type: "playlist"; id: number }
  | { type: "favourites" };

/** playlistId → (downloadId → itemId) membership index for checkmark UI. */
type Membership = Record<number, Record<number, number>>;

interface PlaylistsState {
  playlists: Playlist[];
  loaded: boolean;
  selection: PlayerSelection;
  /** Tracks of the open playlist; null while a library view is selected. */
  openTracks: PlaylistTrack[] | null;
  members: Membership;

  refresh: () => Promise<void>;
  openLibrary: (recent?: boolean) => void;
  openFavourites: () => void;
  openPlaylist: (id: number) => Promise<void>;
  create: (name: string) => Promise<Playlist>;
  rename: (id: number, name: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  addTo: (playlistId: number, downloadId: number) => Promise<boolean>;
  removeFrom: (playlistId: number, itemId: number) => Promise<void>;
  reorder: (orderedItemIds: number[]) => Promise<void>;
}

async function buildMembership(
  playlists: Playlist[],
): Promise<Membership> {
  const entries = await Promise.all(
    playlists.map(async (p) => {
      try {
        return [p.id, await ipc.listPlaylistItems(p.id)] as const;
      } catch {
        return [p.id, [] as PlaylistTrack[]] as const;
      }
    }),
  );
  const map: Membership = {};
  for (const [id, tracks] of entries) {
    map[id] = Object.fromEntries(tracks.map((t) => [t.id, t.itemId]));
  }
  return map;
}

export const usePlaylistsStore = create<PlaylistsState>((set, get) => ({
  playlists: [],
  loaded: false,
  selection: { type: "library", recent: false },
  openTracks: null,
  members: {},

  refresh: async () => {
    try {
      const playlists = await ipc.listPlaylists();
      const members = await buildMembership(playlists);
      set({ playlists, members, loaded: true });
      // Keep an open playlist's track list in sync with external changes.
      const sel = get().selection;
      if (sel.type === "playlist") {
        await get().openPlaylist(sel.id);
      }
    } catch {
      set({ loaded: true });
    }
  },

  openLibrary: (recent = false) =>
    set({ selection: { type: "library", recent }, openTracks: null }),

  openFavourites: () => {
    set({ selection: { type: "favourites" }, openTracks: null });
    if (!useLibraryStore.getState().loaded) {
      void useLibraryStore.getState().refresh();
    }
  },

  openPlaylist: async (id) => {
    set({ selection: { type: "playlist", id } });
    try {
      const openTracks = await ipc.listPlaylistItems(id);
      set({ openTracks });
    } catch {
      set({ openTracks: [] });
    }
  },

  create: async (name) => {
    const playlist = await ipc.createPlaylist(name);
    set((s) => ({ playlists: [playlist, ...s.playlists] }));
    void get().refresh();
    return playlist;
  },

  rename: async (id, name) => {
    await ipc.renamePlaylist(id, name);
    set((s) => ({
      playlists: s.playlists.map((p) => (p.id === id ? { ...p, name } : p)),
    }));
  },

  remove: async (id) => {
    await ipc.deletePlaylist(id);
    set((s) => {
      const { [id]: _dropped, ...members } = s.members;
      const is_open = s.selection.type === "playlist" && s.selection.id === id;
      return {
        playlists: s.playlists.filter((p) => p.id !== id),
        members,
        ...(is_open
          ? { selection: { type: "library", recent: false } as const, openTracks: null }
          : {}),
      };
    });
    pushToast("Playlist deleted");
  },

  addTo: async (playlistId, downloadId) => {
    const existing = get().members[playlistId]?.[downloadId];
    if (existing != null) return false; // backend dedupes; surface as no-op
    const itemId = await ipc.addPlaylistItem(playlistId, downloadId);
    set((s) => ({
      members: {
        ...s.members,
        [playlistId]: { ...(s.members[playlistId] ?? {}), [downloadId]: itemId },
      },
      playlists: s.playlists.map((p) =>
        p.id === playlistId ? { ...p, trackCount: p.trackCount + 1 } : p,
      ),
      openTracks:
        s.selection.type === "playlist" && s.selection.id === playlistId && s.openTracks
          ? [...s.openTracks] // refetched below; keep optimistic shape
          : s.openTracks,
    }));
    // Refetch to pick up authoritative position ordering.
    const sel = get().selection;
    if (sel.type === "playlist" && sel.id === playlistId) {
      await get().openPlaylist(playlistId);
    }
    return true;
  },

  removeFrom: async (playlistId, itemId) => {
    await ipc.removePlaylistItem(itemId);
    set((s) => {
      const membersFor = { ...(s.members[playlistId] ?? {}) };
      for (const [dlId, iId] of Object.entries(membersFor)) {
        if (iId === itemId) delete membersFor[Number(dlId)];
      }
      return {
        members: { ...s.members, [playlistId]: membersFor },
        playlists: s.playlists.map((p) =>
          p.id === playlistId
            ? { ...p, trackCount: Math.max(0, p.trackCount - 1) }
            : p,
        ),
        openTracks:
          s.selection.type === "playlist" && s.selection.id === playlistId
            ? (s.openTracks ?? []).filter((t) => t.itemId !== itemId)
            : s.openTracks,
      };
    });
  },

  reorder: async (orderedItemIds) => {
    const sel = get().selection;
    if (sel.type !== "playlist") return;
    // Optimistic resequencing of the open list.
    set((s) => {
      if (!s.openTracks) return {};
      const byItem = new Map(s.openTracks.map((t) => [t.itemId, t]));
      const reordered = orderedItemIds
        .map((id) => byItem.get(id))
        .filter((t): t is PlaylistTrack => t != null);
      return {
        openTracks: reordered.map((t, i) => ({ ...t, position: i + 1 })),
      };
    });
    try {
      await ipc.reorderPlaylistItems(sel.id, orderedItemIds);
    } catch (e) {
      pushToast(`Reorder failed — ${String(e)}`);
      await get().openPlaylist(sel.id);
    }
  },
}));
