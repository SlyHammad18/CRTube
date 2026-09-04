import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "@phosphor-icons/react";
import { useLibraryStore } from "../../stores/library";
import { useRenameStore } from "../../stores/rename";
import { parseArtists } from "../../lib/format";
import { pushToast } from "../../stores/toast";

/**
 * Global track rename dialog (Title + multi-artist chips). Driven by
 * `useRenameStore`; renders nothing when no target is pending. Artists support
 * type-to-add chips plus suggestions drawn from the library's existing artists.
 * Enter / comma commits a chip; Backspace on empty removes the last; Enter on an
 * empty chip field saves; Escape / backdrop cancels.
 */
export function RenameTrackModal() {
  const target = useRenameStore((s) => s.target);
  const close = useRenameStore((s) => s.close);
  const entries = useLibraryStore((s) => s.entries);
  const reduce = useReducedMotion();

  const [title, setTitle] = useState("");
  const [artists, setArtists] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const artistRef = useRef<HTMLInputElement>(null);

  // Unique artist names already present in the library (for suggestions).
  const knownArtists = useMemo(
    () => Array.from(new Set(entries.flatMap((e) => parseArtists(e.channel)))),
    [entries],
  );

  useEffect(() => {
    if (target) {
      setTitle(target.title);
      setArtists(target.artists);
      setInput("");
      requestAnimationFrame(() => titleRef.current?.focus());
    }
  }, [target]);

  const suggestions = useMemo(() => {
    const q = input.trim().toLowerCase();
    return knownArtists.filter(
      (a) =>
        a.toLowerCase().includes(q) &&
        !artists.some((x) => x.toLowerCase() === a.toLowerCase()),
    );
  }, [knownArtists, input, artists]);

  const addArtist = (name: string) => {
    const t = name.trim();
    if (!t) return;
    setArtists((prev) =>
      prev.some((x) => x.toLowerCase() === t.toLowerCase()) ? prev : [...prev, t],
    );
    setInput("");
    artistRef.current?.focus();
  };

  const removeArtist = (i: number) =>
    setArtists((prev) => prev.filter((_, idx) => idx !== i));

  const save = () => {
    if (!target) return;
    const trimmed = title.trim();
    if (!trimmed) {
      pushToast("Title can't be empty");
      return;
    }
    const pending = input.trim();
    const finalArtists =
      pending && !artists.some((a) => a.toLowerCase() === pending.toLowerCase())
        ? [...artists, pending]
        : artists;
    const rename = useLibraryStore.getState().renameEntry;
    if (typeof rename !== "function") {
      console.error("renameEntry store action is missing — stale build");
      pushToast("Rename unavailable — restart the app to apply updates");
      return;
    }
    try {
      rename(target.id, trimmed, finalArtists);
    } catch (e) {
      console.error("renameEntry threw", e);
      pushToast(`Rename failed — ${String(e)}`);
    }
    close();
  };

  const onArtistKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (input.trim()) addArtist(input);
      else save();
    } else if (e.key === ",") {
      e.preventDefault();
      if (input.trim()) addArtist(input);
    } else if (e.key === "Backspace" && input === "" && artists.length > 0) {
      removeArtist(artists.length - 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <AnimatePresence>
      {target && (
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
            aria-label="Rename track"
            onClick={(e) => e.stopPropagation()}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
            transition={{
              duration: reduce ? 0.01 : 0.15,
            }}
            className="w-[min(92vw,380px)] rounded-card border border-line bg-panel p-4 shadow-panel"
          >
            <h2 className="text-15 font-semibold text-ink">Rename track</h2>
            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-mono text-11 uppercase tracking-wide text-dim">
                  Title
                </span>
                <input
                  ref={titleRef}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save();
                    if (e.key === "Escape") close();
                  }}
                  spellCheck={false}
                  aria-label="Track title"
                  className="h-9 w-full rounded-card border border-line bg-raise px-3 text-13 text-ink outline-none focus:border-ice placeholder:text-dim"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-mono text-11 uppercase tracking-wide text-dim">
                  Artists
                </span>
                <div className="rounded-card border border-line bg-raise px-2 py-1.5 transition-colors focus-within:border-ice">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {artists.map((a, i) => (
                      <span
                        key={`${a}-${i}`}
                        className="flex items-center gap-1 rounded-full border border-line bg-panel px-2 py-0.5 text-12 text-ink"
                      >
                        {a}
                        <button
                          aria-label={`Remove ${a}`}
                          onClick={() => removeArtist(i)}
                          className="grid h-4 w-4 place-items-center rounded-full text-mute transition-colors hover:text-signal"
                        >
                          <X size={10} weight="bold" aria-hidden />
                        </button>
                      </span>
                    ))}
                    <input
                      ref={artistRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onFocus={() => setFocused(true)}
                      onBlur={() => setFocused(false)}
                      onKeyDown={onArtistKey}
                      spellCheck={false}
                      aria-label="Add artist"
                      placeholder={artists.length ? "" : "Unknown"}
                      className="h-7 min-w-[6rem] flex-1 bg-transparent text-13 text-ink outline-none placeholder:text-dim"
                    />
                  </div>
                  {focused && suggestions.length > 0 && (
                    <ul className="mt-1.5 max-h-40 overflow-y-auto border-t border-line pt-1.5">
                      {suggestions.map((s) => (
                        <li key={s}>
                          <button
                            onMouseDown={(e) => {
                              e.preventDefault();
                              addArtist(s);
                            }}
                            className="flex w-full items-center gap-2 rounded-card px-2 py-1 text-left text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink"
                          >
                            {s}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </label>
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
                onClick={save}
                className="rounded-card bg-ice px-3 py-1.5 text-13 font-semibold text-void transition-colors duration-150 hover:bg-ink active:scale-[0.98]"
              >
                Save
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
