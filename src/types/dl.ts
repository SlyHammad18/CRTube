export interface DlProgressPayload {
  id: number;
  pct: number;
  speed_bps: number | null;
  eta_s: number | null;
  downloaded: number;
  total: number | null;
}

export interface DlDonePayload {
  id: number;
  path: string;
}

export interface DlErrorPayload {
  id: number;
  message: string;
}
