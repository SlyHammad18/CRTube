import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import {
  DownloadSimple,
  GearSix,
  MagnifyingGlass,
  MusicNote,
  SquaresFour,
} from "@phosphor-icons/react";
import type { View } from "../../stores/ui";
import { useUIStore } from "../../stores/ui";
import { useQueueStore } from "../../stores/queue";

const MAIN_ITEMS: { id: View; label: string; icon: typeof MagnifyingGlass }[] = [
  { id: "player", label: "Player", icon: MusicNote },
  { id: "search", label: "Search", icon: MagnifyingGlass },
  { id: "downloads", label: "Downloads", icon: DownloadSimple },
  { id: "library", label: "Library", icon: SquaresFour },
];

export function Rail() {
  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const activeCount = useQueueStore((s) => s.activeCount);

  return (
    <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel py-3">
      {MAIN_ITEMS.map(({ id, label, icon: Icon }) => (
        <RailButton
          key={id}
          label={label}
          active={view === id}
          onSelect={() => setView(id)}
          badge={id === "downloads" && activeCount > 0 ? activeCount : undefined}
        >
          <Icon size={21} weight="light" aria-hidden />
        </RailButton>
      ))}
      <RailButton
        label="Settings"
        active={view === "settings"}
        onSelect={() => setView("settings")}
      >
        <GearSix size={21} weight="light" aria-hidden />
      </RailButton>
    </nav>
  );
}

function RailButton({
  label,
  active,
  onSelect,
  badge,
  children,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
  badge?: number;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onSelect}
      className={`relative grid h-10 w-10 place-items-center rounded-card transition-colors duration-150 active:scale-[0.98] ${
        active ? "text-ice" : "text-dim hover:bg-raise hover:text-ink"
      }`}
    >
      {active && (
        <motion.span
          layoutId="rail-notch"
          transition={
            reduce
              ? { duration: 0 }
              : { type: "spring", stiffness: 300, damping: 22 }
          }
          className="absolute left-[-12px] top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-ice"
        />
      )}
      {children}
      {badge !== undefined && (
        <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-ice px-1 font-mono text-[10px] leading-none text-void">
          {badge}
        </span>
      )}
    </button>
  );
}
