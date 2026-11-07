import { memo, useEffect, useState } from "react";
import { ipc } from "../../lib/ipc";

/**
 * Loopback base for the cached-thumb route — one IPC per webview, shared by
 * every ThumbImage. `null` when unavailable: images then render directly.
 */
let basePromise: Promise<string | null> | null = null;
function thumbBase(): Promise<string | null> {
  basePromise ??= ipc.thumbBaseUrl().catch(() => null);
  return basePromise;
}

/** Micro-variant URL for an app-cached thumb (`…/thumbs/{video_id}.jpg`).
 *  Custom picks (covers/) and remote URLs don't resolve — they render direct.
 *  Asset-protocol URLs percent-encode the path on some platforms, so the
 *  decoded form is matched too. */
export function microThumbOf(
  src: string,
  base: string | null,
): string | undefined {
  if (!base) return undefined;
  const id =
    /thumbs\/([A-Za-z0-9_-]{11})\.jpg$/.exec(src)?.[1] ??
    (() => {
      try {
        return /thumbs\/([A-Za-z0-9_-]{11})\.jpg$/.exec(decodeURIComponent(src))
          ?.[1];
      } catch {
        return undefined;
      }
    })();
  return id ? `${base}/${id}/micro` : undefined;
}

/**
 * Artwork with a local low-res placeholder. The micro thumb (a few KB,
 * decoded in a frame) paints instantly while scrolling; the full 1280×720
 * cache is revealed only once loaded, so it never paints at its intrinsic
 * size before the object-fit crop applies. Without a micro variant this
 * degrades to a plain img with the same fade.
 */
export const ThumbImage = memo(function ThumbImage({
  src,
  className = "",
}: {
  src: string;
  className?: string;
}) {
  const [base, setBase] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void thumbBase().then((b) => {
      if (alive && b) setBase(b);
    });
    return () => {
      alive = false;
    };
  }, []);

  // A new src must fade in again, not flash through from the old one.
  useEffect(() => setLoaded(false), [src]);

  const micro = microThumbOf(src, base);
  return (
    <span className={`relative block overflow-hidden ${className}`}>
      {micro && (
        <img
          src={micro}
          alt=""
          aria-hidden
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        style={{ opacity: loaded ? undefined : 0, transition: "opacity 180ms" }}
        className="relative h-full w-full object-cover"
      />
    </span>
  );
});
