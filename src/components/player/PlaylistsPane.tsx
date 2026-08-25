import { useEffect, useState } from "react";
import {
  ClockCounterClockwise,
  DotsThreeVertical,
  MusicNote,
  PencilSimple,
  Play,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import { fmtBytes } from "../../lib/format";
import { useLibraryStore } from "../../stores/library";
import { usePlayerStore } from "../../stores/player";
import { usePlaylistsStore } from "../../stores/playlists";
import { useUIStore } from "../../stores/ui";
import { pushToast } from "../../stores/toast";

function SidebarLabel({ children }: { children: string }) {
  return (
    <p className="px-2 pb-1.5 font-mono text-11 uppercase tracking-wide text-dim">
      {children}
    </p>
  );
}

function LibraryItem({
  label,
  icon,
  active,
  count,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "true" : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-card px-2 py-1.5 text-left text-13 transition-colors duration-150 active:scale-[0.99] ${
        active ? "bg-raise text-ice" : "text-mute hover:bg-raise hover:text-ink"
      }`}
    >
      <span className="shrink-0" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && (
        <span className="shrink-0 font-mono text-11 text-mute">{count}</span>
      )}
    </button>
  );
}

/** Inline create/rename input (enter commits, escape cancels). */
function NameInput({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial ?? "");
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(value.trim());
        if (e.key === "Escape") onCancel();
      }}
      onBlur={() => value.trim() === "" && onCancel()}
      placeholder={placeholder}
      spellCheck={false}
      aria-label={placeholder}
      className="h-7 w-full rounded-card border border-line bg-raise px-2 text-12 text-ink outline-none focus:border-ice placeholder:text-dim"
    />
  );
}

export function PlaylistsPane() {
  const playlists = usePlaylistsStore((s) => s.playlists);
  const loaded = usePlaylistsStore((s) => s.loaded);
  const selection = usePlaylistsStore((s) => s.selection);
  const openLibrary = usePlaylistsStore((s) => s.openLibrary);
  const openPlaylist = usePlaylistsStore((s) => s.openPlaylist);
  const create = usePlaylistsStore((s) => s.create);
  const rename = usePlaylistsStore((s) => s.rename);
  const remove = usePlaylistsStore((s) => s.remove);

  const libEntries = useLibraryStore((s) => s.entries);
  const setView = useUIStore((s) => s.setView);
  const playAll = usePlayerStore((s) => s.playAll);

  const [composing, setComposing] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);

  useEffect(() => {
    if (!loaded) void usePlaylistsStore.getState().refresh();
    // Also refresh the library counts when the pane mounts.
    void useLibraryStore.getState().refresh();
  }, [loaded]);

  const totalBytes = libEntries.reduce((acc, e) => acc + (e.sizeBytes ?? 0), 0);

  return (
    <aside className="flex h-full w-[216px] shrink-0 flex-col border-r border-line bg-panel/50">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <SidebarLabel>Library</SidebarLabel>
        <LibraryItem
          label="All Tracks"
          icon={<MusicNote size={14} weight="light" />}
          active={selection.type === "library" && !selection.recent}
          count={libEntries.length}
          onClick={() => openLibrary(false)}
        />
        <LibraryItem
          label="Recently Added"
          icon={<ClockCounterClockwise size={14} weight="light" />}
          active={selection.type === "library" && selection.recent}
          onClick={() => openLibrary(true)}
        />

        <div className="mt-5 flex items-center justify-between">
          <SidebarLabel>Playlists</SidebarLabel>
          <button
            aria-label="New playlist"
            title="New playlist"
            onClick={() => setComposing(true)}
            className="mr-1 grid h-6 w-6 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ice active:scale-[0.98]"
          >
            <Plus size={13} weight="light" aria-hidden />
          </button>
        </div>

        {composing && (
          <div className="mb-1.5 px-1">
            <NameInput
              placeholder="Playlist name…"
              onCancel={() => setComposing(false)}
              onCommit={(name) => {
                if (!name) return;
                void create(name)
                  .then((pl) => openPlaylist(pl.id))
                  .catch((e) => pushToast(`Create failed — ${String(e)}`));
                setComposing(false);
              }}
            />
          </div>
        )}

        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {playlists.map((p) => {
            const active = selection.type === "playlist" && selection.id === p.id;
            if (renamingId === p.id) {
              return (
                <li key={p.id} className="px-1 py-0.5">
                  <NameInput
                    initial={p.name}
                    placeholder="Rename playlist…"
                    onCancel={() => setRenamingId(null)}
                    onCommit={(name) => {
                      if (name)
                        void rename(p.id, name).catch((e) =>
                          pushToast(`Rename failed — ${String(e)}`),
                        );
                      setRenamingId(null);
                    }}
                  />
                </li>
              );
            }
            if (deletingId === p.id) {
              return (
                <li key={p.id} className="flex items-center gap-1.5 px-1 py-0.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-11 text-signal">
                    delete “{p.name}”?
                  </span>
                  <button
                    aria-label="Confirm delete playlist"
                    onClick={() => {
                      void remove(p.id).catch((e) =>
                        pushToast(`Delete failed — ${String(e)}`),
                      );
                      setDeletingId(null);
                    }}
                    className="rounded-card bg-signal px-2 py-1 text-11 font-semibold text-void active:scale-[0.98]"
                  >
                    yes
                  </button>
                  <button
                    aria-label="Cancel delete"
                    onClick={() => setDeletingId(null)}
                    className="grid h-6 w-6 place-items-center rounded-card text-dim hover:bg-raise hover:text-ink"
                  >
                    <X size={12} weight="light" aria-hidden />
                  </button>
                </li>
              );
            }
            return (
              <li key={p.id} className="relative">
                <div
                  role="button"
                  tabIndex={0}
                  aria-current={active ? "true" : undefined}
                  onClick={() => void openPlaylist(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void openPlaylist(p.id);
                  }}
                  className={`group flex w-full cursor-default items-center gap-2 rounded-card px-2 py-1.5 text-left text-13 transition-colors duration-150 ${
                    active
                      ? "bg-raise text-ice"
                      : "text-mute hover:bg-raise hover:text-ink"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="shrink-0 font-mono text-11 text-mute">
                    {p.trackCount}
                  </span>
                  <button
                    aria-label={`Playlist options for ${p.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuFor(menuFor === p.id ? null : p.id);
                    }}
                    className={`grid h-5 w-5 shrink-0 place-items-center rounded-card text-dim transition-all duration-150 hover:text-ink ${
                      menuFor === p.id
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                    }`}
                  >
                    <DotsThreeVertical size={12} weight="light" aria-hidden />
                  </button>
                </div>
                {menuFor === p.id && (
                  <>
                    <button
                      aria-label="Close playlist menu"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuFor(null);
                      }}
                      className="fixed inset-0 z-40 cursor-default"
                    />
                    <div
                      role="menu"
                      className="absolute right-1 top-8 z-50 w-40 rounded-card border border-line bg-panel p-1 shadow-panel"
                    >
                      <button
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFor(null);
                          playAll(libEntries, 0, { type: "playlist", id: p.id });
                        }}
                        className="flex w-full items-center gap-2 rounded-card px-2.5 py-1.5 text-left text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink"
                      >
                        <Play size={12} weight="light" aria-hidden /> Play all
                      </button>
                      <button
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFor(null);
                          setRenamingId(p.id);
                        }}
                        className="flex w-full items-center gap-2 rounded-card px-2.5 py-1.5 text-left text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink"
                      >
                        <PencilSimple size={12} weight="light" aria-hidden /> Rename
                      </button>
                      <button
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFor(null);
                          setDeletingId(p.id);
                        }}
                        className="flex w-full items-center gap-2 rounded-card px-2.5 py-1.5 text-left text-12 text-signal transition-colors duration-150 hover:bg-signal hover:text-void"
                      >
                        <Trash size={12} weight="light" aria-hidden /> Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
          {loaded && playlists.length === 0 && !composing && (
            <li className="px-2 py-1 font-mono text-11 leading-relaxed text-dim">
              none yet — hit + or add tracks with ＋
            </li>
          )}
        </ul>
      </div>

      {/* Storage footer — mono per §2.2 */}
      <footer className="border-t border-line px-4 py-2.5 font-mono text-11 text-mute">
        <button
          onClick={() => setView("library")}
          className="transition-colors duration-150 hover:text-ink"
          title="Open full library"
        >
          {libEntries.length} tracks · {fmtBytes(totalBytes) ?? "0 B"}
        </button>
      </footer>
    </aside>
  );
}
