import { useState } from "react";
import { CaretDown, ArrowUp, ArrowDown } from "@phosphor-icons/react";
import type { SortKey } from "./TrackList";

const ALL_KEYS: { key: SortKey; label: string }[] = [
  { key: "manual", label: "custom" },
  { key: "title", label: "title" },
  { key: "duration", label: "duration" },
  { key: "added", label: "added" },
];

/** Compact sort popover mirroring the SpeedMenu vocabulary. */
export function SortMenu({
  sort,
  setSort,
  isPlaylist,
}: {
  sort: { key: SortKey; dir: 1 | -1 };
  setSort: (s: { key: SortKey; dir: 1 | -1 }) => void;
  isPlaylist: boolean;
}) {
  const [open, setOpen] = useState(false);
  const keys = isPlaylist ? ALL_KEYS : ALL_KEYS.filter((k) => k.key !== "manual");
  const active = ALL_KEYS.find((k) => k.key === sort.key) ?? keys[0];

  return (
    <div className="relative shrink-0">
      <button
        aria-label="Sort tracks"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-1.5 rounded-full border border-line px-3 font-mono text-11 uppercase tracking-wide text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
      >
        <span className="text-dim">sort</span>
        {active.label}
        <span className="text-ice">{sort.dir === 1 ? "↑" : "↓"}</span>
        <CaretDown size={10} weight="bold" className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <>
          <button
            aria-label="Close sort menu"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            aria-label="Sort tracks"
            className="absolute right-0 z-50 flex w-40 flex-col gap-0.5 rounded-card border border-line bg-panel p-1 shadow-panel top-full mt-2"
          >
            {keys.map(({ key, label }) => (
              <button
                key={key}
                role="menuitemradio"
                aria-checked={sort.key === key}
                onClick={() => {
                  setSort({ key, dir: key === "added" || key === "manual" ? -1 : 1 });
                  setOpen(false);
                }}
                className={`flex items-center justify-between rounded-card px-3 py-1 text-left font-mono text-12 transition-colors duration-150 ${
                  sort.key === key ? "bg-ice text-void" : "text-mute hover:bg-raise hover:text-ink"
                }`}
              >
                <span className="capitalize">{label}</span>
                {sort.key === key && <span aria-hidden>{sort.dir === 1 ? "↑" : "↓"}</span>}
              </button>
            ))}
            <div className="my-1 h-px bg-line" />
            <div className="flex items-center gap-1 px-1">
              <button
                role="menuitemradio"
                aria-checked={sort.dir === 1}
                onClick={() => setSort({ key: sort.key, dir: 1 })}
                className={`flex flex-1 items-center justify-center gap-1 rounded-card py-1 font-mono text-12 transition-colors duration-150 ${
                  sort.dir === 1 ? "bg-ice text-void" : "text-mute hover:bg-raise hover:text-ink"
                }`}
              >
                <ArrowUp size={11} weight="bold" aria-hidden /> asc
              </button>
              <button
                role="menuitemradio"
                aria-checked={sort.dir === -1}
                onClick={() => setSort({ key: sort.key, dir: -1 })}
                className={`flex flex-1 items-center justify-center gap-1 rounded-card py-1 font-mono text-12 transition-colors duration-150 ${
                  sort.dir === -1 ? "bg-ice text-void" : "text-mute hover:bg-raise hover:text-ink"
                }`}
              >
                <ArrowDown size={11} weight="bold" aria-hidden /> desc
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
