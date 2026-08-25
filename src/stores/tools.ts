import { create } from "zustand";
import { ipc } from "../lib/ipc";
import {
  IDLE_PROGRESS,
  type ToolName,
  type ToolProgress,
  type ToolsStatus,
} from "../types/tools";
import { pushToast } from "./toast";

let started = false;

interface ToolsStore {
  state: "idle" | ToolsStatus;
  ytdlpVersion: string | null;
  ffmpegVersion: string | null;
  showOverlay: boolean;
  error: string | null;
  progress: Record<ToolName, ToolProgress>;
  init: () => Promise<void>;
  retry: () => Promise<void>;
}

async function runEnsure(set: (partial: Partial<ToolsStore>) => void) {
  const firstRun = useToolsStore.getState().showOverlay;
  set({ state: "updating", error: null });
  try {
    const res = await ipc.ensureTools();
    set({
      state: "ready",
      ytdlpVersion: res.ytdlp,
      ffmpegVersion: res.ffmpeg,
      progress: { ...IDLE_PROGRESS },
    });
    if (res.ytdlpUpdated && !firstRun) {
      pushToast(`yt-dlp updated → ${res.ytdlp}`);
    }
    const dismiss = () => set({ showOverlay: false });
    firstRun ? setTimeout(dismiss, 400) : dismiss();
  } catch (e) {
    set({
      state: "error",
      error: String(e),
      progress: { ...IDLE_PROGRESS },
    });
    if (!firstRun) {
      pushToast("tool update failed — will retry next launch");
    }
  }
}

export const useToolsStore = create<ToolsStore>((set) => ({
  state: "idle",
  ytdlpVersion: null,
  ffmpegVersion: null,
  showOverlay: false,
  error: null,
  progress: { ...IDLE_PROGRESS },

  init: async () => {
    if (started) return;
    started = true;

    void ipc.onToolsProgress(({ tool, stage, pct }) =>
      set((s) => ({ progress: { ...s.progress, [tool]: { stage, pct } } })),
    );
    void ipc.onToolsStatus(({ state }) => set({ state }));

    try {
      const v = await ipc.toolVersions();
      set({
        ytdlpVersion: v.ytdlp,
        ffmpegVersion: v.ffmpeg,
        showOverlay: !v.ytdlp || !v.ffmpeg,
      });
    } catch {
      set({ showOverlay: true });
    }

    await runEnsure(set);
  },

  retry: async () => {
    set({ showOverlay: true });
    await runEnsure(set);
  },
}));
