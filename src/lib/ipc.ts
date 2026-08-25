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
import type { LibraryEntry } from "../types/library";
import type { AppSettings } from "../types/settings";
import type {
  DlDonePayload,
  DlErrorPayload,
  DlProgressPayload,
} from "../types/dl";

export type DownloadKind = "video" | "audio";
export type AudioQualityPref = "best" | "192" | "128";

export interface DownloadRequest {
  url: string;
  kind: DownloadKind;
  videoId: string;
  title: string;
  channel?: string;
  durationS?: number;
  container?: string;
  height?: number;
  quality?: AudioQualityPref;
  thumbUrl?: string;
  downloadDir?: string;
  embedThumbnail?: boolean;
  embedMetadata?: boolean;
}

export const ipc = {
  ensureTools: () => invoke<EnsureResult>("ensure_tools"),
  toolVersions: () => invoke<VersionsResult>("tool_versions"),
  updateYtdlp: (force: boolean) =>
    invoke<UpdateYtdlpResult>("update_ytdlp", { force }),

  searchYoutube: (query: string, page: number) =>
    invoke<SearchItem[]>("search_youtube", { query, page }),
  fetchInfo: (url: string) => invoke<VideoInfo>("fetch_info", { url }),

  startDownload: (opts: DownloadRequest) =>
    invoke<{ id: number }>("start_download", { opts }),
  cancelDownload: (id: number) => invoke<void>("cancel_download", { id }),

  addEntry: (entry: Omit<DownloadRequest, "downloadDir"> & { path: string; sizeBytes?: number }) =>
    invoke<number>("add_entry", { entry }),
  listLibrary: () => invoke<LibraryEntry[]>("list_library"),
  hasDownload: (videoId: string) => invoke<boolean>("has_download", { videoId }),
  deleteEntry: (id: number, path: string) =>
    invoke<void>("delete_entry", { id, path }),
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  pickFolder: () => invoke<string | null>("pick_folder"),

  getSettings: () => invoke<AppSettings>("get_settings"),
  setSettings: (settings: AppSettings) =>
    invoke<AppSettings>("set_settings", { settings }),

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
