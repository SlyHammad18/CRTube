import type { LibraryEntry } from "./library";
import type { PlayContext, RepeatMode } from "../stores/player";
import type { PlayerSelection } from "../stores/playlists";

/**
 * Resume-session snapshot persisted to `{app_data}/session.json` and reapplied
 * on the next launch. Always restored *paused* at the remembered timestamp.
 * The Rust side stores this as opaque JSON — this interface is the schema.
 */
export interface PlayerSession {
  version: 1;
  /** Snapshot of the play queue (LibraryEntries as played). */
  queue: LibraryEntry[];
  /** Permutation of queue indices — linear, or shuffled with current first. */
  order: number[];
  /** Index into `order`; -1 when idle. */
  pos: number;
  /** Saved playback position in seconds. */
  currentTimeS: number;
  repeat: RepeatMode;
  shuffle: boolean;
  /** Play context (library / playlist) backing the queue. */
  context: PlayContext | null;
  /** Library sidebar pane selection to re-open on restart. */
  selection: PlayerSelection | null;
}