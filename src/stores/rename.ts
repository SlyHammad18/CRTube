import { create } from "zustand";

export interface RenameTarget {
  id: number;
  title: string;
  artists: string[];
}

interface RenameStore {
  target: RenameTarget | null;
  open: (target: RenameTarget) => void;
  close: () => void;
}

/** Drives the global RenameTrackModal — set when a rename is requested. */
export const useRenameStore = create<RenameStore>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));
