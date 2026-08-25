import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  EnsureResult,
  ToolsProgressPayload,
  ToolsStatusPayload,
  UpdateYtdlpResult,
  VersionsResult,
} from "../types/tools";
import type { SearchItem, VideoInfo } from "../types/search";
import type {
  DlDonePayload,
  DlErrorPayload,
  DlProgressPayload,
} from "../types/dl";

export const ipc = {
  ensureTools: () => invoke<EnsureResult>("ensure_tools"),
  toolVersions: () => invoke<VersionsResult>("tool_versions"),
  updateYtdlp: (force: boolean) =>
    invoke<UpdateYtdlpResult>("update_ytdlp", { force }),

  searchYoutube: (query: string, page: number) =>
    invoke<SearchItem[]>("search_youtube", { query, page }),
  fetchInfo: (url: string) => invoke<VideoInfo>("fetch_info", { url }),

  startDownload: (opts: {
    url: string;
    kind: "video" | "audio";
    videoId: string;
    title: string;
    container?: string;
    height?: number;
    quality?: "best" | "192" | "128";
    thumbUrl?: string;
    downloadDir?: string;
  }) => invoke<{ id: number }>("start_download", { opts }),
  cancelDownload: (id: number) => invoke<void>("cancel_download", { id }),

  onDlProgress: async (
    cb: (payload: DlProgressPayload) => void,
  ): Promise<UnlistenFn> =>
    listen<DlProgressPayload>("dl://progress", (e) => cb(e.payload)),
  onDlDone: async (
    cb: (payload: DlDonePayload) => void,
  ): Promise<UnlistenFn> => listen<DlDonePayload>("dl://done", (e) => cb(e.payload)),
  onDlError: async (
    cb: (payload: DlErrorPayload) => void,
  ): Promise<UnlistenFn> =>
    listen<DlErrorPayload>("dl://error", (e) => cb(e.payload)),

  onToolsProgress: async (
    cb: (payload: ToolsProgressPayload) => void,
  ): Promise<UnlistenFn> =>
    listen<ToolsProgressPayload>("tools://progress", (e) => cb(e.payload)),

  onToolsStatus: async (
    cb: (payload: ToolsStatusPayload) => void,
  ): Promise<UnlistenFn> =>
    listen<ToolsStatusPayload>("tools://status", (e) => cb(e.payload)),
};
