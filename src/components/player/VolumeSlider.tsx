import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { usePlayerStore } from "../../stores/player";

/** Thin custom-styled volume control bound to the player store. */
export function VolumeSlider({ className = "" }: { className?: string }) {
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const muted = usePlayerStore((s) => s.muted);
  const setMuted = usePlayerStore((s) => s.setMuted);
  const pct = Math.round(volume * 100);
  const silent = muted || volume === 0;

  const toggleMute = () => {
    if (muted) setMuted(false);
    else if (volume > 0) setMuted(true);
    else setVolume(1);
  };

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
      >
        {silent ? (
          <SpeakerSlash size={15} weight="light" aria-hidden />
        ) : (
          <SpeakerHigh size={15} weight="light" aria-hidden />
        )}
      </button>
      <input
        aria-label="Volume"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => {
          const v = Number(e.target.value);
          setVolume(v);
          if (v > 0) setMuted(false);
        }}
        className="range-ice w-24"
        style={{
          background: `linear-gradient(to right, var(--color-ice) ${pct}%, var(--color-line) ${pct}%)`,
        }}
      />
      <span className="w-9 shrink-0 text-right font-mono text-11 tabular-nums text-mute">
        {pct}%
      </span>
    </div>
  );
}
