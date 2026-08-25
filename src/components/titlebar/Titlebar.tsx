import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Broadcast, Copy, Minus, Square, X } from "@phosphor-icons/react";
import type { IconProps } from "@phosphor-icons/react";
import type { ComponentType } from "react";
import { useToolsStore } from "../../stores/tools";

type ControlIcon = ComponentType<IconProps>;

const DOT_CLASS: Record<string, string> = {
  idle: "bg-dim",
  updating: "bg-amber",
  ready: "bg-ice",
  error: "bg-signal",
};

const STATE_LABEL: Record<string, string> = {
  idle: "checking",
  updating: "updating",
  ready: "ready",
  error: "error",
};

function useMaximized() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const win = getCurrentWindow();
    let mounted = true;
    const unlisten = win.onResized(async () => {
      setMaximized(await win.isMaximized());
    });
    win.isMaximized().then((v) => {
      if (mounted) setMaximized(v);
    });
    return () => {
      mounted = false;
      unlisten.then((f) => f());
    };
  }, []);
  return maximized;
}

function useTelemetryVisibility(state: string) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (state === "updating" || state === "error") {
      setVisible(true);
      return;
    }
    const grace = state === "ready" ? 3000 : 0;
    const t = window.setTimeout(() => setVisible(false), grace);
    return () => window.clearTimeout(t);
  }, [state]);
  return visible;
}

export function Titlebar() {
  const maximized = useMaximized();
  const win = getCurrentWindow();
  const toolsState = useToolsStore((s) => s.state);
  const ytdlpVersion = useToolsStore((s) => s.ytdlpVersion);
  const telemetryVisible = useTelemetryVisibility(toolsState);
  const reduce = useReducedMotion();

  const controls: {
    label: string;
    icon: ControlIcon;
    danger?: boolean;
    onClick: () => void;
  }[] = [
    { label: "Minimize", icon: Minus, onClick: () => void win.minimize() },
    {
      label: maximized ? "Restore" : "Maximize",
      icon: maximized ? Copy : Square,
      onClick: () => void win.toggleMaximize(),
    },
    {
      label: "Close",
      icon: X,
      danger: true,
      onClick: () => void win.close(),
    },
  ];

  return (
    <header
      data-tauri-drag-region
      className="relative flex h-10 shrink-0 select-none items-stretch border-b border-line bg-panel"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pl-4">
        <Broadcast size={18} weight="light" className="text-ice" aria-hidden />
        <span className="font-display text-15 font-bold tracking-tight">
          CRTUBE
        </span>
      </div>
      <AnimatePresence>
        {telemetryVisible && (
          <motion.div
            key="telemetry"
            className="pointer-events-none absolute inset-x-0 top-0 flex h-full items-center justify-center"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.01 : 0.18, ease: "easeOut" }}
          >
            <span
              data-tauri-drag-region
              className="pointer-events-auto flex items-center gap-2 font-mono text-12 text-dim"
            >
              <span
                className={`inline-block h-[7px] w-[7px] rounded-full ${DOT_CLASS[toolsState]}`}
              />
              ytdlp {ytdlpVersion ?? "——"} · {STATE_LABEL[toolsState]}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="ml-auto flex items-stretch">
        {controls.map(({ label, icon: ControlIcon, danger, onClick }) => (
          <button
            key={label}
            aria-label={label}
            title={label}
            onClick={onClick}
            className={`grid w-11 place-items-center transition-colors duration-150 active:scale-[0.98] ${
              danger
                ? "text-mute hover:bg-signal hover:text-void"
                : "text-mute hover:bg-raise hover:text-ink"
            }`}
          >
            <ControlIcon size={16} weight="light" aria-hidden />
          </button>
        ))}
      </div>
    </header>
  );
}
