import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useUIStore } from "../../stores/ui";
import { usePlaylistsStore } from "../../stores/playlists";
import { pushToast } from "../../stores/toast";

/**
 * Global new/rename playlist dialog (Ctrl+N / F2). Driven by the `playlistName`
 * draft in the UI store; renders nothing when no draft is pending. Enter
 * commits, Escape / backdrop cancels.
 */
export function PlaylistNameDialog() {
  const draft = useUIStore((s) => s.playlistName);
  const close = useUIStore((s) => s.closePlaylistName);
  const reduce = useReducedMotion();
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draft) {
      setName(draft.initial ?? "");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [draft]);

  const commit = () => {
    if (!draft) return;
    const trimmed = name.trim();
    if (!trimmed) {
      pushToast("Name can't be empty");
      return;
    }
    const store = usePlaylistsStore.getState();
    if (draft.mode === "create") {
      void store
        .create(trimmed)
        .then((pl) => store.openPlaylist(pl.id))
        .catch((e) => pushToast(`Create failed — ${String(e)}`));
    } else if (draft.id != null) {
      void store
        .rename(draft.id, trimmed)
        .catch((e) => pushToast(`Rename failed — ${String(e)}`));
    }
    close();
  };

  return (
    <AnimatePresence>
      {draft && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center bg-void/60 p-4"
          onClick={close}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.01 : 0.1 }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={draft.mode === "create" ? "New playlist" : "Rename playlist"}
            onClick={(e) => e.stopPropagation()}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
            transition={{
              duration: reduce ? 0.01 : 0.15,
            }}
            className="w-[min(92vw,380px)] rounded-card border border-line bg-panel p-4 shadow-panel"
          >
            <h2 className="text-15 font-semibold text-ink">
              {draft.mode === "create" ? "New playlist" : "Rename playlist"}
            </h2>
            <div className="mt-4 flex flex-col gap-1">
              <span className="font-mono text-11 uppercase tracking-wide text-dim">
                Name
              </span>
              <input
                ref={inputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") close();
                }}
                spellCheck={false}
                aria-label="Playlist name"
                placeholder="Playlist name…"
                className="h-9 w-full rounded-card border border-line bg-raise px-3 text-13 text-ink outline-none focus:border-ice placeholder:text-dim"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={close}
                className="rounded-card border border-line px-3 py-1.5 text-13 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
              >
                Cancel
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={commit}
                className="rounded-card bg-ice px-3 py-1.5 text-13 font-semibold text-void transition-colors duration-150 hover:bg-ink active:scale-[0.98]"
              >
                {draft.mode === "create" ? "Create" : "Save"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}