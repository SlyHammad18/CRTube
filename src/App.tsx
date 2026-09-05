import { lazy, Suspense, useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useUIStore } from "./stores/ui";
import { useToolsStore } from "./stores/tools";
import { useQueueStore } from "./stores/queue";
import { useLibraryStore } from "./stores/library";
import { useSettingsStore } from "./stores/settings";
import { usePlayerStore } from "./stores/player";
import { Titlebar } from "./components/titlebar/Titlebar";
import { Rail } from "./components/rail/Rail";
import { Scanlines } from "./components/common/Scanlines";
import { Toasts } from "./components/common/Toasts";
import { ConfirmModal } from "./components/common/ConfirmModal";
import { RenameTrackModal } from "./components/player/RenameTrackModal";
import { FirstRunOverlay } from "./components/setup/FirstRunOverlay";
import { FormatSheet } from "./components/sheet/FormatSheet";
import { LyricsDock } from "./components/player/LyricsDock";
import { PlayerBar } from "./components/player-bar/PlayerBar";
import { PlaylistNameDialog } from "./components/player/PlaylistNameDialog";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { MediaHost } from "./components/player-bar/MediaHost";
import { VideoFullscreen } from "./components/player/VideoFullscreen";
import { PlaceholderView } from "./components/common/PlaceholderView";

// Lazy-load tab views so the initial bundle only carries the player shell.
const HomeSearch = lazy(() =>
  import("./components/search/HomeSearch").then((m) => ({ default: m.HomeSearch })),
);
const DownloadsView = lazy(() =>
  import("./components/downloads/DownloadsView").then((m) => ({
    default: m.DownloadsView,
  })),
);
const LibraryView = lazy(() =>
  import("./components/library/LibraryView").then((m) => ({
    default: m.LibraryView,
  })),
);
const SettingsView = lazy(() =>
  import("./components/settings/SettingsView").then((m) => ({
    default: m.SettingsView,
  })),
);
const PlayerTab = lazy(() =>
  import("./components/player/PlayerTab").then((m) => ({ default: m.PlayerTab })),
);

export default function App() {
  const view = useUIStore((s) => s.view);
  const reduce = useReducedMotion();

  useGlobalShortcuts();

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
      <div className="flex h-full flex-col overflow-hidden bg-void">
        <Titlebar />
        <div className="flex min-h-0 flex-1">
          <Rail />
          <div className="relative flex min-w-0 flex-1 flex-col">
            <main className="relative min-h-0 flex-1 overflow-hidden">
              <AnimatePresence mode="sync">
              <motion.div
                key={view}
                className={`absolute inset-0 flex flex-col ${
                  view === "player"
                    ? "overflow-hidden p-0" // §4.8 panes are edge-to-edge
                    : "overflow-y-auto px-8 pt-8"
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
                  <Suspense fallback={null}>
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
                  </Suspense>
                </motion.div>
              </AnimatePresence>
            </main>
            {/* Global player bar — visible in every view once the queue is non-empty */}
            <LyricsDock />
            <PlayerBar />
          </div>
        </div>
      </div>
      {/* Owns the single media element; never unmounts while the app runs */}
      <MediaHost />
      <FirstRunOverlay />
      <FormatSheet />
      <Scanlines />
      <Toasts />
      <ConfirmModal />
      <RenameTrackModal />
      <PlaylistNameDialog />
      <VideoFullscreen />
    </>
  );
}
