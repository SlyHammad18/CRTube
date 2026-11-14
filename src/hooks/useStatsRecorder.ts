import { useEffect } from "react";
import { ipc } from "../lib/ipc";
import { usePlayerStore } from "../stores/player";
import { isStreamTrack, type PlayableTrack } from "../types/player";

/**
 * Listening-time capture for the Stats tab (§stats). Subscribes to the player
 * store and accumulates *content* seconds from small forward `currentTimeS`
 * deltas — so scrubs/seek-backs never double-count and playback speed scales
 * the accumulated time instead of being invisible.
 *
 * A playback session is scoped to one track (video id): a track change, queue
 * clear or window close ends it. Every ~15s of unreported audio, an
 * incremental segment row is written via `stats_record_listen`; the closing
 * write carries the completed flag (Spotify's ≥30s stream threshold) that
 * makes SUM(completed) the play count. Crash loss is bounded to the last
 * <15s increment; `pagehide`/`visibilitychange` flush the remainder first.
 *
 * Stream tracks record their own title/channel/thumb so stats can still rank
 * listens to videos that were never downloaded; library rows keep those
 * fields empty and resolve them through the downloads JOIN at query time.
 */

/** A listening session must reach this many played seconds to count as a play. */
const PLAY_THRESHOLD_S = 30;
/** Unreported buffer before an incremental DB write. */
const FLUSH_EVERY_S = 15;

interface ListeningSession {
  videoId: string;
  title?: string;
  channel?: string;
  thumbUrl?: string;
  /** Content seconds unreported since the last write. */
  pending: number;
  /** Total content seconds of this session (drives the completed verdict). */
  total: number;
}

export function useStatsRecorder() {
  useEffect(() => {
    let session: ListeningSession | null = null;

    const currentTrack = (): PlayableTrack | null => {
      const p = usePlayerStore.getState();
      return p.pos >= 0 ? (p.queue[p.order[p.pos]] ?? null) : null;
    };
    const keyOf = (t: PlayableTrack | null): string | null =>
      t ? (isStreamTrack(t) ? `s:${t.videoId}` : `l:${t.videoId}`) : null;

    const send = (s: ListeningSession, final: boolean) => {
      const completed = final && s.total >= PLAY_THRESHOLD_S;
      if (s.pending <= 0 && !completed) return;
      const ev = {
        videoId: s.videoId,
        seconds: Math.max(0, s.pending),
        completed,
        title: s.title,
        channel: s.channel,
        thumbUrl: s.thumbUrl,
      };
      s.pending = 0;
      void ipc.statsRecordListen(ev).catch(() => {});
    };

    const close = (flush: boolean) => {
      if (session) send(session, flush);
      session = null;
    };

    const open = (track: PlayableTrack) => {
      const stream = isStreamTrack(track);
      session = {
        videoId: track.videoId,
        title: stream ? track.title : undefined,
        channel: stream ? track.channel : undefined,
        thumbUrl: stream ? track.thumbUrl : undefined,
        pending: 0,
        total: 0,
      };
    };

    // Flushing at track/queue boundaries resets the session, so a hidden or
    // closing window must first write the remainder, then re-open if the same
    // track is still under the playhead (visibilitychange lands mid-playback).
    const flushNow = (reopen: boolean) => {
      close(true);
      if (reopen) {
        const track = currentTrack();
        if (track) open(track);
      }
    };
    const onHide = () => flushNow(false);
    const onVisibility = () => {
      if (document.hidden) flushNow(true);
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);

    const unsub = usePlayerStore.subscribe((state, prev) => {
      const track =
        state.pos >= 0 ? (state.queue[state.order[state.pos]] ?? null) : null;
      const prevTrack =
        prev.pos >= 0 ? (prev.queue[prev.order[prev.pos]] ?? null) : null;
      if (keyOf(track) !== keyOf(prevTrack)) {
        // Track (or queue) changed: settle the previous session, open the
        // next. The cross-boundary playhead jumps between tracks here count
        // no listening time.
        close(true);
        if (track) open(track);
        return;
      }
      if (!session || !state.playing) return;
      const delta = state.currentTimeS - prev.currentTimeS;
      // Only small forward advances count (timeupdate cadence ≈ 0.25s).
      // Seeks — big jumps either way — contribute no listening time but
      // must not block future reporting.
      if (delta <= 0 || delta > 2) return;
      session.pending += delta;
      session.total += delta;
      if (session.pending >= FLUSH_EVERY_S) send(session, false);
    });

    return () => {
      flushNow(false);
      unsub();
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
