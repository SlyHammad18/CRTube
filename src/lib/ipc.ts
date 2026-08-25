import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  EnsureResult,
  ToolsProgressPayload,
  ToolsStatusPayload,
  UpdateYtdlpResult,
  VersionsResult,
} from "../types/tools";

export const ipc = {
  ensureTools: () => invoke<EnsureResult>("ensure_tools"),
  toolVersions: () => invoke<VersionsResult>("tool_versions"),
  updateYtdlp: (force: boolean) =>
    invoke<UpdateYtdlpResult>("update_ytdlp", { force }),

  onToolsProgress: async (
    cb: (payload: ToolsProgressPayload) => void,
  ): Promise<UnlistenFn> =>
    listen<ToolsProgressPayload>("tools://progress", (e) => cb(e.payload)),

  onToolsStatus: async (
    cb: (payload: ToolsStatusPayload) => void,
  ): Promise<UnlistenFn> =>
    listen<ToolsStatusPayload>("tools://status", (e) => cb(e.payload)),
};
