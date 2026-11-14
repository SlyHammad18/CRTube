import { useEffect, useMemo } from "react";
import { motion, useReducedMotion } from "motion/react";
import { MusicNote } from "@phosphor-icons/react";
import { useStatsStore } from "../../stores/stats";
import { useLibraryStore } from "../../stores/library";
import { usePlaylistsStore } from "../../stores/playlists";
import { usePlayerStore } from "../../stores/player";
import { useUIStore } from "../../stores/ui";
import { fmtListenTime } from "../../lib/format";
import { imgSrcOf } from "../../lib/asset";
import { ThumbImage } from "../common/ThumbImage";
import { ArtistArt } from "../common/ArtistArt";
import type {
  StatsRange,
  StatsTopArtist,
  StatsTopTrack,
} from "../../types/stats";

const RANGES: { id: StatsRange; label: string }[] = [
  { id: "day", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "year", label: "This year" },
  { id: "all", label: "All time" },
];

function rangeCaption(range: StatsRange): string {
  return range === "all"
    ? "all time"
    : range === "year"
      ? "this year"
      : range === "month"
        ? "this month"
        : range === "week"
          ? "this week"
          : "today";
}

function artworkSrcOf(t: StatsTopTrack): string | undefined {
  return imgSrcOf(t.customThumbPath?.trim() || t.thumbUrl || undefined);
}

/** Play a top track however it exists: library entry first, live stream else. */
function playTopTrack(t: StatsTopTrack) {
  const entry = useLibraryStore
    .getState()
    .entries.find((e) => e.videoId === t.videoId);
  if (entry) {
    usePlayerStore.getState().playAll([entry], 0, { type: "library" });
    return;
  }
  if (t.thumbUrl) {
    usePlayerStore
      .getState()
      .playStream(
        {
          videoId: t.videoId,
          title: t.title,
          channel: t.channel,
          thumbUrl: t.thumbUrl,
        },
        "audio",
      );
  }
}

