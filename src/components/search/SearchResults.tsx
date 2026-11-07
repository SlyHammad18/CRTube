import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckCircle,
  DownloadSimple,
  Play,
} from "@phosphor-icons/react";
import { useLibraryStore } from "../../stores/library";
import { usePlayerStore } from "../../stores/player";
import { useSearchStore } from "../../stores/search";
import { useSheetStore } from "../../stores/sheet";
import { ipc } from "../../lib/ipc";
import { imgSrcOf, trackArtworkUrl } from "../../lib/asset";
import { fmtDuration } from "../../lib/format";
import { playResult, type StreamItem } from "../../lib/playResult";
import type { LibraryEntry } from "../../types/library";
import type { SearchItem } from "../../types/search";
import { ResultCard } from "./ResultCard";
import { ResultSkeletonGrid } from "./ResultSkeleton";
import { AddToPlaylistMenu, type AddToPlaylistTarget } from "../player/AddToPlaylistMenu";

/**
 * Unified search results: matching library tracks first (play from disk),
 * then live YouTube results (play via the stream relay, download via the
 * format sheet). One component, two presentations — `grid` (Home hero) and
 * `rows` (Player tab pane).
 */

type ResultRowData =
  | { kind: "library"; entry: LibraryEntry; index: number }
  | { kind: "youtube"; item: SearchItem; index: number; inLibrary: boolean };

function streamItem(item: SearchItem): StreamItem {
  return {
    videoId: item.videoId,
    title: item.title,
    channel: item.channel,
    durationS: item.durationS,
    thumbUrl: item.thumbUrl,
  };
}

function openDownloadSheet(item: SearchItem) {
  useSheetStore.getState().openForCard(item);
}

/**
 * Speculative prefetch (web.dev fast-playback): hovering a result pre-resolves
 * its stream URL backend-side (yt-dlp extraction is the dominant startup cost,
 * 2–5s), so a subsequent click plays almost instantly. The shared token makes
 * only the most recently hovered result probe.
 */
let prefetchToken = 0;
const PREFETCH_DELAY_MS = 400;

function useHoverPrefetch(videoId: string, skip: boolean) {
  const timer = useRef<number | undefined>(undefined);
  const onEnter = () => {
    if (skip) return;
    const my = ++prefetchToken;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (prefetchToken !== my) return;
      void ipc.streamMediaUrl(videoId, "video").catch(() => {});
    }, PREFETCH_DELAY_MS);
  };
  const onLeave = () => window.clearTimeout(timer.current);
  return { onEnter, onLeave };
}

function useLibraryMatches(query: string): LibraryEntry[] {
  const entries = useLibraryStore((s) => s.entries);
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return entries.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        (e.channel ?? "").toLowerCase().includes(q),
    );
  }, [entries, query]);
}

/* ------------------------------ result row (rows variant) ------------------ */

