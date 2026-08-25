import { useEffect, useRef, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { useSearchStore } from "../../stores/search";
import { ResultCard } from "./ResultCard";
import { ResultSkeletonGrid } from "./ResultSkeleton";

function HeroDock() {
  const [input, setInput] = useState("");
  const submitRaw = useSearchStore((s) => s.submitRaw);
  const status = useSearchStore((s) => s.status);
  const busy = status === "searching" || status === "loadingMore";

  const onSubmit = () => {
    if (!input.trim() || busy) return;
    void submitRaw(input);
  };

  return (
    <div className="flex items-center gap-3 rounded-card border border-line bg-panel px-5 shadow-panel focus-within:border-ice">
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
    </div>
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
        <span className="font-mono text-12 text-dim">loading more…</span>
      ) : (
        <span className="font-mono text-12 text-dim">scroll for more ↓</span>
      )}
    </div>
  );
}

export function HomeSearch() {
  const query = useSearchStore((s) => s.query);
  const status = useSearchStore((s) => s.status);
  const error = useSearchStore((s) => s.error);
  const items = useSearchStore((s) => s.items);

  const searching = status === "searching";
  const showInitial =
    !query && !items.length && status === "idle" && !error;

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col">
      <div className="pt-[9vh]">
        <HeroDock />
        <RecentChips />
      </div>

      {showInitial && (
        <p className="mt-16 text-center font-mono text-15 text-dim">
          {"> awaiting input_"}
        </p>
      )}

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
        <p className="mt-10 break-all text-center font-mono text-13 text-signal">
          {"> search failed"} — {error}
        </p>
      )}

      {query && status === "done" && !items.length && !error && (
        <p className="mt-10 text-center font-mono text-15 text-dim">
          {"> no results for “"}
          {query}
          {"”_"}
        </p>
      )}
    </div>
  );
}
