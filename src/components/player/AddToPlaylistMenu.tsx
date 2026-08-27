import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Check, Plus } from "@phosphor-icons/react";
import { usePlaylistsStore } from "../../stores/playlists";
import { pushToast } from "../../stores/toast";
import { confirm } from "../../stores/confirm";

/**
 * `＋` row action → popover listing playlists with membership checkmarks.
 * Clicking a checked playlist removes the track (backend dedupe makes
 * double-adds impossible either way); inline composer creates + adds.
 */
export function AddToPlaylistMenu({ downloadId }: { downloadId: number }) {
  const playlists = usePlaylistsStore((s) => s.playlists);
  const members = usePlaylistsStore((s) => s.members);
  const addTo = usePlaylistsStore((s) => s.addTo);
  const removeFrom = usePlaylistsStore((s) => s.removeFrom);
  const create = usePlaylistsStore((s) => s.create);
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);

  const place = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight ?? 240;
    const flipDown = r.top < menuH + 8;
    const top = flipDown ? r.bottom + 4 : r.top - menuH - 4;
    const right = window.innerWidth - r.right;
    setCoords({ top, right });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open, composing]);

  useEffect(() => {
    if (!open) return;
    const onScrollResize = () => place();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const act = (fn: () => Promise<unknown>) => {
    void fn()
      .then(() => setOpen(false))
      .catch((e: unknown) => pushToast(`Playlist update failed — ${String(e)}`));
  };

  return (
    <>
      <button
        ref={btnRef}
        aria-label="Add to playlist"
        title="Add to playlist"
        onClick={() => setOpen((v) => !v)}
        className="grid h-7 w-7 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
      >
        <Plus size={14} weight="light" aria-hidden />
      </button>
      {open &&
        createPortal(
          <>
            <button
              aria-label="Close add-to-playlist menu"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div
              ref={menuRef}
              role="menu"
              aria-label="Playlists"
              style={
                coords
                  ? { position: "fixed", top: coords.top, right: coords.right, zIndex: 50 }
                  : { position: "fixed", visibility: "hidden" }
              }
              className="w-56 rounded-card border border-line bg-panel p-1 shadow-panel"
            >
            {playlists.length === 0 && !composing && (
              <p className="px-2.5 py-2 font-mono text-12 text-dim">
                no playlists yet
              </p>
            )}
            {playlists.map((p) => {
              const itemId = members[p.id]?.[downloadId];
              return (
                <button
                  key={p.id}
                  role="menuitem"
                  onClick={async () => {
                    if (itemId != null) {
                      const ok = await confirm({
                        title: "Remove from playlist?",
                        message: `Removes this track from “${p.name}” (file stays in your library).`,
                        confirmLabel: "Remove",
                      });
                      if (ok) act(() => removeFrom(p.id, itemId));
                    } else {
                      act(() => addTo(p.id, downloadId));
                    }
                  }}
                  className="flex w-full items-center gap-2 rounded-card px-2.5 py-1.5 text-left transition-colors duration-150 hover:bg-raise"
                >
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded-sm border ${
                      itemId != null
                        ? "border-ice bg-ice text-void"
                        : "border-line text-transparent"
                    }`}
                  >
                    <Check size={10} weight="bold" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-13 text-ink">
                    {p.name}
                  </span>
                  <span className="shrink-0 font-mono text-11 text-mute">
                    {p.trackCount}
                  </span>
                </button>
              );
            })}
            {composing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = draft.trim();
                  if (!name) return;
                  act(async () => {
                    const pl = await create(name);
                    await addTo(pl.id, downloadId);
                  });
                  setDraft("");
                  setComposing(false);
                }}
                className="mt-0.5 border-t border-line p-1"
              >
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setComposing(false);
                      setDraft("");
                    }
                  }}
                  placeholder="New playlist name…"
                  spellCheck={false}
                  aria-label="New playlist name"
                  className="h-7 w-full rounded-card border border-line bg-raise px-2 text-12 text-ink outline-none focus:border-ice placeholder:text-dim"
                />
              </form>
            ) : (
              <button
                role="menuitem"
                onClick={() => setComposing(true)}
                className="mt-0.5 flex w-full items-center gap-2 border-t border-line px-2.5 py-2 text-left text-13 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink"
              >
                <Plus size={12} weight="light" aria-hidden />
                New playlist…
              </button>
            )}
          </div>
          </>,
          document.body,
        )}
    </>
  );
}
