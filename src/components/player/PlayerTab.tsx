import { useUIStore } from "../../stores/ui";
import { TrackList } from "./TrackList";
import { PlaylistsPane } from "./PlaylistsPane";
import { NowPlayingPane } from "./NowPlayingPane";
import { LyricsFullscreen } from "./LyricsFullscreen";
import { ContextHeader } from "./ContextHeader";

/** §4.8 — three-pane Player surface: sidebar | context hero + list | now playing. */
export function PlayerTab() {
  const nowPlayingOpen = useUIStore((s) => s.nowPlayingOpen);
  return (
    <div className="relative flex h-full min-h-0 w-full">
      <PlaylistsPane />
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <ContextHeader />
        <TrackList />
      </div>
      {nowPlayingOpen && <NowPlayingPane />}
      <LyricsFullscreen nowPlayingOpen={nowPlayingOpen} />
    </div>
  );
}