function ResultRow({
  row,
  onPlayLibrary,
}: {
  row: ResultRowData;
  onPlayLibrary: (index: number) => void;
}) {
  const prefetch = useHoverPrefetch(
    row.kind === "youtube" ? row.item.videoId : "",
    row.kind !== "youtube" || (row.kind === "youtube" && row.inLibrary),
  );

  const target: AddToPlaylistTarget =
    row.kind === "library"
      ? { type: "library", downloadId: row.entry.id, title: row.entry.title }
      : {
          type: "stream",
          videoId: row.item.videoId,
          title: row.item.title,
          channel: row.item.channel,
          durationS: row.item.durationS,
          thumbUrl: row.item.thumbUrl,
        };

  // Click = play (audio preview). Video switching lives in the Now Playing
  // pane's kind toggle — rows only expose play/download/add.
  const play = () => {
    if (row.kind === "library") onPlayLibrary(row.index);
    else playResult(streamItem(row.item), "audio");
  };

  const thumb =
    row.kind === "library" ? imgSrcOf(trackArtworkUrl(row.entry)) : row.item.thumbUrl;
  const title = row.kind === "library" ? row.entry.title : row.item.title;
  const channel = row.kind === "library" ? row.entry.channel : row.item.channel;
  const duration =
    row.kind === "library"
      ? fmtDuration(row.entry.durationS)
      : fmtDuration(row.item.durationS);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Play ${title}`}
      onClick={play}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          play();
        }
      }}
      onMouseEnter={prefetch.onEnter}
      onMouseLeave={prefetch.onLeave}
      onBlur={prefetch.onLeave}
      className="group flex cursor-pointer items-center gap-3 px-2 py-1.5 transition-colors duration-150 hover:bg-raise/60"
    >
      <div className="relative h-10 w-[72px] shrink-0 overflow-hidden rounded-card border border-line bg-raise">
        {thumb ? (
          <img
            src={thumb}
            alt=""
            width={144}
            height={80}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : null}
        <span className="absolute inset-0 hidden place-items-center bg-void/40 group-hover:grid">
          <Play size={16} weight="fill" className="text-ice" aria-hidden />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-13 text-ink">
          <span className="truncate">{title}</span>
          {row.kind === "youtube" && row.inLibrary && (
            <CheckCircle
              size={12}
              weight="fill"
              className="shrink-0 text-ice"
              aria-label="in library"
            />
          )}
        </p>
        <p className="truncate text-12 text-mute">{channel ?? "—"}</p>
      </div>
      <span className="hidden shrink-0 font-mono text-12 text-mute @lg:block">
        {duration ?? ""}
      </span>
      <div
        className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {row.kind === "youtube" && (
          <button
            aria-label={`Download ${title}`}
            title="Download…"
            onClick={() => openDownloadSheet(row.item)}
            className="grid h-7 w-7 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
          >
            <DownloadSimple size={14} weight="light" aria-hidden />
          </button>
        )}
        <AddToPlaylistMenu target={target} />
      </div>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="px-1 pb-1.5 pt-3 font-mono text-11 uppercase tracking-wide text-dim">
      {label}
    </p>
  );
}

function useInfiniteScroll(
  hasMore: boolean,
  status: string,
  loadMore: () => Promise<void>,
) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || status === "loadingMore" || status === "searching") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, status, loadMore]);
  return sentinelRef;
}

/* --------------------------------- rows variant ---------------------------- */

function RowsResults({ query, libraryQuery }: { query: string; libraryQuery: string }) {
  const items = useSearchStore((s) => s.items);
  const status = useSearchStore((s) => s.status);
  const hasMore = useSearchStore((s) => s.hasMore);
  const loadMore = useSearchStore((s) => s.loadMore);
  const libraryMatches = useLibraryMatches(libraryQuery);
  const libIds = useLibraryStore((s) => s.ids);

  // Flattened section layout: LIBRARY header + matches, YOUTUBE header + items.
  const rows = useMemo<(SearchRowPart | ResultRowData)[]>(() => {
    const list: (SearchRowPart | ResultRowData)[] = [];
    if (libraryMatches.length > 0)
      list.push({ kind: "lib-header", n: libraryMatches.length });
    libraryMatches.forEach((entry, index) =>
      list.push({ kind: "library", entry, index }),
    );
    if (items.length > 0) list.push({ kind: "yt-header", n: items.length });
    items.forEach((item, index) =>
      list.push({
        kind: "youtube",
        item,
        index,
        inLibrary: libIds.has(item.videoId),
      }),
    );
    return list;
  }, [libraryMatches, items, libIds]);

  const playLibrary = (index: number) => {
    usePlayerStore.getState().playAll(libraryMatches, index, { type: "library" });
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      const r = rows[i];
      return r && (r.kind === "lib-header" || r.kind === "yt-header") ? 34 : 57;
    },
    overscan: 10,
  });

  // Re-measure when the row mix changes (headers appear/disappear).
  useEffect(() => {
    rowVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  const sentinelRef = useInfiniteScroll(hasMore, status, loadMore);

  const empty =
    rows.length === 0 ||
    rows.every((r) => r.kind === "lib-header" || r.kind === "yt-header");

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-6">
      {empty ? (
        <EmptyState query={query} />
      ) : (
        <>
          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={rowVirtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${vi.start}px)` }}
                >
                  {row.kind === "lib-header" ? (
                    <SectionHeader label={`Library · ${row.n}`} />
                  ) : row.kind === "yt-header" ? (
                    <SectionHeader label={`YouTube · ${row.n}`} />
                  ) : (
                    <ResultRow row={row} onPlayLibrary={playLibrary} />
                  )}
                </div>
              );
            })}
          </div>
          {hasMore && (
            <div ref={sentinelRef} className="grid place-items-center py-6">
              {status === "loadingMore" ? (
                <span className="font-mono text-12 text-mute">loading more…</span>
              ) : (
                <span className="font-mono text-12 text-mute">scroll for more ↓</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

type SearchRowPart =
  | { kind: "lib-header"; n: number }
  | { kind: "yt-header"; n: number };

/* --------------------------------- grid variant ---------------------------- */

function LibraryMiniCard({
  entry,
  onPlay,
}: {
  entry: LibraryEntry;
  onPlay: () => void;
}) {
  const thumb = imgSrcOf(trackArtworkUrl(entry));
  return (
    <button
      onClick={onPlay}
      className="group flex flex-col gap-1.5 rounded-card border border-line bg-panel p-2 text-left transition-colors duration-150 hover:bg-raise active:scale-[0.99]"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-card bg-raise">
        {thumb && (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover opacity-90"
          />
        )}
        <span className="absolute bottom-1.5 right-1.5 grid h-8 w-8 translate-y-1 place-items-center rounded-full bg-ice text-void opacity-0 shadow-panel transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
          <Play size={13} weight="fill" aria-hidden />
        </span>
      </div>
      <div className="min-w-0">
        <p className="truncate text-12 text-ink">{entry.title}</p>
        <p className="truncate font-mono text-11 text-mute">{entry.channel ?? "—"}</p>
      </div>
    </button>
  );
}

function GridResults({ query }: { query: string }) {
  const items = useSearchStore((s) => s.items);
  const status = useSearchStore((s) => s.status);
  const hasMore = useSearchStore((s) => s.hasMore);
  const loadMore = useSearchStore((s) => s.loadMore);
  const sheetOpen = useSheetStore((s) => s.open);
  const libraryMatches = useLibraryMatches(query);

  const playLibrary = (index: number) => {
    usePlayerStore.getState().playAll(libraryMatches, index, { type: "library" });
  };

  const parentRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);
  const GAP = 16;

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setCols(Math.max(1, Math.floor((w + GAP) / (210 + GAP))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [GAP]);

  const rowCount = Math.ceil(items.length / cols);
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 236,
    overscan: 4,
  });

  const sentinelRef = useInfiniteScroll(hasMore, status, loadMore);

  return (
    <div
      ref={parentRef}
      className={`min-h-0 flex-1 overflow-y-auto pb-6 ${sheetOpen ? "no-scrollbar" : ""}`}
    >
      {libraryMatches.length > 0 && (
        <section className="mb-4">
          <SectionHeader label={`Library · ${libraryMatches.length}`} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
            {libraryMatches.map((entry, index) => (
              <LibraryMiniCard
                key={entry.id}
                entry={entry}
                onPlay={() => playLibrary(index)}
              />
            ))}
          </div>
        </section>
      )}

      {items.length > 0 && (
        <section>
          {libraryMatches.length > 0 && (
            <SectionHeader label={`YouTube · ${items.length}`} />
          )}
          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const start = vi.index * cols;
              const rowItems = items.slice(start, start + cols);
              return (
                <div
                  key={vi.key}
                  ref={rowVirtualizer.measureElement}
                  className="absolute left-0 top-0 grid w-full gap-4 pb-4"
                  style={{
                    transform: `translateY(${vi.start}px)`,
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  }}
                >
                  {rowItems.map((item, ri) => (
                    <ResultCard key={item.videoId} item={item} index={(start + ri) % 20} />
                  ))}
                </div>
              );
            })}
          </div>
          {hasMore && (
            <div ref={sentinelRef} className="grid place-items-center py-6">
              {status === "loadingMore" ? (
                <span className="font-mono text-12 text-mute">loading more…</span>
              ) : (
                <span className="font-mono text-12 text-mute">scroll for more ↓</span>
              )}
            </div>
          )}
        </section>
      )}

      {items.length === 0 && libraryMatches.length === 0 && (
        <EmptyState query={query} />
      )}
    </div>
  );
}

