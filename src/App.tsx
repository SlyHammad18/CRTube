import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useUIStore } from "./stores/ui";
import { useToolsStore } from "./stores/tools";
import { useQueueStore } from "./stores/queue";
import { useLibraryStore } from "./stores/library";
import { useSettingsStore } from "./stores/settings";
import { usePlayerStore } from "./stores/player";
import { Titlebar } from "./components/titlebar/Titlebar";
import { Rail } from "./components/rail/Rail";
import { BootOverlay } from "./components/boot/BootOverlay";
import { Scanlines } from "./components/common/Scanlines";
import { Toasts } from "./components/common/Toasts";
import { ConfirmModal } from "./components/common/ConfirmModal";
import { FirstRunOverlay } from "./components/setup/FirstRunOverlay";
import { FormatSheet } from "./components/sheet/FormatSheet";
import { HomeSearch } from "./components/search/HomeSearch";
import { DownloadsView } from "./components/downloads/DownloadsView";
import { LibraryView } from "./components/library/LibraryView";
import { SettingsView } from "./components/settings/SettingsView";
import { PlayerTab } from "./components/player/PlayerTab";
import { PlayerBar } from "./components/player-bar/PlayerBar";
import { MediaHost } from "./components/player-bar/MediaHost";
import { PlaceholderView } from "./components/common/PlaceholderView";

export default function App() {
  const view = useUIStore((s) => s.view);
  const booted = useUIStore((s) => s.booted);
  const setBooted = useUIStore((s) => s.setBooted);
  const reduce = useReducedMotion();

  useEffect(() => {
    void useToolsStore.getState().init();
    useQueueStore.getState().attach();
    void useLibraryStore.getState().refresh();
    void useSettingsStore.getState().load().then(() => {
      usePlayerStore.getState().hydrateFromSettings();
    });
  }, []);

  return (
    <>
      <motion.div
        className="flex h-full flex-col overflow-hidden bg-void"
        initial={false}
        animate={
          booted
            ? { opacity: 1, scale: 1 }
            : reduce
              ? { opacity: 0 }
              : { opacity: 0, scale: 0.98 }
        }
        transition={{ duration: reduce ? 0.01 : 0.24, ease: [0.16, 1, 0.3, 1] }}
      >
        <Titlebar />
        <div className="flex min-h-0 flex-1">
          <Rail />
          <div className="flex min-w-0 flex-1 flex-col">
            <main className="relative min-h-0 flex-1 overflow-hidden">
              <AnimatePresence mode="wait">
              <motion.div
                key={view}
                className={`absolute inset-0 flex flex-col ${
                  view === "player"
                    ? "overflow-hidden p-0" // §4.8 panes are edge-to-edge
                    : "overflow-y-auto p-8"
                }`}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
                  exit={{
                    opacity: 0,
                    transition: {
                      duration: reduce ? 0.01 : 0.12,
                      ease: "easeIn",
                    },
                  }}
                  transition={{
                    duration: reduce ? 0.01 : 0.24,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                >
                  {view === "player" ? (
                    <PlayerTab />
                  ) : view === "search" ? (
                    <HomeSearch />
                  ) : view === "downloads" ? (
                    <DownloadsView />
                  ) : view === "library" ? (
                    <LibraryView />
                  ) : view === "settings" ? (
                    <SettingsView />
                  ) : (
                    <PlaceholderView view={view} />
                  )}
                </motion.div>
              </AnimatePresence>
            </main>
            {/* Global player bar — visible in every view once the queue is non-empty */}
            <PlayerBar />
          </div>
        </div>
      </motion.div>
      {/* Owns the single media element; never unmounts while the app runs */}
      <MediaHost />
      <BootOverlay onDone={() => setBooted(true)} />
      <FirstRunOverlay />
      <FormatSheet />
      <Scanlines />
      <Toasts />
      <ConfirmModal />
    </>
  );
}
