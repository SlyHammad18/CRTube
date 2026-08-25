import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  FilmStrip,
  FolderOpen,
  MagnifyingGlass,
  MusicNote,
  Play,
  Rows,
  SquaresFour,
  Trash,
  X,
} from "@phosphor-icons/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useLibraryStore, type LibraryFilter } from "../../stores/library";
import { useUIStore } from "../../stores/ui";
import { pushToast } from "../../stores/toast";
import { ipc } from "../../lib/ipc";
import { fmtBytes, fmtDuration } from "../../lib/format";
import type { LibraryEntry } from "../../types/library";

function thumbSrc(entry: LibraryEntry): string | undefined {
  if (!entry.thumbUrl) return undefined;
  if (entry.thumbUrl.startsWith("http")) return entry.thumbUrl;
  return convertFileSrc(entry.thumbUrl);
}

function TypeIcon({ kind }: { kind: string }) {
  return (
    <span className="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-void/80 text-ice">
      {kind === "audio" ? (
        <MusicNote size={13} weight="bold" aria-hidden />
      ) : (
        <FilmStrip size={13} weight="bold" aria-hidden />
      )}
    </span>
  );
}

function EntryActions({ entry }: { entry: LibraryEntry }) {
  const removeLocal = useLibraryStore((s) => s.removeLocal);
  const [confirming, setConfirming] = useState(false);
  const missing = entry.status === "missing";

  const onDelete = async () => {
    try {
      await ipc.deleteEntry(entry.id, entry.path);
      removeLocal(entry.id);
      pushToast(`Deleted — ${entry.title}`);
    } catch (e) {
      pushToast(`Delete failed — ${String(e)}`);
    }
    setConfirming(false);
  };

  if (confirming) {
    return (
      <>
        <span className="mr-auto truncate text-12 text-signal">delete file?</span>
        <button
          aria-label="Confirm delete"
          onClick={() => void onDelete()}
          className="rounded-card bg-signal px-2 py-1 text-12 font-semibold text-void active:scale-[0.98]"
        >
          yes
        </button>
        <button
          aria-label="Cancel delete"
          onClick={() => setConfirming(false)}
          className="grid h-6 w-6 place-items-center rounded-card text-dim hover:bg-raise hover:text-ink"
        >
          <X size={12} weight="light" aria-hidden />
        </button>
      </>
    );
  }

  return (
    <>
      <button
        aria-label="Play in default player"
        title="Open"
        disabled={missing}
        onClick={() =>
          void ipc
            .openPath(entry.path)
            .catch((e) => pushToast(`Open failed — ${String(e)}`))
        }
        className="grid h-7 w-7 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
      >
        <Play size={14} weight="light" aria-hidden />
      </button>
      <button
        aria-label="Reveal in file manager"
        title="Reveal"
        disabled={missing}
        onClick={() =>
          void ipc
            .revealPath(entry.path)
            .catch((e) => pushToast(`Reveal failed — ${String(e)}`))
        }
        className="grid h-7 w-7 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
      >
        <FolderOpen size={14} weight="light" aria-hidden />
      </button>
      <button
        aria-label="Delete entry and file"
        title="Delete"
        onClick={() => setConfirming(true)}
        className="ml-auto grid h-7 w-7 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-signal hover:text-void active:scale-[0.98]"
      >
        <Trash size={14} weight="light" aria-hidden />
      </button>
    </>
  );
}

