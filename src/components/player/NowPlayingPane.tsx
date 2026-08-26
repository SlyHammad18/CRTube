import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowsOut,
  MusicNotes,
  Pause,
  Play,
  Repeat,
  RepeatOnce,
  Shuffle,
  SkipBack,
  SkipForward,
} from "@phosphor-icons/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { selectCurrentEntry, usePlayerStore } from "../../stores/player";
import { useUIStore } from "../../stores/ui";
import { setPrimarySlot } from "./../player-bar/mediaSlots";
import { useLyrics } from "../../hooks/useLyrics";
import { SeekBar } from "./SeekBar";
import { VolumeSlider } from "./VolumeSlider";
import { SpeedMenu } from "./SpeedMenu";
import { CaptionDeck } from "./CaptionDeck";

/**
 * Right pane shell (§4.8). Artwork frame + primary media portal slot, SeekBar,
 * transport, volume/speed, and the Caption Deck (synced lyrics).
 */
export function NowPlayingPane() {
  const entry = usePlayerStore(selectCurrentEntry);
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);
  const lyrics = useLyrics(entry);

  useEffect(() => {
    setPrimarySlot(slotEl);
    return () => setPrimarySlot(null);
  }, [slotEl]);

  const thumb =
    entry?.thumbUrl &&
    (entry.thumbUrl.startsWith("http")
      ? entry.thumbUrl
      : convertFileSrc(entry.thumbUrl));

  const isVideo = entry?.kind === "video" && entry.path !== "";

  if (!entry) {
    return (
      <aside className="flex h-full w-[320px] shrink-0 flex-col gap-4 overflow-hidden border-l border-line bg-panel/50 p-4">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="grid aspect-square w-40 place-items-center rounded-card border border-line bg-raise">
            <MusicNotes size={32} weight="light" className="text-dim" aria-hidden />
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-mono text-12 text-dim">{"> nothing playing_"}</p>
            <p className="font-mono text-12 text-dim">double-click a track</p>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col gap-4 overflow-hidden border-l border-line bg-panel/50 p-4">
      {/* Artwork frame — poster (cached thumbnail) behind the portaled <video>
          for video tracks, so the frame is never an empty black box. */}
      <div className="relative aspect-square w-full shrink-0 rounded-card border border-line bg-raise">
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className="absolute inset-0 h-full w-full rounded-card object-cover"
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center rounded-card text-dim">
            <MusicNotes size={40} weight="light" aria-hidden />
          </span>
        )}
        <div ref={setSlotEl} id="nowplaying-media-slot" className="absolute inset-0" />
        {isVideo && (
          <button
            aria-label="Fullscreen"
            title="Fullscreen"
            onClick={() => useUIStore.getState().setVideoFullscreen(true)}
            className="absolute right-2 top-2 z-20 grid h-8 w-8 place-items-center rounded-card bg-void/60 text-ink backdrop-blur-sm transition-colors duration-150 hover:bg-void hover:text-ice active:scale-[0.98]"
          >
            <ArrowsOut size={16} weight="light" aria-hidden />
          </button>
        )}
      </div>

      <div className="min-w-0 shrink-0">
        <h2 className="line-clamp-2 font-display text-24 font-semibold leading-tight tracking-tight">
          {entry.title}
        </h2>
        <p className="mt-1 truncate text-13 text-mute">
          {entry.channel ?? "—"} · {entry.container.toUpperCase()}
        </p>
      </div>

      <SeekBar />

      <TransportRow />

      <div className="flex shrink-0 items-center justify-between gap-3">
        <VolumeSlider />
        <SpeedMenu />
      </div>

      <CaptionDeck entry={entry} lyrics={lyrics} />
    </aside>
  );
}

function IconBtn({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-9 w-9 place-items-center rounded-card transition-colors duration-150 active:scale-[0.98] ${
        active ? "text-ice" : "text-mute hover:bg-raise hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function TransportRow() {
  const playing = usePlayerStore((s) => s.playing);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const store = usePlayerStore;

  return (
    <div className="flex shrink-0 items-center justify-center gap-2">
      <IconBtn
        label="Shuffle"
        active={shuffle}
        onClick={() => store.getState().toggleShuffle()}
      >
        <Shuffle size={17} weight="light" aria-hidden />
      </IconBtn>
      <IconBtn label="Previous" onClick={() => store.getState().prev()}>
        <SkipBack size={18} weight="light" aria-hidden />
      </IconBtn>
      <button
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => store.getState().toggle()}
        className="grid h-11 w-11 place-items-center rounded-full bg-ice text-void transition-transform duration-150 hover:bg-ink active:scale-[0.98]"
      >
        {playing ? (
          <Pause size={18} weight="fill" aria-hidden />
        ) : (
          <Play size={18} weight="fill" aria-hidden />
        )}
      </button>
      <IconBtn label="Next" onClick={() => store.getState().next()}>
        <SkipForward size={18} weight="light" aria-hidden />
      </IconBtn>
      <IconBtn
        label={
          repeat === "off"
            ? "Repeat off"
            : repeat === "all"
              ? "Repeat playlist"
              : "Repeat one"
        }
        active={repeat !== "off"}
        onClick={() => store.getState().cycleRepeat()}
      >
        {repeat === "one" ? (
          <RepeatOnce size={17} weight="light" aria-hidden />
        ) : (
          <Repeat size={17} weight="light" aria-hidden />
        )}
      </IconBtn>
    </div>
  );
}