function RangePills() {
  const range = useStatsStore((s) => s.range);
  const setRange = useStatsStore((s) => s.setRange);
  return (
    <div role="group" aria-label="Stats period" className="flex gap-1.5">
      {RANGES.map((r) => (
        <button
          key={r.id}
          aria-pressed={range === r.id}
          onClick={() => setRange(r.id)}
          className={`rounded-full border px-3 py-1 text-12 font-medium transition-colors duration-150 active:scale-[0.98] ${
            range === r.id
              ? "border-ice bg-ice text-void"
              : "border-line text-mute hover:bg-raise hover:text-ink"
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-16 font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-panel px-3 py-4 sm:px-4">
      <p className="font-mono text-11 uppercase tracking-wide text-dim">{label}</p>
      <p className="mt-1 truncate font-mono text-20 text-ice">{value}</p>
    </div>
  );
}

/** Flat ice bars, animated by scaleY only (transform/opacity motion contract). */
function PeriodBars({ buckets }: { buckets: { label: string; seconds: number }[] }) {
  const reduce = useReducedMotion();
  const max = useMemo(
    () => Math.max(1, ...buckets.map((b) => b.seconds)),
    [buckets],
  );
  return (
    <div
      role="img"
      aria-label="Listening time by period"
      className="flex h-24 items-stretch gap-[3px]"
    >
      {buckets.map((b, i) => (
        <div
          key={`${b.label}-${i}`}
          title={`${b.label} — ${fmtListenTime(b.seconds) ?? "0 s"}`}
          className="flex min-w-0 flex-1 flex-col items-center gap-1"
        >
          <div className="flex min-h-0 w-full flex-1 items-end">
            <motion.div
              initial={reduce ? { opacity: 0 } : { scaleY: 0, opacity: 0.4 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 25, delay: reduce ? 0 : i * 0.012 }}
              style={{ height: `${Math.max(b.seconds > 0 ? 4 : 1, (b.seconds / max) * 100)}%` }}
              className={`w-full origin-bottom rounded-t-[2px] ${
                b.seconds > 0 ? "bg-ice/70" : "bg-raise"
              }`}
            />
          </div>
          <span className="w-full whitespace-nowrap text-center font-mono text-[10px] leading-none text-dim">
            {b.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function TopTrackRow({ track, rank }: { track: StatsTopTrack; rank: number }) {
  const src = artworkSrcOf(track);
  const playable =
    useLibraryStore.getState().entries.some((e) => e.videoId === track.videoId) ||
    track.thumbUrl != null;
  return (
    <button
      onClick={() => playTopTrack(track)}
      disabled={!playable}
      className="group flex w-full items-center gap-3 rounded-card border border-line bg-panel p-2 text-left transition-colors duration-150 hover:bg-raise active:scale-[0.99] disabled:pointer-events-none disabled:opacity-60"
    >
      <span className="w-7 shrink-0 text-right font-mono text-14 text-dim">
        {rank}
      </span>
      <span className="relative h-10 w-16 shrink-0 overflow-hidden rounded-card bg-raise text-dim">
        {src ? (
          <ThumbImage src={src} className="h-full w-full" />
        ) : (
          <span className="grid h-full w-full place-items-center">
            <MusicNote size={16} weight="light" aria-hidden />
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <p className="truncate text-13 text-ink">{track.title}</p>
        <p className="truncate font-mono text-11 text-mute">
          {track.channel ?? "—"}
        </p>
      </span>
      <span className="w-12 shrink-0 text-right font-mono text-12 text-ice">
        {track.plays}×
      </span>
    </button>
  );
}

function TopArtistTile({ artist }: { artist: StatsTopArtist }) {
  const artists = usePlaylistsStore((s) => s.artists);
  const openArtist = usePlaylistsStore((s) => s.openArtist);
  const setView = useUIStore((s) => s.setView);
  const libArtist = artists.find((a) => a.id === artist.artistId);
  const openable = libArtist != null;
  const artArtist =
    libArtist ??
    { id: artist.artistId ?? -1, name: artist.name, coverKind: "auto" as const, coverPath: null };
  return (
    <button
      onClick={
        openable
          ? () => {
              openArtist(artist.name);
              setView("player");
            }
          : undefined
      }
      className={`flex w-[132px] shrink-0 flex-col gap-2 rounded-card border border-line bg-panel p-2 text-left transition-colors duration-150 ${
        openable ? "hover:bg-raise active:scale-[0.99]" : "cursor-default"
      }`}
    >
      <ArtistArt artist={artArtist} className="aspect-square w-full rounded-card" />
      <div className="min-w-0">
        <p className="truncate text-13 text-ink">{artist.name}</p>
        <p className="truncate font-mono text-11 text-mute">
          {artist.plays} plays · {fmtListenTime(artist.seconds) ?? "—"}
        </p>
      </div>
    </button>
  );
}

export function StatsView() {
  const range = useStatsStore((s) => s.range);
  const data = useStatsStore((s) => s.data);
  const loading = useStatsStore((s) => s.loading);
  const loaded = useStatsStore((s) => s.loaded);
  const refresh = useStatsStore((s) => s.refresh);

  // Refetch whenever the tab opens so freshly logged listening shows up.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const empty = loaded && (!data || data.overview.totalSeconds === 0);

  return (
    <div className="mx-auto flex h-full w-full max-w-[960px] flex-col pt-[6vh]">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-18 font-semibold tracking-tight">Stats</h1>
        {data && data.overview.plays > 0 && (
          <span className="font-mono text-12 text-mute">
            {data.overview.plays} plays tracked · {rangeCaption(range)}
          </span>
        )}
      </header>

      <div className="mb-4 shrink-0">
        <RangePills />
      </div>

      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-[16vh]">
          <p className="font-mono text-15 text-mute">{"> no listening data yet_"}</p>
          <p className="font-mono text-12 text-dim">
            {loading ? "sampling…_" : "play something and come back_"}
          </p>
          <button
            onClick={() => useUIStore.getState().setView("home")}
            className="rounded-card bg-ice px-4 py-2 text-13 font-semibold text-void hover:bg-ink active:scale-[0.98]"
          >
            Find something to play
          </button>
        </div>
      ) : data ? (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-6 pr-2">
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label="Listening time"
              value={fmtListenTime(data.overview.totalSeconds) ?? "0 s"}
            />
            <StatCard label="Plays" value={String(data.overview.plays)} />
            <StatCard label="Tracks" value={String(data.overview.tracks)} />
          </div>

          {/* Hourly bars don't say much for a single day — no chart on Today. */}
          {range !== "day" && (
            <Section title="Listening time">
              <div className="rounded-card border border-line bg-panel p-4">
                {data.timeline.length > 0 ? (
                  <PeriodBars buckets={data.timeline} />
                ) : (
                  <p className="py-6 text-center font-mono text-12 text-dim">
                    {"> nothing charted for this period_"}
                  </p>
                )}
              </div>
            </Section>
          )}

          {data.topTracks.length > 0 && (
            <Section title="Top songs">
              <ol className="flex flex-col gap-1.5">
                {data.topTracks.map((t, i) => (
                  <li key={t.videoId}>
                    <TopTrackRow track={t} rank={i + 1} />
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {data.topArtists.length > 0 && (
            <Section title="Top artists">
              <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
                {data.topArtists.map((a) => (
                  <TopArtistTile key={a.name} artist={a} />
                ))}
              </div>
            </Section>
          )}
        </div>
      ) : null}
    </div>
  );
}
