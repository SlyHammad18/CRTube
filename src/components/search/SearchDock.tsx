import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { useSearchStore } from "../../stores/search";

/** CRT burn-in wordmark (home hero). */
export function HeroWordmark({ size }: { size: "lg" | "sm" }) {
  const reduce = useReducedMotion();
  const cls = size === "lg" ? "text-[64px]" : "text-24";
  const idle = size === "lg";

  return (
    <div className="relative select-none opacity-100">
      <span
        aria-hidden
        className={`absolute inset-0 font-display font-bold tracking-tight text-ice ${cls} ${
          idle && !reduce ? "animate-crt-burn" : ""
        }`}
        style={{ transform: "translateX(2.2px)" }}
      >
        CRTUBE
      </span>
      <span
        aria-hidden
        className={`absolute inset-0 font-display font-bold tracking-tight text-[#38e0c8] ${cls} ${
          idle && !reduce ? "animate-crt-burn-alt" : ""
        }`}
        style={{ transform: "translateX(-2.2px)" }}
      >
        CRTUBE
      </span>
      <span className={`relative font-display font-bold tracking-tight text-ink ${cls}`}>
        CRTUBE
      </span>
    </div>
  );
}

/**
 * The search dock: "Paste a link or search…" — Enter submits. Pasted URLs
 * route to the format sheet, plain text runs a YouTube search. Used on Home
 * (hero size) and inside the player tab's search pane (compact).
 */
export function SearchDock({
  size = "hero",
  autoFocus = false,
  inputRef,
  onSubmitOverride,
  onInputChange,
  onEscape,
  placeholder = "Paste a link or search…",
}: {
  size?: "hero" | "compact";
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
  /** Replace the default submitRaw routing (e.g. the player-tab pane). */
  onSubmitOverride?: (raw: string) => void;
  /** Live input mirror (the player-tab pane filters library matches on it). */
  onInputChange?: (value: string) => void;
  /** Escape inside the input (the player-tab pane closes on it). */
  onEscape?: () => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState("");
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const submitRaw = useSearchStore((s) => s.submitRaw);
  const status = useSearchStore((s) => s.status);
  const reduce = useReducedMotion();
  const busy = status === "searching" || status === "loadingMore";

  const onSubmit = () => {
    const raw = input.trim();
    if (!raw || busy) return;
    if (onSubmitOverride) onSubmitOverride(raw);
    else void submitRaw(raw);
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
      className={`flex w-full items-center gap-3 rounded-card border border-line bg-panel px-5 shadow-panel focus-within:border-ice ${
        size === "hero" ? "" : "h-11 px-3.5"
      }`}
    >
      <MagnifyingGlass size={size === "hero" ? 20 : 16} weight="light" className="text-dim" aria-hidden />
      <input
        ref={ref}
        autoFocus={autoFocus}
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          onInputChange?.(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
          if (e.key === "Escape") onEscape?.();
        }}
        onClick={() => ref.current?.select()}
        placeholder={placeholder}
        spellCheck={false}
        aria-label="Search or paste a YouTube link"
        className={`w-full bg-transparent text-ink outline-none placeholder:text-dim ${
          size === "hero" ? "h-14 text-18" : "h-9 text-13"
        }`}
      />
      {/* Exactly one ✕ lives in this bar: it clears the text when there is
          text, and closes the pane (onEscape) when there isn't. Parents used
          to render their own ✕ next to the dock, which read as a duplicate. */}
      {(input.length > 0 || onEscape) && (
        <button
          aria-label={input ? "Clear search" : "Close search"}
          title={input ? "Clear search" : "Close search (Esc)"}
          onClick={() => {
            if (input) {
              setInput("");
              onInputChange?.("");
              ref.current?.focus();
            } else {
              onEscape?.();
            }
          }}
          className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-dim transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
        >
          <X size={10} weight="bold" aria-hidden />
        </button>
      )}
    </motion.div>
  );
}

/** Recent searches, shown while idle (nothing playing in the results area). */
export function RecentChips({ center = true }: { center?: boolean }) {
  const recent = useSearchStore((s) => s.recent);
  const items = useSearchStore((s) => s.items);
  const status = useSearchStore((s) => s.status);
  const submitRaw = useSearchStore((s) => s.submitRaw);

  if (!recent.length || items.length || status === "searching") return null;
  return (
    <div className={`mt-3 flex flex-wrap gap-1.5 ${center ? "justify-center" : ""}`}>
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
