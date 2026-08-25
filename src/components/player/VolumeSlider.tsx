import { SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { usePlayerStore } from "../../stores/player";

/** Thin custom-styled volume control bound to the player store. */
export function VolumeSlider({ className = "" }: { className?: string }) {
  const volume = usePlayerStore((s) => s.volume);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const pct = Math.round(volume * 100);

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <span className="text-mute" aria-hidden>
        {volume > 0 ? (
          <SpeakerHigh size={15} weight="light" />
        ) : (
          <SpeakerSlash size={15} weight="light" />
        )}
      </span>
      <input
        aria-label="Volume"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        className="range-ice w-24"
        style={{
          background: `linear-gradient(to right, var(--color-ice) ${pct}%, var(--color-line) ${pct}%)`,
        }}
      />
    </div>
  );
}
