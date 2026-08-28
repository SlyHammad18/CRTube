import {
  FolderOpen,
  DotsSixVertical,
  PencilSimple,
  Trash,
  X,
} from "@phosphor-icons/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { fmtDuration, parseArtists } from "../../lib/format";
import type { LibraryEntry } from "../../types/library";
import { pushToast } from "../../stores/toast";
import { ipc } from "../../lib/ipc";
import { useLibraryStore } from "../../stores/library";
import { usePlayerStore, selectCurrentEntry } from "../../stores/player";
import { confirm } from "../../stores/confirm";
import { AddToPlaylistMenu } from "./AddToPlaylistMenu";
import { FavouriteButton } from "./FavouriteButton";
import { useRenameStore } from "../../stores/rename";

export function thumbSrcOf(entry: LibraryEntry): string | undefined {
  if (!entry.thumbUrl) return undefined;
  return entry.thumbUrl.startsWith("http")
    ? entry.thumbUrl
    : convertFileSrc(entry.thumbUrl);
}

/** §4.8 active-row glyph — three ice bars, staggered scaleY loop. */
function EqGlyph() {
  return (
    <span aria-hidden className="flex h-4 w-3 items-end justify-center gap-[2px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="eq-bar h-full w-[2px] rounded-full bg-ice"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );
}

export function TrackRow({
  entry,
  index,
  onPlay,
  grip,
  onRemoveFrom,
}: {
  entry: LibraryEntry;
  index: number;
  onPlay: () => void;
  /** Present only while manual-order dragging is enabled (playlist view). */
  grip?: { onPointerDown: (e: React.PointerEvent) => void };
  /** Playlist variant: removes the row from the playlist (file untouched). */
  onRemoveFrom?: () => void;
}) {
  const missing = entry.status === "missing";
  const isActive = usePlayerStore(
    (s) => selectCurrentEntry(s)?.id === entry.id,
  );

  const onDelete = async () => {
    const ok = await confirm({
      title: "Delete file?",
      message: `Removes “${entry.title}” from your library and disk.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    void ipc
      .deleteEntry(entry.id, entry.path)
      .then(() => useLibraryStore.getState().refresh())
      .then(() => pushToast(`Deleted — ${entry.title}`))
      .catch((e) => pushToast(`Delete failed — ${String(e)}`));
  };

  return (
    <div
      role="row"
      tabIndex={missing ? -1 : 0}
      aria-disabled={missing}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !missing) onPlay();
      }}
      onClick={(e) => {
        if (missing) return;
        if ((e.target as HTMLElement).closest("button")) return;
        onPlay();
      }}
      className={`group flex cursor-pointer items-center gap-2.5 rounded-card border px-2.5 py-1.5 transition-colors duration-150 ${
        missing
          ? "border-amber/40 opacity-70"
          : isActive
            ? "border-ice/40 bg-raise"
            : "border-line hover:bg-raise"
      }`}
    >
      {/* Grip (playlist manual order) */}
      {grip && (
        <button
          aria-label="Drag to reorder"
          onPointerDown={grip.onPointerDown}
          className="grid h-7 w-5 shrink-0 cursor-grab touch-none place-items-center rounded-card text-dim opacity-0 transition-opacity duration-150 hover:text-mute group-hover:opacity-100 active:cursor-grabbing"
        >
          <DotsSixVertical size={13} weight="light" aria-hidden />
        </button>
      )}

      {/* Index / EQ */}
      <span className="w-5 shrink-0 text-center">
        {isActive && !missing ? (
          <EqGlyph />
        ) : (
          <span className="font-mono text-12 text-dim">{index + 1}</span>
        )}
      </span>

      {/* Thumb */}
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-card border border-line bg-raise">
        {thumbSrcOf(entry) && !missing && (
          <img
            src={thumbSrcOf(entry)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        )}
      </div>

      {/* Title + channel */}
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-13 font-semibold ${
            isActive ? "text-ice" : "text-ink"
          }`}
        >
          {entry.title}
          {missing && (
            <span className="ml-2 rounded-full border border-amber/50 px-1.5 py-px align-middle font-mono text-11 font-normal uppercase tracking-wide text-amber">
              missing
            </span>
          )}
        </p>
        <p className="truncate text-12 text-mute">{entry.channel ?? "—"}</p>
      </div>

      {/* Duration */}
      <span className="w-12 shrink-0 text-right font-mono text-12 tabular-nums text-mute">
        {fmtDuration(entry.durationS) ?? "—"}
      </span>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
        <FavouriteButton entryId={entry.id} />
        <button
          aria-label="Rename"
          title="Rename"
          onClick={() =>
            useRenameStore
              .getState()
              .open({
                id: entry.id,
                title: entry.title,
                artists: parseArtists(entry.channel),
              })
          }
          className="grid h-7 w-7 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
        >
          <PencilSimple size={14} weight="light" aria-hidden />
        </button>
        {!missing && <AddToPlaylistMenu downloadId={entry.id} />}
        <button
          aria-label="Reveal in file manager"
          title="Reveal"
          disabled={missing}
          onClick={() =>
            void ipc
              .revealPath(entry.path)
              .catch((e) => pushToast(`Reveal failed — ${String(e)}`))
          }
          className="grid h-7 w-7 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
        >
          <FolderOpen size={14} weight="light" aria-hidden />
        </button>
        {onRemoveFrom ? (
          <button
            aria-label="Remove from playlist"
            title="Remove from playlist"
            onClick={async () => {
              const ok = await confirm({
                title: "Remove from playlist?",
                message: `Removes “${entry.title}” from this playlist (file stays in your library).`,
                confirmLabel: "Remove",
              });
              if (ok) onRemoveFrom();
            }}
            className="grid h-7 w-7 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-signal hover:text-void active:scale-[0.98]"
          >
            <X size={14} weight="light" aria-hidden />
          </button>
        ) : (
          <button
            aria-label="Delete entry and file"
            title="Delete"
            onClick={() => void onDelete()}
            className="grid h-7 w-7 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-signal hover:text-void active:scale-[0.98]"
          >
            <Trash size={14} weight="light" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
