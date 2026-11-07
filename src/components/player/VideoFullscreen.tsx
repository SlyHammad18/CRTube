import { useEffect } from "react";
import { Pause, Play, RepeatOnce, X } from "@phosphor-icons/react";
import { selectCurrentEntry, usePlayerStore } from "../../stores/player";
import { useSettingsStore } from "../../stores/settings";
import { useUIStore } from "../../stores/ui";
import { isStreamTrack } from "../../types/player";
import { isUrduScript } from "../../lib/format";
import { setFullscreenSlot } from "../player-bar/mediaSlots";
import { SeekBar } from "./SeekBar";
import { VolumeSlider } from "./VolumeSlider";
import { FavouriteButton } from "./FavouriteButton";
import { SpeedMenu } from "./SpeedMenu";
import { useLyrics } from "../../hooks/useLyrics";
import { activeIndex } from "../../lib/lrc";

/**
 * In-app fullscreen video overlay (§requested): the single <video> element is
 * NOT a child of this overlay — MediaHost keeps it mounted at app root and
 * positions it over `els.fullscreen` via CSS. Playback (audio included) never
 * restarts and, crucially, the video surface is never reparented under a
 * promoted compositing layer, which previously made it go black under
 * WebKitGTK. This overlay only provides the timeline/timestamp (SeekBar) +
 * volume controls and the stage rect to measure.
 */
export function VideoFullscreen() {
  const open = useUIStore((s) => s.videoFullscreen);
  const setOpen = useUIStore((s) => s.setVideoFullscreen);
  const entry = usePlayerStore(selectCurrentEntry);
  const playing = usePlayerStore((s) => s.playing);
  const toggle = usePlayerStore((s) => s.toggle);
  const repeat = usePlayerStore((s) => s.repeat);
  const setRepeat = usePlayerStore((s) => s.setRepeat);

  const isVideo =
    entry != null &&
    (isStreamTrack(entry)
      ? entry.kind === "video"
      : entry.kind === "video" && entry.path !== "");
  const videoDisabled = useUIStore((s) => s.videoDisabled);
  // videoDisabled only governs downloaded files — stream tracks use their own
  // kind toggle as the picture control, so it must not close the overlay.
  const pictureHidden = entry != null && !isStreamTrack(entry) && videoDisabled;

  const lyrics = useLyrics(entry);
  const currentTimeS = usePlayerStore((s) => s.currentTimeS);
  const seek = usePlayerStore((s) => s.seek);

  const activeIdx =
    lyrics.status === "loaded"
      ? activeIndex(lyrics.lines, currentTimeS * 1000)
      : -1;
  const activeLine = activeIdx >= 0 ? lyrics.lines[activeIdx] : null;

  // Escape closes fullscreen; auto-close if there's no video to show.
  useEffect(() => {
    if (!open || !isVideo || pictureHidden) {
      if (open) setOpen(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isVideo, pictureHidden, setOpen]);

  const registerSlot = (el: HTMLDivElement | null) => {
    setFullscreenSlot(el);
  };

  if (!open || !isVideo) return null;

  return (
    <>
      <div aria-hidden className="fixed inset-0 z-[94] bg-void" />
      <div
        className="fixed inset-0 z-[97] flex flex-col"
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
        <div className="min-w-0">
          <p className="truncate text-14 font-semibold text-ink">
            {entry?.title}
          </p>
          <p className="truncate font-mono text-12 text-mute">
            {entry?.channel ?? "—"}
          </p>
        </div>
        <button
          aria-label="Exit fullscreen"
          onClick={() => setOpen(false)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
        >
          <X size={18} weight="light" aria-hidden />
        </button>
      </div>

      {/* Video stage — the portaled <video> lands here (object-contain). */}
      <div className="relative min-h-0 flex-1">
        <div ref={registerSlot} className="absolute inset-0" />
        {activeLine && (
          <VideoCaption line={activeLine.text} tMs={activeLine.tMs} onSeek={seek} />
        )}
      </div>

      {/* Controls */}
      <div className="flex shrink-0 flex-col gap-3 px-5 py-4">
        <SeekBar />
        <div className="flex items-center justify-between gap-3">
          <button
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => toggle()}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ice text-void transition-transform duration-150 hover:bg-ink active:scale-[0.98]"
          >
            {playing ? (
              <Pause size={18} weight="fill" aria-hidden />
            ) : (
              <Play size={18} weight="fill" aria-hidden />
            )}
          </button>
          <VolumeSlider />
          <div className="flex items-center gap-2.5">
            {entry && !isStreamTrack(entry) && <FavouriteButton entryId={entry.id} size={18} />}
            <SpeedMenu zClass="z-[100]" />
            <button
              aria-label="Loop one"
              title="Loop one"
              onClick={() => setRepeat(repeat === "one" ? "off" : "one")}
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-card transition-colors duration-150 active:scale-[0.98] ${
                repeat === "one"
                  ? "text-ice"
                  : "text-mute hover:bg-raise hover:text-ink"
              }`}
            >
              <RepeatOnce size={18} weight="light" aria-hidden />
            </button>
          </div>
        </div>
      </div>
      </div>
    </>
  );
}

/**
 * Active-line caption pill over the video stage. Font size follows
 * Settings → Lyrics (Urdu lines step up ×4⁄3, matching the Caption Deck).
 */
function VideoCaption({
  line,
  tMs,
  onSeek,
}: {
  line: string;
  tMs: number;
  onSeek: (ms: number) => void;
}) {
  const urdu = isUrduScript(line);
  const latinSize = useSettingsStore((s) => s.settings?.lyrics_size_latin ?? 15);
  const urduSize = useSettingsStore((s) => s.settings?.lyrics_size_urdu ?? 18);
  return (
    <button
      aria-label="Seek to this lyric"
      onClick={(e) => {
        e.stopPropagation();
        onSeek(tMs);
      }}
      className="absolute inset-x-0 bottom-6 flex justify-center px-4"
    >
      <span
        style={
          urdu
            ? {
                lineHeight: 2.1,
                textRendering: "optimizeLegibility",
                fontSize: `${Math.round((urduSize * 4) / 3)}px`,
              }
            : { fontSize: `${latinSize}px` }
        }
        className={`max-w-[80%] rounded-card bg-void/70 px-3 py-1.5 text-center font-semibold text-ink shadow-[0_2px_12px_rgba(0,0,0,0.5)] ${
          urdu ? "font-urdu" : ""
        }`}
        dir={urdu ? "auto" : undefined}
      >
        {line}
      </span>
    </button>
  );
}
