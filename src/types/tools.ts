export type ToolName = "ytdlp" | "ffmpeg";

export interface ToolsProgressPayload {
  tool: ToolName;
  stage: string;
  pct: number;
}

export type ToolsStatus = "updating" | "ready" | "error";

export interface ToolsStatusPayload {
  state: ToolsStatus;
}

export interface VersionsResult {
  ytdlp: string | null;
  ffmpeg: string | null;
}

export interface EnsureResult extends VersionsResult {
  ytdlpUpdated: boolean;
}

export interface UpdateYtdlpResult {
  updated: boolean;
  ytdlp: string | null;
}

export interface ToolProgress {
  stage: string;
  pct: number;
}

export const IDLE_PROGRESS: Record<ToolName, ToolProgress> = {
  ytdlp: { stage: "idle", pct: 0 },
  ffmpeg: { stage: "idle", pct: 0 },
};
