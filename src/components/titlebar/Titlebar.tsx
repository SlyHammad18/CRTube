import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "@phosphor-icons/react";
import type { IconProps } from "@phosphor-icons/react";
import type { ComponentType } from "react";
import { useToolsStore } from "../../stores/tools";
import { useUIStore } from "../../stores/ui";

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

/** yt-dlp engine status, top-right of the titlebar (§4.1). "checking for
 *  updates" → "updating yt-dlp" (only while a download actually runs) → the
 *  busy label lingers ~2s after completion and the chip hides entirely — no
 *  permanent version readout. Errors stay visible (they need attention).
 *  Click opens Settings (the manual update lives there). */
function ToolStatusChip() {
  const state = useToolsStore((s) => s.state);
  const error = useToolsStore((s) => s.error);
  const setView = useUIStore((s) => s.setView);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (state === "checking") {
      setLabel("checking for updates");
      return;
    }
    if (state === "updating") {
      setLabel("updating yt-dlp");
      return;
    }
    if (state === "error") {
      setLabel("update failed");
      return;
    }
    // ready: keep the last busy label for a beat, then hide the chip.
    setLabel((cur) =>
      cur === "checking for updates" || cur === "updating yt-dlp" ? cur : null,
    );
    const t = window.setTimeout(() => setLabel(null), 2000);
    return () => window.clearTimeout(t);
  }, [state]);

  if (!label) return null;

  const look =
    label === "checking for updates"
      ? { dot: "bg-ice animate-pulse", cls: "text-mute" }
      : label === "updating yt-dlp"
        ? { dot: "bg-amber", cls: "text-mute" }
        : { dot: "bg-signal", cls: "text-mute" };

  return (
    <button
      onClick={() => setView("settings")}
      title={state === "error" ? error ?? "Tool update failed — open settings" : "Tool status — open settings"}
      className={`flex items-center gap-1.5 font-mono text-11 transition-colors duration-150 hover:text-ink ${look.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${look.dot}`} aria-hidden />
      {label}
    </button>
  );
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
      className="relative flex h-10 shrink-0 select-none items-stretch border-b border-line bg-panel"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 pl-4">
        <span className="font-display text-15 font-bold tracking-tight">
          CRTUBE
        </span>
      </div>
      <div data-tauri-drag-region className="ml-auto flex items-center pr-3">
        <ToolStatusChip />
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
