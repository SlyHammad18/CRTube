import { create } from "zustand";
import type { MotionValue } from "motion/react";
import { ipc, type DownloadRequest } from "../lib/ipc";
import { useLibraryStore } from "./library";
import { useSettingsStore } from "./settings";
import { pushToast } from "./toast";

export type QueueStatus = "queued" | "active" | "done" | "error";

export interface QueueItem {
  localId: number;
  backendId: number | null;
  request: DownloadRequest;
  status: QueueStatus;
  pct: number;
  speedBps: number | null;
  etaS: number | null;
  downloaded: number;
  total: number | null;
  stage: string;
  error?: string;
}

const DONE_LINGER_MS = 1600;

export const progressMvs = new Map<number, MotionValue<number>>();

interface QueueStore {
  items: QueueItem[];
  activeCount: number;
  enqueue: (request: DownloadRequest) => void;
  cancel: (localId: number) => void;
  dismiss: (localId: number) => void;
  pump: () => void;
  attach: () => void;
}

let nextLocalId = 1;
let attached = false;

function countActive(items: QueueItem[]): number {
  return items.filter((i) => i.status === "active").length;
}

export const useQueueStore = create<QueueStore>((set, get) => {
  function patchItem(localId: number, part: Partial<QueueItem>) {
    set((s) => {
      const items = s.items.map((i) =>
        i.localId === localId ? { ...i, ...part } : i,
      );
      return { items, activeCount: countActive(items) };
    });
  }

  function removeItem(localId: number) {
    set((s) => {
      const items = s.items.filter((i) => i.localId !== localId);
      return { items, activeCount: countActive(items) };
    });
  }

  function startItem(item: QueueItem) {
    patchItem(item.localId, { status: "active" });
    ipc
      .startDownload(item.request)
      .then(({ id }) => patchItem(item.localId, { backendId: id }))
      .catch((e) => {
        patchItem(item.localId, { status: "error", error: String(e) });
        pushToast(`Couldn't start “${item.request.title}”`);
        get().pump();
      });
  }

  function pump() {
    const concurrent =
      useSettingsStore.getState().settings?.concurrent ?? 3;
    const { items } = get();
    const slots = concurrent - countActive(items);
    if (slots <= 0) return;
    items
      .filter((i) => i.status === "queued")
      .slice(0, slots)
      .forEach(startItem);
  }

  return {
    items: [],
    activeCount: 0,

    enqueue: (request) => {
      const item: QueueItem = {
        localId: nextLocalId++,
        backendId: null,
        request,
        status: "queued",
        pct: 0,
        speedBps: null,
        etaS: null,
        downloaded: 0,
        total: null,
        stage: "download",
      };
      set((s) => ({
        items: [...s.items, item],
        activeCount: countActive(s.items),
      }));
      pushToast("Added to queue");
      pump();
    },

    cancel: (localId) => {
      const item = get().items.find((i) => i.localId === localId);
      if (!item) return;
      if (item.status === "queued") {
        removeItem(localId);
        return;
      }
      if (item.status === "active" && item.backendId != null) {
        removeItem(localId);
        void ipc.cancelDownload(item.backendId).then(() => get().pump());
      }
    },

    dismiss: removeItem,

    pump,

    attach: () => {
      if (attached) return;
      attached = true;

      void ipc.onDlProgress((p) => {
        if (import.meta.env.DEV) console.debug("dl://progress", p);
        const item = get().items.find((i) => i.backendId === p.id);
        if (!item) {
          console.warn("[dl] progress for unknown backend id", p.id);
          return;
        }
        progressMvs.get(item.localId)?.set(Math.min(p.pct, 100) / 100);
        patchItem(item.localId, {
          pct: p.pct,
          speedBps: p.speed_bps,
          etaS: p.eta_s,
          downloaded: p.downloaded,
          total: p.total,
          stage: p.stage,
        });
      });

      void ipc.onDlDone((d) => {
        if (import.meta.env.DEV) console.debug("dl://done", d);
        const item = get().items.find((i) => i.backendId === d.id);
        if (!item) return;
        progressMvs.get(item.localId)?.set(1);
        patchItem(item.localId, { status: "done", pct: 100 });
        pushToast(`Finished — ${item.request.title}`);
        void useLibraryStore.getState().refresh();
        window.setTimeout(() => {
          removeItem(item.localId);
          get().pump();
        }, DONE_LINGER_MS);
        get().pump();
      });

      void ipc.onDlError((e) => {
        if (import.meta.env.DEV) console.debug("dl://error", e);
        const item = get().items.find((i) => i.backendId === e.id);
        if (!item) return;
        patchItem(item.localId, { status: "error", error: e.message });
        pushToast(`Failed — ${item.request.title}`);
        get().pump();
      });

      useSettingsStore.subscribe(() => get().pump());
    },
  };
});
