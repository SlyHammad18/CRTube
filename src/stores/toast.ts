import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
}

let nextId = 1;

interface ToastStore {
  toasts: Toast[];
  push: (message: string) => void;
  dismiss: (id: number) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (message) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function pushToast(message: string) {
  useToastStore.getState().push(message);
}
