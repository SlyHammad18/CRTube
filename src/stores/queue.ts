import { create } from "zustand";

interface QueueState {
  activeCount: number;
}

export const useQueueStore = create<QueueState>(() => ({
  activeCount: 0,
}));
