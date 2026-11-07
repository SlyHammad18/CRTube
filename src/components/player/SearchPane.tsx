import { useRef } from "react";
import { useUIStore } from "../../stores/ui";
import { useSearchStore } from "../../stores/search";
import { useSheetStore } from "../../stores/sheet";
import { looksLikeUrl } from "../../lib/detect";
import { SearchDock } from "../search/SearchDock";
import { SearchResults } from "../search/SearchResults";

/**
 * Player-tab search pane — replaces the ContextHeader + TrackList middle pane
 * while active. Library matches filter live as you type; Enter runs the
 * YouTube search (URLs route to the format sheet, like the home dock).
 * Escape / the dock's ✕ (empty input) return to the previous context.
 */
export function SearchPane() {
  const query = useUIStore((s) => s.playerSearch) ?? "";
  const setPlayerSearch = useUIStore((s) => s.setPlayerSearch);
  const search = useSearchStore((s) => s.search);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (raw: string) => {
    if (looksLikeUrl(raw)) {
      useSheetStore.getState().openForUrl(raw);
      return;
    }
    void search(raw);
    setPlayerSearch(raw);
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col px-4">
      <div className="w-full shrink-0 pb-3 pt-5">
        <SearchDock
          size="compact"
          autoFocus
          inputRef={inputRef}
          onSubmitOverride={submit}
          onInputChange={(v) => setPlayerSearch(v)}
          onEscape={() => setPlayerSearch(null)}
          placeholder="Search your library or YouTube…"
        />
      </div>
      <SearchResults variant="rows" libraryQuery={query} />
    </div>
  );
}
