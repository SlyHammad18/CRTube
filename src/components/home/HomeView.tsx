import { useEffect, useMemo } from "react";
import { Play, Plus } from "@phosphor-icons/react";
import { fmtDuration } from "../../lib/format";
import { imgSrcOf } from "../../lib/asset";
import type { LibraryEntry } from "../../types/library";
import { useLibraryStore } from "../../stores/library";
import { usePlayerStore } from "../../stores/player";
import { usePlaylistsStore } from "../../stores/playlists";
import { useUIStore } from "../../stores/ui";
import { PlaylistArt } from "../common/PlaylistArt";
import { ArtistArt } from "../common/ArtistArt";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-16 font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function TrackCard({
  entry,
  onPlay,
}: {
  entry: LibraryEntry;
  onPlay: () => void;
}) {
  const thumb = imgSrcOf(entry.thumbUrl);
  return (
    <button
      onClick={onPlay}
      className="group flex w-[150px] shrink-0 flex-col gap-2 rounded-card border border-line bg-panel p-2 text-left transition-colors duration-150 hover:bg-raise active:scale-[0.99]"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-card bg-raise">
        {thumb && (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover opacity-90"
          />
        )}
        <span className="absolute bottom-2 right-2 grid h-9 w-9 translate-y-1 place-items-center rounded-full bg-ice text-void opacity-0 shadow-panel transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100">
          <Play size={14} weight="fill" aria-hidden />
        </span>
      </div>
      <div className="min-w-0">
        <p className="truncate text-13 text-ink">{entry.title}</p>
        <p className="truncate font-mono text-11 text-mute">
          {entry.channel ?? "Unknown"}
          {entry.durationS != null && ` · ${fmtDuration(entry.durationS)}`}
        </p>
      </div>
    </button>
  );
}

export function HomeView() {
  const entries = useLibraryStore((s) => s.entries);
  const loaded = useLibraryStore((s) => s.loaded);
  const playlists = usePlaylistsStore((s) => s.playlists);
  const artists = usePlaylistsStore((s) => s.artists);
  const openPlaylist = usePlaylistsStore((s) => s.openPlaylist);
  const openArtist = usePlaylistsStore((s) => s.openArtist);
  const setView = useUIStore((s) => s.setView);
  const openPlaylistName = useUIStore((s) => s.openPlaylistName);

  useEffect(() => {
    const lib = useLibraryStore.getState();
    if (!lib.loaded) void lib.refresh();
    const pl = usePlaylistsStore.getState();
    if (!pl.loaded) void pl.refresh();
    void pl.refreshArtists();
  }, []);

  const recent = useMemo(
    () => [...entries].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10),
    [entries],
  );

  const goPlaylist = (id: number) => {
    void openPlaylist(id);
    setView("player");
  };

  const goArtist = (name: string) => {
    openArtist(name);
    setView("player");
  };

  const empty = loaded && entries.length === 0 && playlists.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-9 px-2 py-2">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-24 font-semibold tracking-tight">
          {greeting()}
        </h1>
        <p className="font-mono text-12 text-mute">
          {entries.length} {entries.length === 1 ? "track" : "tracks"} in your
          library
        </p>
      </header>

      {empty ? (
        <div className="flex flex-col items-center justify-center gap-4 pb-[18vh] pt-[8vh]">
          <p className="font-mono text-15 text-mute">{"> library is empty_"}</p>
          <button
            onClick={() => setView("search")}
            className="rounded-card bg-ice px-4 py-2 text-13 font-semibold text-void hover:bg-ink active:scale-[0.98]"
          >
            Find something to download
          </button>
        </div>
      ) : (
        <>
          {recent.length > 0 && (
            <Section
              title="Recently Added"
              action={
                <button
                  onClick={() => setView("library")}
                  className="font-mono text-11 uppercase tracking-wide text-dim transition-colors duration-150 hover:text-ink"
                >
                  See library
                </button>
              }
            >
              <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
                {recent.map((e, i) => (
                  <TrackCard
                    key={e.id}
                    entry={e}
                    onPlay={() =>
                      usePlayerStore.getState().playAll(recent, i, {
                        type: "library",
                      })
                    }
                  />
                ))}
              </div>
            </Section>
          )}

          {playlists.length > 0 && (
            <Section
              title="Playlists"
              action={
                <button
                  onClick={() => openPlaylistName({ mode: "create" })}
                  className="flex items-center gap-1 font-mono text-11 uppercase tracking-wide text-dim transition-colors duration-150 hover:text-ink"
                >
                  <Plus size={12} weight="light" aria-hidden /> New
                </button>
              }
            >
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {playlists.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => goPlaylist(p.id)}
                    className="group flex flex-col gap-2 rounded-card border border-line bg-panel p-2 text-left transition-colors duration-150 hover:bg-raise active:scale-[0.99]"
                  >
                    <PlaylistArt playlist={p} className="aspect-square w-full rounded-card" />
                    <div className="min-w-0">
                      <p className="truncate text-13 text-ink">{p.name}</p>
                      <p className="truncate font-mono text-11 text-mute">
                        {p.trackCount} {p.trackCount === 1 ? "track" : "tracks"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </Section>
          )}

          {artists.length > 0 && (
            <Section title="Artists">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {artists.slice(0, 18).map((a) => (
                  <button
                    key={a.id}
                    onClick={() => goArtist(a.name)}
                    className="group flex flex-col gap-2 rounded-card border border-line bg-panel p-2 text-left transition-colors duration-150 hover:bg-raise active:scale-[0.99]"
                  >
                    <ArtistArt artist={a} className="aspect-square w-full rounded-card" />
                    <div className="min-w-0">
                      <p className="truncate text-13 text-ink">{a.name}</p>
                      <p className="truncate font-mono text-11 text-mute">
                        Artist · {a.trackCount} {a.trackCount === 1 ? "track" : "tracks"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}