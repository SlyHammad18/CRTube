import { useMemo, useState } from "react";
import {
  ArrowClockwise,
  DotsThreeVertical,
  ImageSquare,
  PencilSimple,
  Play,
  Shuffle,
  SidebarSimple,
  Trash,
} from "@phosphor-icons/react";
import { entryArtworkUrl } from "../../lib/asset";
import { fmtDuration, parseArtists } from "../../lib/format";
import type { LibraryEntry } from "../../types/library";
import { useLibraryStore } from "../../stores/library";
import { usePlayerStore } from "../../stores/player";
import { usePlaylistsStore } from "../../stores/playlists";
import { useUIStore } from "../../stores/ui";
import { pushToast } from "../../stores/toast";
import { confirm } from "../../stores/confirm";
import { PlaylistArt } from "../common/PlaylistArt";
import { ArtistArt } from "../common/ArtistArt";

/** Synthesize an "auto collage" view model from a flat list of track entries. */
function collageOf(entries: LibraryEntry[]): {
  id: number;
  name: string;
  coverKind: "auto";
  coverPath: null;
  coverUrls: string[];
} {
  return {
    id: -1,
    name: "",
    coverKind: "auto",
    coverPath: null,
    coverUrls: entries
      .slice(0, 4)
      .map(entryArtworkUrl)
      .filter((url): url is string => !!url),
  };
}

function HeroMenu({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <button
        aria-label="Close context menu"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        role="menu"
        className="absolute right-0 top-12 z-50 w-52 rounded-card border border-line bg-panel p-1 shadow-panel"
      >
        {children}
      </div>
    </>
  );
}

