import { useEffect } from "react";
import { usePlayerStore, selectCurrentEntry } from "../stores/player";
import { usePlaylistsStore } from "../stores/playlists";
import { useUIStore } from "../stores/ui";
import { useRenameStore } from "../stores/rename";
import { parseArtists } from "../lib/format";

/**
 * Global keyboard shortcuts (§4.9). Registered once at the app shell. Every
 * binding is ignored while focus sits in a text-editable element (input,
 * textarea, select, contenteditable) so typing stays untouched.
 *
 *   Space            play / pause
 *   ←  /  →          seek −1s / +1s
 *   ↑  /  ↓          volume +1% / −1% (unmutes on raise)
 *   m                mute / unmute
 *   ,  /  .          next / previous
 *   l                toggle lyrics dock
 *   r                cycle repeat (off → all → one)
 *   s                toggle shuffle
 *   Ctrl+N           new playlist
 *   F2               rename selected playlist, else edit playing song
 */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editable =
        !!target &&
        (target.isContentEditable ||
          !!target.closest(
            "input, textarea, select, [contenteditable='true']",
          ));
      if (editable) return;

      const ui = useUIStore.getState();
      let handled = false;

      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === "n" && !e.shiftKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          ui.openPlaylistName({ mode: "create" });
          handled = true;
        }
      } else if (!e.altKey) {
        if (e.key === "F2") {
          e.preventDefault();
          const plState = usePlaylistsStore.getState();
          const sel = plState.selection;
          const playlist =
            sel?.type === "playlist"
              ? plState.playlists.find((p) => p.id === sel.id)
              : null;
          if (playlist) {
            ui.openPlaylistName({
              mode: "rename",
              id: playlist.id,
              initial: playlist.name,
            });
          } else {
            const current = selectCurrentEntry(usePlayerStore.getState());
            if (current) {
              useRenameStore.getState().open({
                id: current.id,
                title: current.title,
                artists: parseArtists(current.channel),
              });
            }
          }
          handled = true;
        } else {
          const player = usePlayerStore.getState();

          switch (e.key) {
            case " ":
              e.preventDefault();
              player.toggle();
              handled = true;
              break;
            case "ArrowLeft":
              e.preventDefault();
              player.seek(Math.max(0, player.currentTimeS - 1));
              handled = true;
              break;
            case "ArrowRight":
              e.preventDefault();
              player.seek(player.currentTimeS + 1);
              handled = true;
              break;
            case "ArrowUp": {
              e.preventDefault();
              const v = Math.min(1, player.volume + 0.01);
              player.setVolume(v);
              if (player.muted && v > 0) player.setMuted(false);
              handled = true;
              break;
            }
            case "ArrowDown":
              e.preventDefault();
              player.setVolume(Math.max(0, player.volume - 0.01));
              handled = true;
              break;
            case "m":
              e.preventDefault();
              player.setMuted(!player.muted);
              handled = true;
              break;
            case ",":
              e.preventDefault();
              player.next();
              handled = true;
              break;
            case ".":
              e.preventDefault();
              player.prev();
              handled = true;
              break;
            case "l":
              e.preventDefault();
              if (selectCurrentEntry(player)) ui.setLyricsDockOpen(!ui.lyricsDockOpen);
              handled = true;
              break;
            case "r":
              e.preventDefault();
              player.cycleRepeat();
              handled = true;
              break;
            case "s":
              e.preventDefault();
              player.toggleShuffle();
              handled = true;
              break;
          }
        }
      }

      // A handled shortcut never leaves focus on a native control — drop it
      // back to the body so no focus ring lingers. Text editors were already
      // excluded above.
      if (handled) {
        (document.activeElement as HTMLElement | null)?.blur();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}