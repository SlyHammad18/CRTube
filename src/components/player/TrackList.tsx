import { useEffect, useMemo, useState } from "react";
import { Reorder, useDragControls, useReducedMotion } from "motion/react";
import { MagnifyingGlass, SidebarSimple, Play, X } from "@phosphor-icons/react";
import { fmtDuration } from "../../lib/format";
import type { LibraryEntry } from "../../types/library";
import type { PlaylistTrack } from "../../types/player";
import { useLibraryStore } from "../../stores/library";
import { usePlayerStore } from "../../stores/player";
import { usePlaylistsStore } from "../../stores/playlists";
import { useUIStore } from "../../stores/ui";
import { ConsolePrompt } from "../common/ConsolePrompt";
import { TrackRow } from "./TrackRow";
import { SortMenu } from "./SortMenu";

export type SortKey = "manual" | "title" | "duration" | "added";
type Filter = "all" | "audio" | "video";

/** One draggable playlist row (manual-order mode only). */
function DragRow({
  track,
  index,
  onPlay,
  onRemoveFrom,
}: {
  track: PlaylistTrack;
  index: number;
  onPlay: () => void;
  onRemoveFrom: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={track}
      dragListener={false}
      dragControls={controls}
      as="div"
      className="list-none"
    >
      <TrackRow
        entry={track}
        index={index}
        onPlay={onPlay}
        grip={{ onPointerDown: (e) => controls.start(e) }}
        onRemoveFrom={onRemoveFrom}
      />
    </Reorder.Item>
  );
}