function EntryCard({ entry }: { entry: LibraryEntry }) {
  const missing = entry.status === "missing";
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className={`group overflow-hidden rounded-card border bg-panel shadow-panel transition-colors duration-150 hover:bg-raise ${
        missing ? "border-amber/40 opacity-70" : "border-line"
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-raise">
        {thumbSrc(entry) && !missing && (
          <img
            src={thumbSrc(entry)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover opacity-90"
          />
        )}
        <TypeIcon kind={entry.kind} />
        {entry.durationS != null && (
          <span className="absolute bottom-1 right-1 rounded-full bg-void/80 px-1.5 py-0.5 font-mono text-11 text-ink">
            {fmtDuration(entry.durationS)}
          </span>
        )}
        {missing && (
          <span className="absolute inset-0 grid place-items-center font-mono text-12 text-amber">
            file missing
          </span>
        )}
      </div>
      <div className="p-2.5">
        <h3 className="line-clamp-2 min-h-[2.5em] text-13 leading-snug text-ink">
          {entry.title}
        </h3>
        <p className="mt-1 flex items-baseline justify-between gap-2 font-mono text-12 text-mute">
          <span>{fmtBytes(entry.sizeBytes) ?? "—"}</span>
          <span>
            {new Date(entry.createdAt * 1000).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        </p>
        <div className="mt-2 flex items-center gap-1">
          <EntryActions entry={entry} />
        </div>
      </div>
    </motion.article>
  );
}

function EntryRow({ entry }: { entry: LibraryEntry }) {
  const missing = entry.status === "missing";
  const date = new Date(entry.createdAt * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={`flex items-center gap-3 rounded-card border bg-panel p-2 transition-colors duration-150 hover:bg-raise ${
        missing ? "border-amber/40 opacity-70" : "border-line"
      }`}
    >
      <div className="relative h-9 w-16 shrink-0 overflow-hidden rounded-card bg-raise">
        {thumbSrc(entry) && !missing && (
          <img src={thumbSrc(entry)} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-13 text-ink">{entry.title}</p>
        <p className="truncate font-mono text-12 text-mute">
          {entry.channel ?? "—"} · {fmtDuration(entry.durationS) ?? "—"} ·{" "}
          {fmtBytes(entry.sizeBytes) ?? "—"} · {date}
          {missing && <span className="text-amber"> · missing</span>}
        </p>
      </div>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-raise text-ice">
        {entry.kind === "audio" ? (
          <MusicNote size={12} weight="bold" aria-hidden />
        ) : (
          <FilmStrip size={12} weight="bold" aria-hidden />
        )}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <EntryActions entry={entry} />
      </div>
    </motion.div>
  );
}

function FilterPills() {
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const pills: { id: LibraryFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "audio", label: "Audio" },
    { id: "video", label: "Video" },
  ];
  return (
    <div role="group" aria-label="Filter library" className="flex gap-1.5">
      {pills.map((p) => (
        <button
          key={p.id}
          aria-pressed={filter === p.id}
          onClick={() => setFilter(p.id)}
          className={`rounded-full border px-3 py-1 text-12 font-medium transition-colors duration-150 active:scale-[0.98] ${
            filter === p.id
              ? "border-ice bg-ice text-void"
              : "border-line text-mute hover:bg-raise hover:text-ink"
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function SearchField() {
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 focus-within:border-ice">
      <MagnifyingGlass size={14} weight="light" className="shrink-0 text-dim" aria-hidden />
      <input
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search library…"
        spellCheck={false}
        aria-label="Search library"
        className="h-6 w-full min-w-0 bg-transparent text-12 text-ink outline-none placeholder:text-dim"
      />
      {searchQuery && (
        <button
          aria-label="Clear search"
          onClick={() => setSearchQuery("")}
          className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-dim hover:bg-raise hover:text-ink"
        >
          <X size={10} weight="bold" aria-hidden />
        </button>
      )}
    </div>
  );
}

function DensityToggle() {
  const density = useLibraryStore((s) => s.density);
  const setDensity = useLibraryStore((s) => s.setDensity);
  const btn = (active: boolean) =>
    `grid h-7 w-8 place-items-center rounded-card transition-colors duration-150 active:scale-[0.98] ${
      active ? "bg-raise text-ink" : "text-dim hover:text-ink"
    }`;
  return (
    <div
      role="group"
      aria-label="Density"
      className="flex shrink-0 items-center gap-0.5 rounded-card border border-line p-0.5"
    >
      <button aria-label="Grid view" aria-pressed={density === "grid"} onClick={() => setDensity("grid")} className={btn(density === "grid")}>
        <SquaresFour size={14} weight="light" aria-hidden />
      </button>
      <button aria-label="List view" aria-pressed={density === "list"} onClick={() => setDensity("list")} className={btn(density === "list")}>
        <Rows size={14} weight="light" aria-hidden />
      </button>
    </div>
  );
}

function ControlsRow() {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2.5">
      <FilterPills />
      <SearchField />
      <DensityToggle />
    </div>
  );
}

export function LibraryView() {
  const entries = useLibraryStore((s) => s.entries);
  const loaded = useLibraryStore((s) => s.loaded);
  const filter = useLibraryStore((s) => s.filter);
  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const density = useLibraryStore((s) => s.density);
  const refresh = useLibraryStore((s) => s.refresh);
  const setView = useUIStore((s) => s.setView);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (filter === "all" || e.kind === filter) &&
        (q === "" ||
          e.title.toLowerCase().includes(q) ||
          (e.channel ?? "").toLowerCase().includes(q)),
    );
  }, [entries, filter, searchQuery]);

  const totalBytes = entries.reduce((acc, e) => acc + (e.sizeBytes ?? 0), 0);
  const gb = (totalBytes / 1024 ** 3).toFixed(1);

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col pt-[6vh]">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="font-display text-18 font-semibold tracking-tight">Library</h1>
        {entries.length > 0 && (
          <span className="font-mono text-12 text-mute">
            {entries.length} items · {gb} GB
          </span>
        )}
      </header>

      {loaded && entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-[16vh]">
          <p className="font-mono text-15 text-mute">{"> nothing archived yet_"}</p>
          <button
            onClick={() => setView("search")}
            className="rounded-card bg-ice px-4 py-2 text-13 font-semibold text-void hover:bg-ink active:scale-[0.98]"
          >
            Find something to download
          </button>
        </div>
      ) : (
        <>
          <ControlsRow />
          {filtered.length === 0 ? (
            <p className="mt-10 text-center font-mono text-15 text-mute">
              {"> no matches for “"}
              {searchQuery.trim() || filter}
              {"”_"}
            </p>
          ) : density === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
              <AnimatePresence initial={false}>
                {filtered.map((entry) => (
                  <EntryCard key={entry.id} entry={entry} />
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <AnimatePresence initial={false}>
                {filtered.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      )}
    </div>
  );
}
