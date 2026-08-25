import { create } from "zustand";
import { ipc } from "../lib/ipc";
import type { DlDonePayload, DlErrorPayload, DlProgressPayload } from "../types/dl";

export type DlStatus = "active" | "done" | "error";

export interface DlJobState {
  title?: string;
  videoId?: string;
  pct: number;
  speedBps: number | null;
  etaS: number | null;
  downloaded: number;
  total: number | null;
  status: DlStatus;
}

const EMPTY_JOB: DlJobState = {
  pct: 0,
  speedBps: null,
  etaS: null,
  downloaded: 0,
  total: null,
  status: "active",
};

interface QueueStore {
  jobs: Record<number, DlJobState>;
  activeCount: number;
  attach: () => void;
  labelJob: (id: number, title: string, videoId: string) => void;
}

let attached = false;

function countActive(jobs: Record<number, DlJobState>): number {
  return Object.values(jobs).filter((j) => j.status === "active").length;
}

export const useQueueStore = create<QueueStore>((set) => ({
  jobs: {},
  activeCount: 0,

  attach: () => {
    if (attached) return;
    attached = true;

    const patch = (id: number, part: Partial<DlJobState>) =>
      set((s) => {
        const jobs = {
          ...s.jobs,
          [id]: { ...EMPTY_JOB, ...s.jobs[id], ...part },
        };
        return { jobs, activeCount: countActive(jobs) };
      });

    void ipc.onDlProgress((p: DlProgressPayload) => {
      if (import.meta.env.DEV) console.debug("dl://progress", p);
      patch(p.id, {
        pct: p.pct,
        speedBps: p.speed_bps,
        etaS: p.eta_s,
        downloaded: p.downloaded,
        total: p.total,
        status: "active",
      });
    });
    void ipc.onDlDone((d: DlDonePayload) => {
      if (import.meta.env.DEV) console.debug("dl://done", d);
      patch(d.id, { status: "done", pct: 100 });
    });
    void ipc.onDlError((e: DlErrorPayload) => {
      if (import.meta.env.DEV) console.debug("dl://error", e);
      patch(e.id, { status: "error" });
    });
  },

  labelJob: (id, title, videoId) =>
    set((s) => {
      if (!s.jobs[id]) return s;
      return {
        jobs: { ...s.jobs, [id]: { ...s.jobs[id], title, videoId } },
      };
    }),
}));
