import { memo, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { LibraryEntry } from "../../types/library";
import { usePlayerStore } from "../../stores/player";
import { stripMediaExt } from "../../lib/format";

function thumbSrc(e: LibraryEntry): string | null {
  if (!e.thumbUrl) return null;
  return e.thumbUrl.startsWith("http") ? e.thumbUrl : convertFileSrc(e.thumbUrl);
}

const UpNextRow = memo(function UpNextRow({
  entry,
  index,
  onPlay,
}: {
  entry: LibraryEntry;
  index: number;
  onPlay: (i: number) => void;
}) {
  const src = useMemo(() => thumbSrc(entry), [entry]);
  return (
    <li className="pb-1">
      <button
        onClick={() => onPlay(index)}
        className="flex w-full items-center gap-3 rounded-card px-2 py-1.5 text-left transition-colors duration-150 hover:bg-raise active:scale-[0.99]"
      >
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-card border border-line bg-raise">
          {src ? (
            <img
              src={src}
              alt=""
              width={80}
              height={80}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="truncate text-13 text-ink">{entry.title}</p>
          <p className="truncate text-12 text-mute">
            {entry.channel ? stripMediaExt(entry.channel) : "—"}
          </p>
        </div>
      </button>
    </li>
  );
});

/**
 * "Up Next" — upcoming tracks in the current play order (respects shuffle),
 * shown in the Now Playing sidebar while the lyrics run fullscreen. Each row
 * jumps & plays that track.
 */
export function UpNext() {
  const queue = usePlayerStore((s) => s.queue);
  const order = usePlayerStore((s) => s.order);
  const pos = usePlayerStore((s) => s.pos);
  const repeat = usePlayerStore((s) => s.repeat);
  const jumpTo = usePlayerStore((s) => s.jumpTo);

  const upcoming = useMemo<{ i: number; e: LibraryEntry }[]>(() => {
    const list: { i: number; e: LibraryEntry }[] = [];
    if (pos >= 0 && pos < order.length) {
      if (repeat === "one") {
        const e = queue[order[pos]];
        if (e) list.push({ i: pos, e });
      } else {
        for (let i = pos + 1; i < order.length; i++) {
          const e = queue[order[i]];
          if (e) list.push({ i, e });
        }
        if (repeat === "all") {
          for (let i = 0; i < pos; i++) {
            const e = queue[order[i]];
            if (e) list.push({ i, e });
          }
        }
      }
    }
    return list;
  }, [queue, order, pos, repeat]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: upcoming.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 6,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 px-1 pb-2 font-mono text-11 uppercase tracking-wide text-dim">
        Up Next · {upcoming.length}
      </p>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {upcoming.length === 0 ? (
          <p className="px-1 font-mono text-12 text-dim">{"> queue ended_"}</p>
        ) : (
          <ul className="m-0 list-none p-0" style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const { i, e } = upcoming[vi.index];
              return (
                <li
                  key={`${e.id}-${i}`}
                  data-index={vi.index}
                  ref={rowVirtualizer.measureElement}
                  className="list-none"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <UpNextRow entry={e} index={i} onPlay={jumpTo} />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