export function ContextHeader() {
  const selection = usePlaylistsStore((s) => s.selection);
  const playlists = usePlaylistsStore((s) => s.playlists);
  const artists = usePlaylistsStore((s) => s.artists);
  const openTracks = usePlaylistsStore((s) => s.openTracks);
  const rename = usePlaylistsStore((s) => s.rename);
  const remove = usePlaylistsStore((s) => s.remove);
  const pickCover = usePlaylistsStore((s) => s.pickCover);
  const shuffleCover = usePlaylistsStore((s) => s.shuffleCover);
  const clearCover = usePlaylistsStore((s) => s.clearCover);
  const pickArtistCover = usePlaylistsStore((s) => s.pickArtistCover);
  const clearArtistCover = usePlaylistsStore((s) => s.clearArtistCover);

  const libEntries = useLibraryStore((s) => s.entries);
  const nowPlayingOpen = useUIStore((s) => s.nowPlayingOpen);
  const setNowPlayingOpen = useUIStore((s) => s.setNowPlayingOpen);

  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const playlist =
    selection.type === "playlist"
      ? playlists.find((p) => p.id === selection.id)
      : undefined;
  const artist =
    selection.type === "artist"
      ? artists.find((a) => a.name === selection.name)
      : undefined;

  const source = useMemo<LibraryEntry[]>(() => {
    if (selection.type === "playlist") return openTracks ?? [];
    if (selection.type === "favourites") return libEntries.filter((e) => e.favourite);
    if (selection.type === "artist") {
      return libEntries.filter((e) => parseArtists(e.channel).includes(selection.name));
    }
    return libEntries;
  }, [selection, libEntries, openTracks]);

  const title =
    selection.type === "playlist"
      ? (playlist?.name ?? "Playlist")
      : selection.type === "favourites"
        ? "Favourites"
        : selection.type === "artist"
          ? selection.name
          : selection.recent
            ? "Recently Added"
            : "All Tracks";

  const stats = useMemo(() => {
    const n = source.length;
    const dur = source.reduce((acc, e) => acc + (e.durationS ?? 0), 0);
    let line = `${n} ${n === 1 ? "track" : "tracks"}`;
    if (dur > 0) line += ` · ${fmtDuration(dur)}`;
    if (playlist) {
      const date = new Date(playlist.createdAt * 1000).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      line += ` · ${date}`;
    }
    return line;
  }, [source, playlist]);

  const playCtx = useMemo(() => {
    const t = selection.type;
    if (t === "favourites" || t === "artist") {
      return { type: "library" as const };
    }
    return {
      type: (t === "playlist" ? "playlist" : "library") as "playlist" | "library",
      id: t === "playlist" ? selection.id : undefined,
    };
  }, [selection]);

  const play = () => {
    if (!source.length) return;
    usePlayerStore.getState().playAll(source, 0, playCtx);
  };

  const shufflePlay = () => {
    if (!source.length) return;
    const st = usePlayerStore.getState();
    if (!st.shuffle) st.toggleShuffle();
    st.playAll(source, Math.floor(Math.random() * source.length), playCtx);
  };

  const art =
    selection.type === "playlist" && playlist ? (
      <PlaylistArt
        playlist={playlist}
        className="h-28 w-28 shrink-0 rounded-card @lg:h-44 @lg:w-44"
      />
    ) : selection.type === "artist" ? (
      <ArtistArt
        artist={
          artist ?? { id: -1, name: selection.name, coverKind: "auto", coverPath: null }
        }
        className="h-28 w-28 shrink-0 rounded-card @lg:h-44 @lg:w-44"
      />
    ) : (
      <PlaylistArt
        playlist={collageOf(source)}
        className="h-28 w-28 shrink-0 rounded-card @lg:h-44 @lg:w-44"
      />
    );

  const isPlaylist = selection.type === "playlist";
  const isArtist = selection.type === "artist";

  return (
    <header className="@container flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3 px-6 pb-3 pt-5">
      <div className="relative shrink-0">
        {art}
        {(isPlaylist || isArtist) && (
          <button
            aria-label={isPlaylist ? "Playlist options" : "Artist options"}
            title={isPlaylist ? "Playlist options" : "Artist options"}
            onClick={() => setMenuOpen((v) => !v)}
            className={`absolute bottom-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-card bg-panel/80 text-mute backdrop-blur-sm transition-colors duration-150 hover:text-ink ${
              menuOpen ? "text-ink" : ""
            }`}
          >
            <DotsThreeVertical size={14} weight="light" aria-hidden />
          </button>
        )}
        {menuOpen && isPlaylist && playlist && (
          <HeroMenu onClose={() => setMenuOpen(false)}>
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                play();
              }}
              className="flex w-full items-center gap-2 rounded-card px-2.5 py-1.5 text-left text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink"
            >
              <Play size={12} weight="light" aria-hidden /> Play all
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                shufflePlay();
              }}
              className="flex w-full items-center gap-2 rounded-card px-2.5 py-1.5 text-left text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink"
            >
              <Shuffle size={12} weight="light" aria-hidden /> Shuffle play
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                void pickCover(playlist.id);
              }}
              className="flex w-full items-center gap-2 rounded-card px-2.5 py-1.5 text-left text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink"
            >
              <ImageSquare size={12} weight="light" aria-hidden />
              {playlist.coverKind === "custom" ? "Change cover…" : "Set cover…"}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                void shuffleCover(playlist.id);
              }}
              className="flex w-full items-center gap-2 rounded-card px-2.5 py-1.5 text-left text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink"
            >
              <Shuffle size={12} weight="light" aria-hidden /> Shuffle cover
            </button>
            {playlist.coverKind === "custom" && (
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void clearCover(playlist.id);
                }}
                className="flex w-full items-center gap-2 rounded-card px-2.5 py-1.5 text-left text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink"
              >
                <ArrowClockwise size={12} weight="light" aria-hidden /> Reset to collage
              </button>
            )}
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setRenaming(true);
                setNameDraft(playlist.name);
              }}
              className="flex w-full items-center gap-2 rounded-card px-2.5 py-1.5 text-left text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink"
            >
              <PencilSimple size={12} weight="light" aria-hidden /> Rename
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                void (async () => {
                  const ok = await confirm({
                    title: "Delete playlist?",
                    message: `“${playlist.name}” and its track list will be removed.`,
                    confirmLabel: "Delete",
                  });
                  if (ok)
                    void remove(playlist.id).catch((err) =>
                      pushToast(`Delete failed — ${String(err)}`),
                    );
                })();
              }}
              className="flex w-full items-center gap-2 rounded-card px-2.5 py-1.5 text-left text-12 text-signal transition-colors duration-150 hover:bg-signal hover:text-void"
            >
              <Trash size={12} weight="light" aria-hidden /> Delete
            </button>
          </HeroMenu>
        )}
        {menuOpen && isArtist && artist && (
          <HeroMenu onClose={() => setMenuOpen(false)}>
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                void pickArtistCover(artist.id);
              }}
              className="flex w-full items-center gap-2 rounded-card px-2.5 py-1.5 text-left text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink"
            >
              <ImageSquare size={12} weight="light" aria-hidden />
              {artist.coverKind === "custom" ? "Change cover…" : "Set cover…"}
            </button>
            {artist.coverKind === "custom" && (
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void clearArtistCover(artist.id);
                }}
                className="flex w-full items-center gap-2 rounded-card px-2.5 py-1.5 text-left text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink"
              >
                <ArrowClockwise size={12} weight="light" aria-hidden /> Reset to collage
              </button>
            )}
          </HeroMenu>
        )}
      </div>

      <div className="min-w-[7rem] flex-1 basis-40">
        {renaming && playlist ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const name = nameDraft.trim();
                if (name) void rename(playlist.id, name);
                setRenaming(false);
              }
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={() => setRenaming(false)}
            spellCheck={false}
            aria-label="Rename playlist"
            className="w-full max-w-sm rounded-card border border-line bg-raise px-2 py-1 font-display text-18 font-semibold tracking-tight text-ink outline-none focus:border-ice @lg:text-22"
          />
        ) : (
          <>
            <h1 className="truncate font-display text-18 font-semibold tracking-tight @lg:text-24">
              {title}
            </h1>
            <p className="mt-1 font-mono text-12 text-mute [overflow-wrap:anywhere]">
              {stats}
            </p>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          aria-label="Play all"
          disabled={source.length === 0}
          onClick={play}
          className="flex items-center gap-1.5 rounded-card bg-ice px-3 py-2 text-13 font-semibold text-void transition-colors duration-150 hover:bg-ink active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 @lg:px-4"
        >
          <Play size={13} weight="fill" aria-hidden /> PLAY ALL
        </button>
        <button
          aria-label="Shuffle play"
          title="Shuffle play"
          disabled={source.length === 0}
          onClick={shufflePlay}
          className="flex items-center gap-1.5 rounded-card border border-line px-3 py-2 text-13 font-medium text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 @lg:px-4"
        >
          <Shuffle size={13} weight="light" aria-hidden />
          <span className="hidden @md:inline">SHUFFLE</span>
        </button>
        <button
          aria-label="Toggle now playing pane"
          aria-pressed={nowPlayingOpen}
          title="Toggle now playing"
          onClick={() => setNowPlayingOpen(!nowPlayingOpen)}
          className={`grid h-9 w-9 place-items-center rounded-card transition-colors duration-150 active:scale-[0.98] ${
            nowPlayingOpen ? "text-ice" : "text-mute hover:bg-raise hover:text-ink"
          }`}
        >
          <SidebarSimple size={16} weight="light" aria-hidden />
        </button>
      </div>
    </header>
  );
}