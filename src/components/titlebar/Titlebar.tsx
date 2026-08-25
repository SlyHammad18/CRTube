import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Broadcast, Copy, Minus, Square, X } from "@phosphor-icons/react";
import type { IconProps } from "@phosphor-icons/react";
import type { ComponentType } from "react";

type ControlIcon = ComponentType<IconProps>;

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

export function Titlebar() {
  const maximized = useMaximized();
  const win = getCurrentWindow();

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
      className="flex h-10 shrink-0 select-none items-stretch border-b border-line bg-panel"
    >
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center gap-3 pl-4"
      >
        <span className="flex items-center gap-2" data-tauri-drag-region>
          <Broadcast size={18} weight="light" className="text-ice" aria-hidden />
          <span className="font-display text-15 font-bold tracking-tight">
            CRTUBE
          </span>
        </span>
        <span
          data-tauri-drag-region
          className="flex items-center gap-2 font-mono text-12 text-dim"
        >
          <span className="inline-block h-[7px] w-[7px] rounded-full bg-ice" />
          ytdlp —— · ready
        </span>
      </div>
      <div className="flex items-stretch">
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
