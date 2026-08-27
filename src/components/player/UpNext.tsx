import { convertFileSrc } from "@tauri-apps/api/core";
import type { LibraryEntry } from "../../types/library";
import { usePlayerStore } from "../../stores/player";
import { stripMediaExt } from "../../lib/format";

function thumbSrc(e: LibraryEntry): string | null {
  if (!e.thumbUrl) return null;
  return e.thumbUrl.startsWith("http") ? e.thumbUrl : convertFileSrc(e.thumbUrl);
}

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

  const upcoming: { i: number; e: LibraryEntry }[] = [];
  if (pos >= 0 && pos < order.length) {
    if (repeat === "one") {
      const e = queue[order[pos]];
      if (e) upcoming.push({ i: pos, e });
    } else {
      // Linear tail (after the current track) …
      for (let i = pos + 1; i < order.length; i++) {
        const e = queue[order[i]];
        if (e) upcoming.push({ i, e });
      }
      // … and, for repeat-all, the wrapped head up to (but not incl.) current.
      if (repeat === "all") {
        for (let i = 0; i < pos; i++) {
          const e = queue[order[i]];
          if (e) upcoming.push({ i, e });
        }
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 px-1 pb-2 font-mono text-11 uppercase tracking-wide text-dim">
        Up Next · {upcoming.length}
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {upcoming.length === 0 ? (
          <p className="px-1 font-mono text-12 text-dim">{"> queue ended_"}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {upcoming.map(({ i, e }) => {
              const src = thumbSrc(e);
              return (
                <li key={`${e.id}-${i}`}>
                  <button
                    onClick={() => jumpTo(i)}
                    className="flex w-full items-center gap-3 rounded-card px-2 py-1.5 text-left transition-colors duration-150 hover:bg-raise active:scale-[0.99]"
                  >
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-card border border-line bg-raise">
                      {src ? (
                        <img
                          src={src}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-13 text-ink">{e.title}</p>
                      <p className="truncate text-12 text-mute">
                        {e.channel ? stripMediaExt(e.channel) : "—"}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
