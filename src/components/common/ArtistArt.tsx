import { memo, useMemo } from "react";
import type { Artist } from "../../types/player";
import { useLibraryStore } from "../../stores/library";
import { artistArtModel } from "../../lib/artistArt";
import { PlaylistArt } from "./PlaylistArt";

/**
 * Artist artwork: a collage of up to four of the artist's own track
 * thumbnails (no external image API, no random fillers), a custom uploaded
 * cover when set, or a monogram fallback when none of their tracks have
 * covers yet.
 */
export const ArtistArt = memo(function ArtistArt({
  artist,
  className = "",
}: {
  artist: Pick<Artist, "id" | "name" | "coverKind" | "coverPath">;
  className?: string;
}) {
  const entries = useLibraryStore((s) => s.entries);
  const model = useMemo(() => artistArtModel(artist, entries), [artist, entries]);

  if (model.coverUrls.length === 0) {
    return (
      <div
        aria-hidden
        className={`grid place-items-center bg-raise font-display font-semibold text-dim ${className}`}
      >
        {artist.name.charAt(0).toUpperCase()}
      </div>
    );
  }

  return <PlaylistArt playlist={model} className={className} />;
});
