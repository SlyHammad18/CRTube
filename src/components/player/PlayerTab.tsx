import { useUIStore } from "../../stores/ui";
import { TrackList } from "./TrackList";
import { PlaylistsPane } from "./PlaylistsPane";
import { NowPlayingPane } from "./NowPlayingPane";
import { LyricsFullscreen } from "./LyricsFullscreen";

/** §4.8 — three-pane Player surface: sidebar | track list | now playing. */
export function PlayerTab() {
  const nowPlayingOpen = useUIStore((s) => s.nowPlayingOpen);
  return (
    <div className="relative flex h-full min-h-0 w-full">
      <PlaylistsPane />
      <TrackList />
      {nowPlayingOpen && <NowPlayingPane />}
      <LyricsFullscreen nowPlayingOpen={nowPlayingOpen} />
    </div>
  );
}