/* ---------------------------------- shared --------------------------------- */

function EmptyState({ query }: { query: string }) {
  const status = useSearchStore((s) => s.status);
  const error = useSearchStore((s) => s.error);
  const search = useSearchStore((s) => s.search);

  if (status === "searching") {
    return (
      <div className="pt-6">
        <ResultSkeletonGrid />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 pt-10">
        <p className="text-center font-mono text-13 text-signal">
          {"> search failed — check your connection"}
        </p>
        {error && (
          <p className="max-w-[520px] break-all text-center font-mono text-12 text-dim">
            {error}
          </p>
        )}
        <button
          onClick={() => void search(query)}
          className="rounded-card border border-line px-3.5 py-1.5 text-13 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
        >
          Retry search
        </button>
      </div>
    );
  }
  if (query && status === "done") {
    return (
      <p className="pt-10 text-center font-mono text-15 text-mute">
        {"> no results for “"}
        {query}
        {"”_"}
      </p>
    );
  }
  return null;
}

/* ----------------------------------- root ---------------------------------- */

export function SearchResults({
  variant,
  libraryQuery,
}: {
  variant: "grid" | "rows";
  /** Override for the library-match filter (the player-tab pane filters on the
   *  live typed value; defaults to the committed search-store query). */
  libraryQuery?: string;
}) {
  const query = useSearchStore((s) => s.query);
  const items = useSearchStore((s) => s.items);
  const status = useSearchStore((s) => s.status);

  // Idle (no committed query, nothing loaded): the parent decides what to show.
  if (!query && !items.length && status === "idle" && !libraryQuery?.trim())
    return null;

  return variant === "grid" ? (
    <GridResults query={query} />
  ) : (
    <RowsResults query={query} libraryQuery={libraryQuery ?? query} />
  );
}
