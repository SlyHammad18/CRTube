import { useEffect } from "react";
import { ipc } from "../lib/ipc";
import { useLibraryStore } from "../stores/library";
import { usePlayerStore } from "../stores/player";
import { usePlaylistsStore } from "../stores/playlists";
import { useSettingsStore } from "../stores/settings";
import { isStreamTrack } from "../types/player";
import type { LibraryEntry } from "../types/library";
import type { PlayerSession } from "../types/session";

/**
 * Resume session (§requested): persists the play queue, current track +
 * timestamp, mute state, repeat/shuffle and the sidebar selection so the next
 * launch picks up where playback left off. Restored playback always starts
 * *paused*, per decision. Writes are debounced/throttled and flushed on hide so
 * they never spam the disk during a `timeupdate` storm.
 *
 * Stream tracks (search click-to-play) are NOT persisted — the Rust session
 * schema only knows library entries, and a signed stream URL is dead by the
 * next launch anyway. The saved order/pos are remapped onto the surviving
 * library subset so restore stays consistent.
 */
export function useSession() {
  useEffect(() => {
    let cancelled = false;
    let booted = false;
    let lastImportant = "";
    let lastSavedAt = 0;

    const snapshot = (): PlayerSession => {
      const p = usePlayerStore.getState();
      const current = p.pos >= 0 ? p.queue[p.order[p.pos]] : undefined;
      const currentIsStream = current != null && isStreamTrack(current);
      // Keep only downloaded entries; remap the saved permutation onto the
      // surviving indices.
      const queue: LibraryEntry[] = p.queue.filter(
        (t): t is LibraryEntry => !isStreamTrack(t),
      );
      const oldToNew = new Map<number, number>();
      let next = 0;
      for (let i = 0; i < p.queue.length; i++) {
        if (!isStreamTrack(p.queue[i])) oldToNew.set(i, next++);
      }
      const order = p.order
        .map((i) => oldToNew.get(i))
        .filter((i): i is number => i != null);
      const mappedPos = p.pos >= 0 ? oldToNew.get(p.pos) : undefined;
      const pos =
        currentIsStream || mappedPos == null ? -1 : order.indexOf(mappedPos);
      return {
        version: 1,
        queue,
        order,
        pos,
        // A stream's timestamp means nothing on disk — start the restored
        // track from the top.
        currentTimeS: currentIsStream ? 0 : p.currentTimeS,
        muted: p.muted,
        repeat: p.repeat,
        shuffle: p.shuffle,
        context: p.context,
        selection: usePlaylistsStore.getState().selection,
      };
    };

    // Fields that mark a "structural" change (entry / queue / playback mode) —
    // position alone does not count so we throttle it separately.
    const fingerprint = (): string => {
      const p = usePlayerStore.getState();
      return [
        p.queue
          .map((t) => (isStreamTrack(t) ? `s:${t.videoId}` : String(t.id)))
          .join(","),
        p.order.join(","),
        p.pos,
        p.playing ? 1 : 0,
        p.muted ? 1 : 0,
        p.repeat,
        p.shuffle ? 1 : 0,
        String(p.context?.id ?? p.context?.type ?? ""),
      ].join("|");
    };

    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingTimeSave = false;
    const saveNow = () => {
      void ipc.setSession(snapshot()).catch(() => {});
      lastSavedAt = Date.now();
      lastImportant = fingerprint();
    };
    const schedule = (delay: number) => {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        if (!cancelled && booted) saveNow();
        pendingTimeSave = false;
      }, delay);
    };

    // Boot sequence: hydrate settings, load library + playlists, then restore
    // the saved session (enriching it with fresher library metadata).
    void (async () => {
      await useSettingsStore.getState().load();
      usePlayerStore.getState().hydrateFromSettings();
      await Promise.all([
        useLibraryStore.getState().refresh(),
        usePlaylistsStore.getState().refresh(),
      ]);
      if (cancelled) return;

      let session: PlayerSession | null = null;
      try {
        session = await ipc.getSession();
      } catch {
        session = null;
      }
      if (session) {
        const byId = useLibraryStore.getState().entryById;
        const queue: LibraryEntry[] = session.queue.map(
          (q) => byId.get(q.id) ?? q,
        );
        usePlayerStore.getState().restore({ ...session, queue });
        await usePlaylistsStore.getState().restoreSelection(session.selection);
      }
      booted = true;
      lastImportant = fingerprint();
      lastSavedAt = Date.now();
    })();

    // Save on structural changes (debounced) and throttled position drift.
    const unsubPlayer = usePlayerStore.subscribe(() => {
      if (!booted) return;
      const fp = fingerprint();
      if (fp !== lastImportant) {
        lastImportant = fp;
        pendingTimeSave = false;
        schedule(500);
      } else if (!pendingTimeSave && Date.now() - lastSavedAt > 5000) {
        pendingTimeSave = true;
        schedule(200);
      }
    });
    // Sidebar selection changes don't touch the player store — capture them too.
    const unsubPlaylists = usePlaylistsStore.subscribe(() => {
      if (!booted) return;
      schedule(500);
    });

    const onHide = () => {
      if (booted) saveNow();
    };
    const onVisibility = () => {
      if (document.hidden) onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (booted) saveNow();
      window.clearTimeout(saveTimer);
      unsubPlayer();
      unsubPlaylists();
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}