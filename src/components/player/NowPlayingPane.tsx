import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { selectCurrentEntry, usePlayerStore } from "../../stores/player";
import { setPrimarySlot } from "./../player-bar/mediaSlots";

/**
 * Right pane shell (§4.8). T14 ships artwork + the primary media portal slot
 * (live video lands here); seek bar / transport / Caption Deck arrive in T15.
 */
export function NowPlayingPane() {
  const entry = usePlayerStore(selectCurrentEntry);
  const [slotEl, setSlotEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    setPrimarySlot(slotEl);
    return () => setPrimarySlot(null);
  }, [slotEl]);

  const isVideo = entry?.kind === "video" && entry.path !== "";
  const thumb =
    entry?.thumbUrl &&
    (entry.thumbUrl.startsWith("http")
      ? entry.thumbUrl
      : convertFileSrc(entry.thumbUrl));

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-panel/50 p-5">
      {/* Artwork frame — hosts the portaled <video> for video tracks */}
      <div className="relative aspect-square w-full overflow-hidden rounded-card border border-line bg-raise">
        {thumb && !isVideo ? (
          <img
            src={thumb}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : !isVideo ? (
          <span className="absolute inset-0 grid place-items-center font-mono text-11 text-dim">
            no artwork
          </span>
        ) : null}
        <div ref={setSlotEl} id="nowplaying-media-slot" className="absolute inset-0" />
      </div>

      {entry ? (
        <>
          <div className="min-w-0">
            <h2 className="line-clamp-2 font-display text-24 font-semibold leading-tight tracking-tight">
              {entry.title}
            </h2>
            <p className="mt-1 truncate text-13 text-mute">
              {entry.channel ?? "—"} · {entry.container.toUpperCase()}
            </p>
          </div>
          <p className="mt-auto font-mono text-11 text-dim">
            {"> captions sync up next_"}
          </p>
        </>
      ) : (
        <div className="mt-auto flex flex-col gap-1">
          <p className="font-mono text-12 text-dim">{"> nothing playing_"}</p>
          <p className="font-mono text-12 text-dim">double-click a track</p>
        </div>
      )}
    </aside>
  );
}
