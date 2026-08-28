import { Heart } from "@phosphor-icons/react";
import { useLibraryStore } from "../../stores/library";

export function FavouriteButton({
  entryId,
  size = 16,
  className = "",
}: {
  entryId: number;
  size?: number;
  className?: string;
}) {
  const favourite = useLibraryStore(
    (s) => s.entries.find((e) => e.id === entryId)?.favourite ?? false,
  );
  const setFavourite = useLibraryStore((s) => s.setFavourite);

  return (
    <button
      type="button"
      aria-label={favourite ? "Remove from Favourites" : "Add to Favourites"}
      aria-pressed={favourite}
      onClick={(e) => {
        e.stopPropagation();
        setFavourite(entryId, !favourite);
      }}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-card transition-colors duration-150 active:scale-[0.98] ${
        favourite
          ? "text-signal hover:bg-signal/15"
          : "text-mute hover:bg-raise hover:text-ink"
      } ${className}`}
    >
      <Heart size={size} weight={favourite ? "fill" : "light"} aria-hidden />
    </button>
  );
}
