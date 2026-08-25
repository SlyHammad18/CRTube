import { useLibraryStore } from "../../stores/library";
import { ConsolePrompt } from "../common/ConsolePrompt";

/**
 * Player tab shell. The three-pane library/playlist/now-playing surface
 * lands in T14/T15; T13 ships the engine, global bar, and this placeholder.
 */
export function PlayerTab() {
  const count = useLibraryStore((s) => s.entries.length);
  return (
    <ConsolePrompt
      lines={
        count > 0
          ? ["> CRTUBE://PLAYER", `> ${count} tracks ready — deck arrives next_`]
          : ["> CRTUBE://PLAYER", "> awaiting media — download something in SEARCH_"]
      }
    />
  );
}
