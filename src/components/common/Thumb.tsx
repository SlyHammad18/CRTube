import { memo, useState } from "react";
import { MusicNote } from "@phosphor-icons/react";

/**
 * Thumbnail image with error fallback. Shows a placeholder icon when the
 * image fails to load instead of rendering broken/blank space.
 */
export const Thumb = memo(function Thumb({
  src,
  alt = "",
  width,
  height,
  className = "",
}: {
  src?: string | null;
  alt?: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const [error, setError] = useState(false);

  if (!src || error) {
    return (
      <div
        className={`grid place-items-center bg-raise ${className}`}
        style={width && height ? { width, height } : undefined}
      >
        <MusicNote size={20} weight="light" className="text-dim" aria-hidden />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      onError={() => setError(true)}
      className={className}
    />
  );
});
