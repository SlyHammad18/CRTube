import { create } from "zustand";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface Pending {
  opts: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

interface ConfirmState {
  pending: Pending | null;
  request: (opts: ConfirmOptions) => Promise<boolean>;
  resolve: (ok: boolean) => void;
}

/**
 * Imperative confirm: `await confirm({...})` opens the global modal
 * (ConfirmModal) and resolves true/false on user action.
 */
export const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,
  request: (opts) =>
    new Promise<boolean>((resolve) => set({ pending: { opts, resolve } })),
  resolve: (ok) => {
    get().pending?.resolve(ok);
    set({ pending: null });
  },
}));

export const confirm = (opts: ConfirmOptions) =>
  useConfirmStore.getState().request(opts);
