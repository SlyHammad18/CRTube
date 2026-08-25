import { useState } from "react";
import { motion } from "motion/react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { useSearchStore } from "../../stores/search";
import { fmtCount, fmtDuration, fmtBytes } from "../../lib/format";
import type { SearchItem } from "../../types/search";

function ProbePanel() {
  const info = useSearchStore((s) => s.info);
  const status = useSearchStore((s) => s.infoStatus);
  const error = useSearchStore((s) => s.infoError);
  const source = useSearchStore((s) => s.probedFrom);
  const clear = useSearchStore((s) => s.clearInfo);

  if (status === "idle") return null;

  return (
    <div className="mt-6 rounded-card border border-line bg-panel px-4 py-3.5 text-left shadow-panel">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 font-mono text-13">
          <p className="text-ink">{">"} {info ? info.title : `probing ${source}`}</p>
          {status === "done" && info && (
            <p className="mt-1 text-dim">
              {info.channel ?? "unknown"} ·{" "}
              <span className="font-mono">
                {fmtDuration(info.durationS) ?? "live"}
              </span>{" "}
              · {info.formats.length} formats
            </p>
          )}
          {status === "error" && (
            <p className="mt-1 text-signal">{">"} probe failed</p>
          )}
        </div>
        <button
          aria-label="Dismiss"
          onClick={clear}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-card text-dim transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
        >
          <X size={14} weight="light" aria-hidden />
        </button>
      </div>
      {status === "error" && (
        <p className="mt-2 break-all font-mono text-12 text-dim">{error}</p>
      )}
      {status === "done" && info && (
        <div className="mt-2.5 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-1 border-t border-line pt-2.5 font-mono text-12 text-mute">
          {info.formats.map((f, i) => (
            <span key={`${f.height}-${f.ext}-${i}`} className="truncate">
              {f.height ? `${f.height}p` : "audio"}
              {f.fps && f.fps > 30 ? ` ${f.fps}` : ""} · {f.ext}
              {f.filesize ? (
                <span className="text-dim"> · {fmtBytes(f.filesize)}</span>
              ) : null}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultCard({ item }: { item: SearchItem }) {
  const probe = useSearchStore((s) => s.probe);
  const duration = fmtDuration(item.durationS);
  const views = fmtCount(item.views);
  const open = () => probe(`https://www.youtube.com/watch?v=${item.videoId}`);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      role="button"
      tabIndex={0}
      aria-label={`Inspect ${item.title}`}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className="group cursor-pointer overflow-hidden rounded-card border border-line bg-panel transition-[background-color,scale] duration-150 hover:bg-raise active:scale-[0.98]"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-raise">
        {item.thumbUrl && (
          <img
            src={item.thumbUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover opacity-90 transition-opacity duration-150 group-hover:opacity-100"
          />
        )}
        {duration && (
          <span className="absolute bottom-1 right-1 rounded-full bg-void/80 px-1.5 py-0.5 font-mono text-11 text-ink">
            {duration}
          </span>
        )}
      </div>
      <div className="p-2.5">
        <h3 className="line-clamp-2 min-h-[2.5em] text-13 leading-snug text-ink">
          {item.title}
        </h3>
        <p className="mt-1 flex items-baseline justify-between gap-2 text-12 text-mute">
          <span className="truncate">{item.channel ?? "—"}</span>
          {views && <span className="shrink-0 font-mono text-dim">{views}</span>}
        </p>
      </div>
    </motion.article>
  );
}

export function HomeSearch() {
  const [input, setInput] = useState("");
  const submitRaw = useSearchStore((s) => s.submitRaw);
  const loadMore = useSearchStore((s) => s.loadMore);
  const query = useSearchStore((s) => s.query);
  const items = useSearchStore((s) => s.items);
  const status = useSearchStore((s) => s.status);
  const error = useSearchStore((s) => s.error);
  const hasMore = useSearchStore((s) => s.hasMore);
  const recent = useSearchStore((s) => s.recent);

  const busy = status === "searching" || status === "loadingMore";

  const onSubmit = () => {
    if (!input.trim() || busy) return;
    void submitRaw(input);
  };

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col">
      <div className="pt-[9vh]">
        <div className="flex items-center gap-2 rounded-card border border-line bg-panel px-4 shadow-panel focus-within:border-ice">
          <MagnifyingGlass size={18} weight="light" className="text-dim" aria-hidden />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
            placeholder="Paste a link or search…"
            spellCheck={false}
            className="h-12 w-full bg-transparent text-15 text-ink outline-none placeholder:text-dim"
          />
        </div>
        {recent.length > 0 && !items.length && status !== "searching" && (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {recent.map((r) => (
              <button
                key={r}
                onClick={() => {
                  setInput(r);
                  void submitRaw(r);
                }}
                className="rounded-full border border-line px-2.5 py-1 text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
              >
                {r}
              </button>
            ))}
          </div>
        )}
        <ProbePanel />
      </div>

      {items.length > 0 && (
        <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
          {items.map((item) => (
            <ResultCard key={item.videoId} item={item} />
          ))}
        </div>
      )}

      {status === "error" && (
        <p className="mt-10 break-all text-center font-mono text-13 text-signal">
          {"> search failed"} — {error}
        </p>
      )}

      {hasMore && status === "done" && (
        <button
          onClick={() => void loadMore()}
          disabled={busy}
          className="mx-auto mt-6 rounded-card border border-line px-4 py-2 font-mono text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98] disabled:pointer-events-none disabled:text-dim"
        >
          more results ↓
        </button>
      )}

      {query && status === "done" && !items.length && !error && (
        <p className="mt-10 text-center font-mono text-15 text-dim">
          {"> no results for “"}{query}{"”_"}
        </p>
      )}
    </div>
  );
}
