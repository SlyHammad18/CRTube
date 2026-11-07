import { memo, useEffect, useMemo, useState } from "react";
import type { Artist } from "../../types/player";
import { useLibraryStore } from "../../stores/library";
import { artistArtModel } from "../../lib/artistArt";
import { fetchArtistImage } from "../../lib/artistExternalArt";
import { PlaylistArt } from "./PlaylistArt";
import { ThumbImage } from "./ThumbImage";

/**
 * Artist artwork. Resolution order:
 *  1. a custom uploaded cover when set,
 *  2. a cover fetched from the Wikipedia REST API (public, cached), and
 *  3. a collage of the artist's own track thumbnails,
 * with a monogram as the final fallback when none of those exist.
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
  const [externalUrl, setExternalUrl] = useState<string | null>(null);

  const isAuto = artist.coverKind === "auto";

  // For auto covers, prefer the public Wikipedia image; the library's own
  // track-thumb collage remains as the fallback when the API misses.
  useEffect(() => {
    let alive = true;
    if (!isAuto) {
      setExternalUrl(null);
      return;
    }
    setExternalUrl(null);
    void fetchArtistImage(artist.name).then((url) => {
      if (alive) setExternalUrl(url);
    });
    return () => {
      alive = false;
    };
  }, [artist.name, isAuto]);

  // 1. Custom uploaded cover — unchanged.
  if (model.coverKind === "custom" && model.coverPath) {
    return <PlaylistArt playlist={model} className={className} />;
  }

  // 2. External photo found — layer it over the local collage and fade it in
  // once loaded. The lookup is network-bound (Deezer → Wikipedia), so a hard
  // swap would blank the art for seconds; this way the local thumbs show
  // instantly and the photo upgrades in place. A dead URL simply never loads
  // and the collage stays.
  if (externalUrl) {
    return (
      <span className={`grid overflow-hidden ${className}`}>
        <PlaylistArt playlist={model} className="col-start-1 row-start-1" />
        <ThumbImage src={externalUrl} className="col-start-1 row-start-1" />
      </span>
    );
  }

  // 3. Own track-thumb collage fallback.
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