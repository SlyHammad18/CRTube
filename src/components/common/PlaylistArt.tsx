import { memo } from "react";
import { Queue } from "@phosphor-icons/react";
import type { Playlist } from "../../types/player";
import { COVER_URL_MAX } from "../../types/player";
import { imgSrcOf } from "../../lib/asset";

/** Cell tweaks per cover count (auto collage layout: 2×2 quadrant wall). */
const SLOTS: Record<number, string[]> = {
  4: ["", "", "", ""],
  3: [
    "col-start-1 row-start-1 row-span-2",
    "col-start-2 row-start-1",
    "col-start-2 row-start-2",
  ],
  2: ["", ""],
  1: [""],
  0: [],
};

/** Grid classes for the collage frame per cover count. */
const GRID: Record<number, string> = {
  4: "grid grid-cols-2 grid-rows-2",
  3: "grid grid-cols-2 grid-rows-2",
  2: "grid grid-cols-2 grid-rows-1",
  1: "grid grid-cols-1 grid-rows-1",
  0: "",
};

/**
 * Playlist cover art. A `custom` cover renders the picked image full-bleed;
 * the default `auto` mode is a live CSS collage of up to four track covers in
 * a 2×2 "broadcast wall" (the CRTube take on a playlist collage):
 * 4 → 2×2 · 3 → 1 large + 2 stacked · 2 → halves · 1 → full-bleed · 0 → icon.
 */
export const PlaylistArt = memo(function PlaylistArt({
  playlist,
  className = "",
  title,
}: {
  playlist: Pick<Playlist, "id" | "name" | "coverKind" | "coverPath" | "coverUrls">;
  className?: string;
  title?: string;
}) {
  const urls = playlist.coverUrls.slice(0, COVER_URL_MAX).map(imgSrcOf);
  const count = urls.length;

  if (playlist.coverKind === "custom" && urls[0]) {
    return (
      <div
        key={playlist.id}
        className={`overflow-hidden bg-raise ${className}`}
      >
        <img
          src={urls[0]}
          alt={title ?? `${playlist.name} cover`}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  if (count === 0) {
    return (
      <div
        key={playlist.id}
        className={`grid place-items-center bg-raise text-dim ${className}`}
      >
        <Queue size={26} weight="light" aria-hidden />
      </div>
    );
  }

  return (
    <div
      key={playlist.id}
      className={`overflow-hidden bg-raise ${GRID[count]} ${className}`}
    >
      {urls.slice(0, count).map((src, i) => (
        <img
          key={i}
          src={src}
          alt=""
          loading="lazy"
          className={`block h-full w-full object-cover ${SLOTS[count][i] ?? ""}`}
        />
      ))}
    </div>
  );
});