export function TrackList() {
  const reduce = useReducedMotion();
  const selection = usePlaylistsStore((s) => s.selection);
  const openTracks = usePlaylistsStore((s) => s.openTracks);
  const playlists = usePlaylistsStore((s) => s.playlists);
  const reorder = usePlaylistsStore((s) => s.reorder);
  const removeFrom = usePlaylistsStore((s) => s.removeFrom);
  const libEntries = useLibraryStore((s) => s.entries);
  const setView = useUIStore((s) => s.setView);
  const nowPlayingOpen = useUIStore((s) => s.nowPlayingOpen);
  const setNowPlayingOpen = useUIStore((s) => s.setNowPlayingOpen);

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "added",
    dir: -1,
  });

  // Playlists default to manual (position) order; library to newest-first.
  useEffect(() => {
    setSort(
      selection.type === "playlist"
        ? { key: "manual", dir: 1 }
        : { key: "added", dir: -1 },
    );
  }, [selection]);

  const source: LibraryEntry[] =
    selection.type === "playlist" ? (openTracks ?? []) : libEntries;

  /** Rows after filter + search, before sorting. */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return source.filter(
      (e) =>
        (filter === "all" || e.kind === filter) &&
        (q === "" ||
          e.title.toLowerCase().includes(q) ||
          (e.channel ?? "").toLowerCase().includes(q)),
    );
  }, [source, filter, query]);

  const displayed = useMemo(() => {
    const key = sort.key;
    if (key === "manual") return filtered;
    const cmp: Record<"title" | "duration" | "added", (a: LibraryEntry, b: LibraryEntry) => number> = {
      title: (a, b) => a.title.localeCompare(b.title),
      duration: (a, b) => (a.durationS ?? 0) - (b.durationS ?? 0),
      added: (a, b) => a.createdAt - b.createdAt,
    };
    return [...filtered].sort((a, b) => cmp[key](a, b) * sort.dir);
  }, [filtered, sort]);

  const playAt = (i: number) => {
    if (!displayed[i]) return;
    const ctx = usePlaylistsStore.getState().selection;
    usePlayerStore.getState().playAll(displayed, i, {
      type: ctx.type,
      id: ctx.type === "playlist" ? ctx.id : undefined,
    });
  };

  const totalS = displayed.reduce((acc, e) => acc + (e.durationS ?? 0), 0);
  const isManualDrag = selection.type === "playlist" && sort.key === "manual";
  const activePlaylist =
    selection.type === "playlist"
      ? playlists.find((p) => p.id === selection.id)
      : undefined;

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 px-6 pt-6">
        <div className="min-w-0">
          <h1 className="truncate font-display text-18 font-semibold tracking-tight">
            {selection.type === "playlist"
              ? (activePlaylist?.name ?? "Playlist")
              : selection.recent
                ? "Recently Added"
                : "All Tracks"}
          </h1>
          <p className="mt-0.5 font-mono text-12 text-mute">
            {displayed.length} {displayed.length === 1 ? "track" : "tracks"}
            {totalS > 0 && ` · ${fmtDuration(totalS)}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            aria-label="Toggle now playing pane"
            aria-pressed={nowPlayingOpen}
            title="Toggle now playing"
            onClick={() => setNowPlayingOpen(!nowPlayingOpen)}
            className={`grid h-8 w-8 place-items-center rounded-card transition-colors duration-150 active:scale-[0.98] ${
              nowPlayingOpen ? "text-ice" : "text-mute hover:bg-raise hover:text-ink"
            }`}
          >
            <SidebarSimple size={16} weight="light" aria-hidden />
          </button>
          {selection.type === "playlist" && (
            <button
              aria-label="Play all"
              disabled={displayed.length === 0}
              onClick={() => playAt(0)}
              className="flex items-center gap-1.5 rounded-card bg-ice px-4 py-2 text-13 font-semibold text-void transition-colors duration-150 hover:bg-ink active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            >
              <Play size={13} weight="fill" aria-hidden />
              PLAY ALL
            </button>
          )}
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex flex-nowrap items-center gap-2 px-6 pb-3 pt-4">
        <div role="group" aria-label="Filter tracks" className="flex shrink-0 gap-1.5">
          {(["all", "audio", "video"] as const).map((f) => (
            <button
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-12 font-medium capitalize transition-colors duration-150 active:scale-[0.98] ${
                filter === f
                  ? "border-ice bg-ice text-void"
                  : "border-line text-mute hover:bg-raise hover:text-ink"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 focus-within:border-ice">
          <MagnifyingGlass size={14} weight="light" className="shrink-0 text-dim" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tracks…"
            spellCheck={false}
            aria-label="Search tracks"
            className="h-6 w-full min-w-0 bg-transparent text-12 text-ink outline-none placeholder:text-dim"
          />
          {query && (
            <button
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-dim hover:bg-raise hover:text-ink"
            >
              <X size={10} weight="bold" aria-hidden />
            </button>
          )}
        </div>

        <SortMenu sort={sort} setSort={setSort} isPlaylist={selection.type === "playlist"} />
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {libEntries.length === 0 && selection.type === "library" ? (
          <div className="flex flex-col items-center justify-center gap-4 pt-[18vh]">
            <p className="font-mono text-15 text-mute">{"> awaiting media_"}</p>
            <button
              onClick={() => setView("search")}
              className="rounded-card bg-ice px-4 py-2 text-13 font-semibold text-void hover:bg-ink active:scale-[0.98]"
            >
              Download something first
            </button>
          </div>
        ) : selection.type === "playlist" &&
          (openTracks?.length ?? 0) === 0 &&
          !query.trim() &&
          filter === "all" ? (
          <div className="flex h-full items-center justify-center">
            <ConsolePrompt
              lines={["> this playlist is empty", "> add tracks with +"]}
            />
          </div>
        ) : displayed.length === 0 ? (
          <p className="mt-10 text-center font-mono text-15 text-mute">
            {"> no matches for \u201c"}
            {query.trim() || filter}
            {"\u201d_"}
          </p>
        ) : isManualDrag ? (
          <Reorder.Group
            axis="y"
            values={displayed}
            onReorder={(next: LibraryEntry[]) => {
              const ids = next
                .map((t) => (t as PlaylistTrack).itemId)
                .filter((id) => id != null);
              void reorder(ids);
            }}
            as="ul"
            className="m-0 flex list-none flex-col gap-1.5 p-0"
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 22 }}
          >
            {displayed.map((t, i) => (
              <DragRow
                key={(t as PlaylistTrack).itemId}
                track={t as PlaylistTrack}
                index={i}
                onPlay={() => playAt(i)}
                onRemoveFrom={() =>
                  selection.type === "playlist" &&
                  void removeFrom(selection.id, (t as PlaylistTrack).itemId)
                }
              />
            ))}
          </Reorder.Group>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {displayed.map((e, i) => (
              <li key={`${e.id}-${i}`} className="list-none">
                <TrackRow entry={e} index={i} onPlay={() => playAt(i)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
