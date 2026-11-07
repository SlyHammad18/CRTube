import { memo, useRef } from "react";
import { CheckCircle, DownloadSimple, Play } from "@phosphor-icons/react";
import { useLibraryStore } from "../../stores/library";
import { useSheetStore } from "../../stores/sheet";
import { ipc } from "../../lib/ipc";
import { fmtCount, fmtDuration } from "../../lib/format";
import { playResult, type StreamItem } from "../../lib/playResult";
import { useReveal } from "../../hooks/useReveal";
import type { SearchItem } from "../../types/search";
import { AddToPlaylistMenu, type AddToPlaylistTarget } from "../player/AddToPlaylistMenu";

/**
 * Speculative prefetch (web.dev fast-playback): hovering a card pre-resolves
 * its stream URL backend-side (yt-dlp extraction is the dominant startup cost,
 * 2–5s), so a subsequent ▶ click plays almost instantly. The shared token
 * makes only the most recently hovered card probe, and the delay keeps grid
 * sweeps from firing probes at all.
 */
let prefetchToken = 0;
const PREFETCH_DELAY_MS = 400;

interface ResultCardProps {
  item: SearchItem;
  index: number;
}

function streamItem(item: SearchItem): StreamItem {
  return {
    videoId: item.videoId,
    title: item.title,
    channel: item.channel,
    durationS: item.durationS,
    thumbUrl: item.thumbUrl,
  };
}

export const ResultCard = memo(function ResultCard({ item, index }: ResultCardProps) {
  const inLibrary = useLibraryStore((s) => s.ids.has(item.videoId));
  const openSheet = useSheetStore((s) => s.openForCard);
  const { ref, visible } = useReveal<HTMLDivElement>();
  const hoverTimer = useRef<number | undefined>(undefined);

  const duration = fmtDuration(item.durationS);
  const views = fmtCount(item.views);

  const onHoverStart = () => {
    if (inLibrary) return;
    const my = ++prefetchToken;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      if (prefetchToken !== my) return;
      void ipc.streamMediaUrl(item.videoId, "video").catch(() => {});
    }, PREFETCH_DELAY_MS);
  };
  const onHoverEnd = () => window.clearTimeout(hoverTimer.current);

  // Click = play (audio preview): the downloaded library copy when one exists,
  // otherwise a live stream in the main player. Video switching lives in the
  // Now Playing pane's kind toggle.
  const play = () => playResult(streamItem(item), "audio");

  const addToTarget: AddToPlaylistTarget = {
    type: "stream",
    videoId: item.videoId,
    title: item.title,
    channel: item.channel,
    durationS: item.durationS,
    thumbUrl: item.thumbUrl,
  };

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label={`Play ${item.title}`}
      onClick={() => play()}
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      onBlur={onHoverEnd}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          play();
        }
      }}
      className={`group relative cursor-pointer overflow-hidden rounded-card border border-line bg-panel transition-[background-color,scale] duration-150 hover:bg-raise active:scale-[0.98] ${
        visible ? "result-card--visible" : "result-card--hidden"
      }`}
      style={{ transitionDelay: `${Math.min(index % 4, 3) * 50}ms` }}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-raise">
        {item.thumbUrl && (
          <img
            src={item.thumbUrl}
            alt=""
            width={480}
            height={360}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover opacity-90 transition-opacity duration-150 group-hover:opacity-100"
          />
        )}
        {duration && (
          <span className="absolute bottom-1 right-1 rounded-full bg-void/80 px-1.5 py-0.5 font-mono text-11 text-ink transition-opacity duration-150 group-hover:opacity-0">
            {duration}
          </span>
        )}
        <div className="absolute bottom-1 left-1 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <button
            aria-label={`Play ${item.title}`}
            title="Play"
            onClick={(e) => {
              e.stopPropagation();
              play();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                play();
              }
            }}
            className="grid h-8 w-8 place-items-center rounded-full bg-void/80 text-ice transition-colors duration-150 hover:bg-void"
          >
            <Play size={14} weight="fill" aria-hidden />
          </button>
        </div>
        <button
          aria-label={`Download ${item.title}`}
          title="Download…"
          onClick={(e) => {
            e.stopPropagation();
            openSheet(item);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              openSheet(item);
            }
          }}
          className="absolute bottom-1 right-1 flex translate-y-1 items-center gap-1 rounded-full bg-ice px-2.5 py-1 text-12 font-semibold text-void opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100"
        >
          <DownloadSimple size={13} weight="bold" aria-hidden />
          Download
        </button>
        {inLibrary && (
          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-ice px-2 py-0.5 text-11 font-semibold text-void">
            <CheckCircle size={11} weight="bold" aria-hidden />
            in library
          </span>
        )}
      </div>
      <div className="p-2.5">
        <div className="flex items-start justify-between gap-1.5">
          <h3 className="line-clamp-2 min-h-[2.5em] flex-1 text-13 leading-snug text-ink">
            {item.title}
          </h3>
          <div className="shrink-0 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
            <AddToPlaylistMenu target={addToTarget} />
          </div>
        </div>
        <p className="mt-1 flex items-baseline justify-between gap-2 text-12 text-mute">
          <span className="truncate">{item.channel ?? "—"}</span>
          {views && <span className="shrink-0 font-mono text-mute">{views}</span>}
        </p>
      </div>
    </div>
  );
});
