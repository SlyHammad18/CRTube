import { useEffect, useRef, useState } from "react";
import {
  Check,
  Heart,
  ListPlus,
  Pause,
  Play,
  Plus,
  Repeat,
  RepeatOnce,
  Shuffle,
  SkipBack,
  SkipForward,
  SpeakerHigh,
  SpeakerSlash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { ipc, type MprisCommand } from "../../lib/ipc";
import { fmtDuration } from "../../lib/format";
import type { Playlist } from "../../types/player";
import type { LyricsOverlaySnapshot } from "../../types/lyricsOverlay";

/** Compact transport and library controls for the floating lyrics window. */
export function OverlayControls({
  snapshot,
  positionS,
}: {
  snapshot: LyricsOverlaySnapshot | null;
  positionS: number;
}) {
  const entryId = snapshot?.entry.id ?? 0;
  const [pending, setPending] = useState<MprisCommand["action"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [favourite, setFavourite] = useState(snapshot?.entry.favourite ?? false);
  const [favouritePending, setFavouritePending] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [memberships, setMemberships] = useState<Record<number, number>>({});
  const [playlistLoading, setPlaylistLoading] = useState(false);
  const [playlistPending, setPlaylistPending] = useState<number | null>(null);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [seekOverride, setSeekOverride] = useState<number | null>(null);

  useEffect(() => {
    setFavourite(snapshot?.entry.favourite ?? false);
    setPlaylistOpen(false);
    setPlaylistError(null);
    setError(null);
    setSeekOverride(null);
  }, [entryId]);

  useEffect(() => {
    if (seekOverride == null) return;
    if (Math.abs(positionS - seekOverride) <= 0.75) {
      setSeekOverride(null);
    }
  }, [positionS, seekOverride]);

  useEffect(() => {
    if (seekOverride == null) return;
    const timeout = window.setTimeout(() => setSeekOverride(null), 2000);
    return () => window.clearTimeout(timeout);
  }, [seekOverride]);

  useEffect(() => {
    if (!playlistOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPlaylistOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playlistOpen]);

  if (!snapshot) return null;

  const runCommand = async (
    action: MprisCommand["action"],
    value?: number,
  ): Promise<boolean> => {
    if (pending) return false;
    setPending(action);
    setError(null);
    try {
      await ipc.mprisCommand(action, value);
      return true;
    } catch {
      setError("control unavailable");
      return false;
    } finally {
      setPending(null);
    }
  };

  const toggleFavourite = async () => {
    if (favouritePending) return;
    const next = !favourite;
    setFavourite(next);
    setFavouritePending(true);
    setError(null);
    try {
      await ipc.setFavourite(entryId, next);
    } catch {
      setFavourite(!next);
      setError("favourite update failed");
    } finally {
      setFavouritePending(false);
    }
  };

  const loadPlaylists = async () => {
    setPlaylistLoading(true);
    setPlaylistError(null);
    try {
      const [nextPlaylists, rows] = await Promise.all([
        ipc.listPlaylists(),
        ipc.listPlaylistMemberships(),
      ]);
      const nextMemberships: Record<number, number> = {};
      for (const [playlistId, downloadId, itemId] of rows) {
        if (downloadId === entryId) nextMemberships[playlistId] = itemId;
      }
      setPlaylists(nextPlaylists);
      setMemberships(nextMemberships);
    } catch {
      setPlaylistError("playlist update failed");
    } finally {
      setPlaylistLoading(false);
    }
  };

  const togglePlaylist = async (playlist: Playlist) => {
    if (playlistPending !== null) return;
    const itemId = memberships[playlist.id];
    setPlaylistPending(playlist.id);
    setPlaylistError(null);
    try {
      if (itemId != null) {
        if (!window.confirm(`Remove this track from “${playlist.name}”?`)) return;
        await ipc.removePlaylistItem(itemId);
        setMemberships((current) => {
          const next = { ...current };
          delete next[playlist.id];
          return next;
        });
      } else {
        const nextItemId = await ipc.addPlaylistItem(playlist.id, entryId);
        setMemberships((current) => ({ ...current, [playlist.id]: nextItemId }));
      }
    } catch {
      setPlaylistError("playlist update failed");
    } finally {
      setPlaylistPending(null);
    }
  };

  const createAndAddPlaylist = async () => {
    const name = newPlaylistName.trim();
    if (!name || creatingPlaylist) return;
    setCreatingPlaylist(true);
    setPlaylistError(null);
    try {
      const playlist = await ipc.createPlaylist(name);
      const itemId = await ipc.addPlaylistItem(playlist.id, entryId);
      setPlaylists((current) => [playlist, ...current]);
      setMemberships((current) => ({ ...current, [playlist.id]: itemId }));
      setNewPlaylistName("");
    } catch {
      setPlaylistError("playlist update failed");
    } finally {
      setCreatingPlaylist(false);
    }
  };

  const controlsDisabled = pending !== null || favouritePending;
  const repeatLabel =
    snapshot.repeat === "off"
      ? "Repeat off"
      : snapshot.repeat === "all"
        ? "Repeat all"
        : "Repeat one";
  const displayPositionS = seekOverride ?? positionS;
  const seekToPosition = async (seconds: number): Promise<boolean> => {
    setSeekOverride(seconds);
    const ok = await runCommand("seek", seconds);
    if (!ok) setSeekOverride(null);
    return ok;
  };

  return (
    <>
      <OverlaySeekBar
        snapshot={snapshot}
        positionS={displayPositionS}
        disabled={controlsDisabled}
        onSeek={seekToPosition}
      />
      <div className="relative flex h-10 shrink-0 items-center gap-1 border-t border-line px-2 py-1 font-mono text-11 text-mute">
        <span className="w-20 shrink-0 text-left tabular-nums text-mute">
          {fmtDuration(displayPositionS) ?? "0:00"} / {fmtDuration(snapshot.entry.durationS) ?? "—"}
        </span>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5">
        <ControlButton
          label="Shuffle"
          active={snapshot.shuffle}
          disabled={controlsDisabled}
          onClick={() => void runCommand("toggle_shuffle")}
        >
          <Shuffle size={14} weight="light" aria-hidden />
        </ControlButton>
        <ControlButton
          label="Previous track"
          disabled={controlsDisabled || !snapshot.canPrevious}
          onClick={() => void runCommand("previous")}
        >
          <SkipBack size={14} weight="light" aria-hidden />
        </ControlButton>
        <ControlButton
          label={snapshot.playing ? "Pause" : "Play"}
          active={snapshot.playing}
          emphasis
          disabled={controlsDisabled}
          onClick={() => void runCommand(snapshot.playing ? "pause" : "play")}
        >
          {snapshot.playing ? (
            <Pause size={14} weight="fill" aria-hidden />
          ) : (
            <Play size={14} weight="fill" aria-hidden />
          )}
        </ControlButton>
        <ControlButton
          label="Next track"
          disabled={controlsDisabled || !snapshot.canNext}
          onClick={() => void runCommand("next")}
        >
          <SkipForward size={14} weight="light" aria-hidden />
        </ControlButton>
        <ControlButton
          label={repeatLabel}
          active={snapshot.repeat !== "off"}
          disabled={controlsDisabled}
          onClick={() => void runCommand("cycle_repeat")}
        >
          {snapshot.repeat === "one" ? (
            <RepeatOnce size={14} weight="light" aria-hidden />
          ) : (
            <Repeat size={14} weight="light" aria-hidden />
          )}
        </ControlButton>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <ControlButton
          label={favourite ? "Remove from Favourites" : "Add to Favourites"}
          active={favourite}
          tone="signal"
          disabled={controlsDisabled}
          onClick={() => void toggleFavourite()}
        >
          <Heart size={14} weight={favourite ? "fill" : "light"} aria-hidden />
        </ControlButton>
        <div className="relative">
          <ControlButton
            label="Add to playlist"
            active={playlistOpen}
            disabled={controlsDisabled}
            onClick={() => {
              setPlaylistOpen((open) => !open);
              if (!playlistOpen) void loadPlaylists();
            }}
          >
            <ListPlus size={14} weight="light" aria-hidden />
          </ControlButton>
          {playlistOpen && (
            <PlaylistMenu
              playlists={playlists}
              memberships={memberships}
              loading={playlistLoading}
              pending={playlistPending}
              error={playlistError}
              newPlaylistName={newPlaylistName}
              creating={creatingPlaylist}
              onNameChange={setNewPlaylistName}
              onToggle={(playlist) => void togglePlaylist(playlist)}
              onCreate={() => void createAndAddPlaylist()}
              onClose={() => setPlaylistOpen(false)}
            />
          )}
        </div>
        <ControlButton
          label={snapshot.muted || snapshot.volume <= 0 ? "Unmute" : "Mute"}
          active={snapshot.muted || snapshot.volume <= 0}
          disabled={controlsDisabled}
          onClick={() => void runCommand("toggle_mute")}
        >
          {snapshot.muted || snapshot.volume <= 0 ? (
            <SpeakerSlash size={14} weight="light" aria-hidden />
          ) : (
            <SpeakerHigh size={14} weight="light" aria-hidden />
          )}
        </ControlButton>
        {error || playlistError ? (
          <WarningCircle size={13} weight="light" className="text-signal" aria-label="Control error" />
        ) : null}
      </div>
      </div>
    </>
  );
}

function OverlaySeekBar({
  snapshot,
  positionS,
  disabled,
  onSeek,
}: {
  snapshot: LyricsOverlaySnapshot | null;
  positionS: number;
  disabled: boolean;
  onSeek: (seconds: number) => Promise<boolean>;
}) {
  const durationS = snapshot?.entry.durationS ?? 0;
  const trackId = snapshot?.entry.id ?? 0;
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragValueRef = useRef<number | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [gripping, setGripping] = useState(false);

  useEffect(() => {
    dragging.current = false;
    dragValueRef.current = null;
    setDragValue(null);
    setGripping(false);
  }, [trackId]);

  const value = clampSeekValue(dragValue ?? positionS, durationS);
  const progress = durationS > 0 ? value / durationS : 0;

  const setPreview = (next: number) => {
    const clamped = clampSeekValue(next, durationS);
    dragValueRef.current = clamped;
    setDragValue(clamped);
  };

  const seekToClientX = (clientX: number) => {
    const bar = barRef.current;
    if (!bar || durationS <= 0) return;
    const rect = bar.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setPreview(fraction * durationS);
  };

  const commit = () => {
    const next = dragValueRef.current;
    if (next == null) return;
    dragValueRef.current = null;
    setDragValue(null);
    void onSeek(next);
  };

  const keyboardStep = (key: string): number | null => {
    const current = dragValueRef.current ?? positionS;
    if (key === "ArrowLeft" || key === "ArrowDown") return current - 5;
    if (key === "ArrowRight" || key === "ArrowUp") return current + 5;
    if (key === "Home") return 0;
    if (key === "End") return durationS;
    return null;
  };

  return (
    <div className="shrink-0 px-3 py-1">
      <div
        ref={barRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationS)}
        aria-valuenow={Math.round(value)}
        aria-valuetext={`${fmtDuration(value) ?? "0:00"} of ${fmtDuration(durationS) ?? "—"}`}
        aria-disabled={disabled}
        onPointerDown={(event) => {
          if (disabled) return;
          // Prevent pointer interaction from focusing the slider; keyboard
          // focus remains available through the native tab order.
          event.preventDefault();
          dragging.current = true;
          setGripping(true);
          event.currentTarget.setPointerCapture?.(event.pointerId);
          seekToClientX(event.clientX);
        }}
        onPointerMove={(event) => {
          if (dragging.current) seekToClientX(event.clientX);
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return;
          dragging.current = false;
          setGripping(false);
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          commit();
        }}
        onPointerCancel={() => {
          dragging.current = false;
          dragValueRef.current = null;
          setDragValue(null);
          setGripping(false);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          const next = keyboardStep(event.key);
          if (next == null) return;
          event.preventDefault();
          setPreview(next);
        }}
        onKeyUp={(event) => {
          if (keyboardStep(event.key) != null) commit();
        }}
        className={`group relative flex h-4 items-center rounded-card ${
          disabled ? "cursor-default opacity-50" : "cursor-pointer"
        }`}
      >
        <div className="h-[2px] w-full rounded-full bg-line transition-[height] duration-150 group-hover:h-1">
          <div
            className="h-full origin-left rounded-full bg-ice transition-[width] duration-150"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <div
          aria-hidden
          className={`pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-ice transition-[left,opacity,scale] duration-150 ${
            gripping
              ? "scale-100 opacity-100"
              : "scale-75 opacity-0 group-hover:scale-100 group-hover:opacity-100"
          }`}
          style={{ left: `calc(${progress * 100}% - 5px)` }}
        />
      </div>
    </div>
  );
}

function clampSeekValue(value: number, durationS: number): number {
  if (!Number.isFinite(value) || durationS <= 0) return 0;
  return Math.min(durationS, Math.max(0, value));
}

function ControlButton({
  label,
  active = false,
  emphasis = false,
  tone = "ice",
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  emphasis?: boolean;
  tone?: "ice" | "signal";
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-card transition-[transform,background-color,color,opacity] duration-150 active:scale-[0.98] ${
        disabled
          ? "pointer-events-none opacity-40"
          : emphasis
            ? active
              ? "bg-ice text-void"
              : "bg-raise text-ink hover:bg-ice hover:text-void"
            : active
              ? tone === "signal"
                ? "text-signal hover:bg-signal/15"
                : "text-ice hover:bg-raise"
              : "text-mute hover:bg-raise hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function PlaylistMenu({
  playlists,
  memberships,
  loading,
  pending,
  error,
  newPlaylistName,
  creating,
  onNameChange,
  onToggle,
  onCreate,
  onClose,
}: {
  playlists: Playlist[];
  memberships: Record<number, number>;
  loading: boolean;
  pending: number | null;
  error: string | null;
  newPlaylistName: string;
  creating: boolean;
  onNameChange: (value: string) => void;
  onToggle: (playlist: Playlist) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute bottom-9 right-0 z-50 w-52 overflow-hidden rounded-card border border-line bg-panel p-1 shadow-panel">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="font-mono text-11 text-dim">playlists</span>
        <button
          type="button"
          aria-label="Close playlist menu"
          onClick={onClose}
          className="grid h-6 w-6 place-items-center rounded-card text-dim hover:bg-raise hover:text-ink"
        >
          <X size={12} weight="light" aria-hidden />
        </button>
      </div>
      <div className="max-h-36 overflow-y-auto">
        {loading && <p className="px-2 py-1.5 text-12 text-dim">loading playlists…</p>}
        {!loading && playlists.length === 0 && (
          <p className="px-2 py-1.5 text-12 text-dim">no playlists yet</p>
        )}
        {!loading &&
          playlists.map((playlist) => {
            const selected = memberships[playlist.id] != null;
            return (
              <button
                key={playlist.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={selected}
                disabled={pending !== null}
                onClick={() => onToggle(playlist)}
                className="flex w-full items-center gap-2 rounded-card px-2 py-1.5 text-left text-12 text-ink transition-colors duration-150 hover:bg-raise disabled:opacity-40"
              >
                <span
                  className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border ${
                    selected ? "border-ice bg-ice text-void" : "border-line text-transparent"
                  }`}
                  aria-hidden
                >
                  <Check size={10} weight="bold" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                {pending === playlist.id && <span className="font-mono text-11">…</span>}
              </button>
            );
          })}
      </div>
      <div className="border-t border-line p-1">
        {error && <p className="px-1 pb-1 text-11 text-signal">update failed</p>}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onCreate();
          }}
          className="flex items-center gap-1"
        >
          <input
            value={newPlaylistName}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="New playlist…"
            aria-label="New playlist name"
            disabled={creating}
            className="h-7 min-w-0 flex-1 rounded-card border border-line bg-raise px-2 text-12 text-ink outline-none placeholder:text-dim focus:border-ice disabled:opacity-40"
          />
          <button
            type="submit"
            aria-label="Create playlist and add track"
            disabled={creating || !newPlaylistName.trim()}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-card bg-ice text-void disabled:opacity-40"
          >
            <Plus size={12} weight="bold" aria-hidden />
          </button>
        </form>
      </div>
    </div>
  );
}
