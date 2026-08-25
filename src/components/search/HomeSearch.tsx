import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useSearchStore } from "../../stores/search";
import { useToolsStore } from "../../stores/tools";
import { ResultCard } from "./ResultCard";
import { ResultSkeletonGrid } from "./ResultSkeleton";

function HeroWordmark({ size }: { size: "lg" | "sm" }) {
  const reduce = useReducedMotion();
  const cls =
    size === "lg"
      ? "text-[64px]"
      : "text-24";
  const idle = size === "lg";

  const burn = !idle || reduce ? { opacity: 0.08 } : { opacity: [0.08, 0.72, 0.08] };
  const burnAlt = !idle || reduce ? { opacity: 0.06 } : { opacity: [0.06, 0.65, 0.06] };
  const loop = { duration: 4.5, repeat: Infinity, ease: "easeInOut" as const };

  return (
    <motion.div
      className="relative select-none"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0.01 : 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <motion.span
        aria-hidden
        className={`absolute inset-0 font-display font-bold tracking-tight text-ice ${cls}`}
        style={{ x: 2.2 }}
        animate={burn}
        transition={loop}
      >
        CRTUBE
      </motion.span>
      <motion.span
        aria-hidden
        className={`absolute inset-0 font-display font-bold tracking-tight text-[#38e0c8] ${cls}`}
        style={{ x: -2.2 }}
        animate={burnAlt}
        transition={loop}
      >
        CRTUBE
      </motion.span>
      <span className={`relative font-display font-bold tracking-tight text-ink ${cls}`}>
        CRTUBE
      </span>
    </motion.div>
  );
}

function HeroStatus() {
  const state = useToolsStore((s) => s.state);
  const ytdlp = useToolsStore((s) => s.ytdlpVersion);
  const ffmpeg = useToolsStore((s) => s.ffmpegVersion);
  const reduce = useReducedMotion();

  const dot =
    state === "ready"
      ? "bg-ice"
      : state === "error"
        ? "bg-signal"
        : state === "updating"
          ? "bg-amber"
          : "bg-dim";
  const text =
    state === "ready"
      ? `console ready: yt-dlp ${ytdlp}, ffmpeg ${ffmpeg}`
      : state === "error"
        ? "engine error, check settings"
        : state === "updating"
          ? "updating yt-dlp"
          : "calibrating engines";

  return (
    <motion.p
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduce ? 0.01 : 0.35,
        delay: reduce ? 0 : 0.06,
        ease: [0.16, 1, 0.3, 1],
      }}
      className="mt-2 flex items-center gap-2 font-mono text-12 text-mute"
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
      {text}
    </motion.p>
  );
}

function HeroDock() {
  const [input, setInput] = useState("");
  const submitRaw = useSearchStore((s) => s.submitRaw);
  const status = useSearchStore((s) => s.status);
  const reduce = useReducedMotion();
  const busy = status === "searching" || status === "loadingMore";

  const onSubmit = () => {
    if (!input.trim() || busy) return;
    void submitRaw(input);
  };

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: reduce ? 0.01 : 0.35,
        delay: reduce ? 0 : 0.12,
        ease: [0.16, 1, 0.3, 1],
      }}
      className="mt-7 flex w-full items-center gap-3 rounded-card border border-line bg-panel px-5 shadow-panel focus-within:border-ice"
    >
      <MagnifyingGlass size={20} weight="light" className="text-dim" aria-hidden />
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        placeholder="Paste a link or search…"
        spellCheck={false}
        aria-label="Search or paste a YouTube link"
        className="h-14 w-full bg-transparent text-18 text-ink outline-none placeholder:text-dim"
      />
    </motion.div>
  );
}

function RecentChips() {
  const recent = useSearchStore((s) => s.recent);
  const items = useSearchStore((s) => s.items);
  const status = useSearchStore((s) => s.status);
  const submitRaw = useSearchStore((s) => s.submitRaw);

  if (!recent.length || items.length || status === "searching") return null;
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-1.5">
      {recent.map((r) => (
        <button
          key={r}
          onClick={() => void submitRaw(r)}
          className="rounded-full border border-line px-2.5 py-1 text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
        >
          {r}
        </button>
      ))}
    </div>
  );
}

function ResultsGrid() {
  const items = useSearchStore((s) => s.items);
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
      {items.map((item, i) => (
        <ResultCard key={item.videoId} item={item} index={i % 20} />
      ))}
    </div>
  );
}

function InfiniteScrollSentinel() {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMore = useSearchStore((s) => s.loadMore);
  const hasMore = useSearchStore((s) => s.hasMore);
  const status = useSearchStore((s) => s.status);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || status === "loadingMore" || status === "searching") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, status, loadMore]);

  if (!hasMore) return null;
  return (
    <div ref={sentinelRef} className="grid place-items-center py-6">
      {status === "loadingMore" ? (
        <span className="font-mono text-12 text-mute">loading more…</span>
      ) : (
        <span className="font-mono text-12 text-mute">scroll for more ↓</span>
      )}
    </div>
  );
}

export function HomeSearch() {
  const query = useSearchStore((s) => s.query);
  const status = useSearchStore((s) => s.status);
  const error = useSearchStore((s) => s.error);
  const items = useSearchStore((s) => s.items);
  const search = useSearchStore((s) => s.search);

  const idle = !query && !items.length && status === "idle" && !error;
  const searching = status === "searching";

  return (
    <div
      className={`mx-auto flex w-full max-w-[960px] flex-col ${
        idle ? "flex-1 items-center justify-center pb-[6vh]" : ""
      }`}
    >
      {idle ? (
        <div className="flex w-full flex-col items-center">
          <HeroWordmark size="lg" />
          <HeroStatus />
          <div className="mt-7 w-full">
            <HeroDock />
          </div>
          <RecentChips />
        </div>
      ) : (
        <>
          <div className="flex flex-col items-center pt-[4vh]">
            <HeroWordmark size="sm" />
            <HeroStatus />
            <div className="mt-5 w-full">
              <HeroDock />
            </div>
            <RecentChips />
          </div>

          {searching && (
            <div className="mt-10">
              <ResultSkeletonGrid />
            </div>
          )}

          {items.length > 0 && (
            <div className="mt-10">
              <ResultsGrid />
              <InfiniteScrollSentinel />
            </div>
          )}

          {status === "error" && (
            <div className="mt-10 flex flex-col items-center gap-3">
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
          )}

          {query && status === "done" && !items.length && !error && (
            <p className="mt-10 text-center font-mono text-15 text-mute">
              {"> no results for “"}
              {query}
              {"”_"}
            </p>
          )}
        </>
      )}
    </div>
  );
}
