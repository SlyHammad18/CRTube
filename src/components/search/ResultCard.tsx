import { memo } from "react";
import { CheckCircle, DownloadSimple } from "@phosphor-icons/react";
import { useLibraryStore } from "../../stores/library";
import { useSheetStore } from "../../stores/sheet";
import { fmtCount, fmtDuration } from "../../lib/format";
import { useReveal } from "../../hooks/useReveal";
import type { SearchItem } from "../../types/search";

interface ResultCardProps {
  item: SearchItem;
  index: number;
}

export const ResultCard = memo(function ResultCard({ item, index }: ResultCardProps) {
  const inLibrary = useLibraryStore((s) => s.ids.has(item.videoId));
  const openSheet = useSheetStore((s) => s.openForCard);
  const { ref, visible } = useReveal<HTMLDivElement>();

  const duration = fmtDuration(item.durationS);
  const views = fmtCount(item.views);

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label={`Open download options for ${item.title}`}
      onClick={() => openSheet(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openSheet(item);
        }
      }}
      className={`group relative cursor-pointer overflow-hidden rounded-card border border-line bg-panel shadow-panel transition-[background-color,scale] duration-150 hover:bg-raise active:scale-[0.98] ${
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
            className="h-full w-full object-cover opacity-90 transition-opacity duration-150 group-hover:opacity-100"
          />
        )}
        {duration && (
          <span className="absolute bottom-1 right-1 rounded-full bg-void/80 px-1.5 py-0.5 font-mono text-11 text-ink transition-opacity duration-150 group-hover:opacity-0">
            {duration}
          </span>
        )}
        <span className="absolute bottom-1 right-1 flex translate-y-1 items-center gap-1 rounded-full bg-ice px-2.5 py-1 text-12 font-semibold text-void opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100">
          <DownloadSimple size={13} weight="bold" aria-hidden />
          Download
        </span>
        {inLibrary && (
          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-ice px-2 py-0.5 text-11 font-semibold text-void">
            <CheckCircle size={11} weight="bold" aria-hidden />
            in library
          </span>
        )}
      </div>
      <div className="p-2.5">
        <h3 className="line-clamp-2 min-h-[2.5em] text-13 leading-snug text-ink">
          {item.title}
        </h3>
        <p className="mt-1 flex items-baseline justify-between gap-2 text-12 text-mute">
          <span className="truncate">{item.channel ?? "—"}</span>
          {views && <span className="shrink-0 font-mono text-mute">{views}</span>}
        </p>
      </div>
    </div>
  );
});
