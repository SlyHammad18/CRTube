import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, MonitorPlay, MusicNote, Plus } from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { usePlaylistsStore } from "../../stores/playlists";
import { useLibraryStore } from "../../stores/library";
import { useQueueStore } from "../../stores/queue";
import { useSettingsStore } from "../../stores/settings";
import { pushToast } from "../../stores/toast";
import { confirm } from "../../stores/confirm";
import { buildDownloadRequest } from "../../lib/download";

/**
 * What the `＋` action targets: a track already in the library (plain add /
 * remove) or a YouTube result not yet downloaded (adding it auto-downloads —
 * the user picks MP3 audio or video, and the finished download joins the
 * playlist automatically).
 */
export type AddToPlaylistTarget =
  | { type: "library"; downloadId: number; title: string }
  | {
      type: "stream";
      videoId: string;
      title: string;
      channel?: string;
      durationS?: number;
      thumbUrl?: string;
    };

/** Audio quality choices (mirrors the Format Sheet's MP3 tab). */
const AUDIO_QUALITIES: { label: string; hint: string; quality: "best" | "192" | "128" }[] = [
  { label: "Best", hint: "≈ 320 kbps", quality: "best" },
  { label: "192", hint: "192 kbps", quality: "192" },
  { label: "128", hint: "128 kbps", quality: "128" },
];

/** Video height choices (MP4). */
const VIDEO_HEIGHTS = [1080, 720, 480] as const;

/**
 * `＋` row action → popover listing playlists with membership checkmarks.
 * Clicking a checked playlist removes the track (backend dedupe makes
 * double-adds impossible either way); for stream targets it opens a
 * download-format choice (MP3 audio / video), then queues the download with
 * the playlist attached — the queue store adds it when the download finishes.
 * Inline composer creates + adds.
 */
export function AddToPlaylistMenu({ target }: { target: AddToPlaylistTarget }) {
  const playlists = usePlaylistsStore((s) => s.playlists);
  const downloadId = target.type === "library" ? target.downloadId : null;
  const membershipForTrack = usePlaylistsStore(useShallow((s) => {
    const m = s.members;
    const result: Record<number, number | undefined> = {};
    if (downloadId == null) return result;
    for (const playlistId of Object.keys(m)) {
      result[Number(playlistId)] = m[Number(playlistId)]?.[downloadId];
    }
    return result;
  }));
  const addTo = usePlaylistsStore((s) => s.addTo);
  const removeFrom = usePlaylistsStore((s) => s.removeFrom);
  const create = usePlaylistsStore((s) => s.create);
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  /** Stream mode: the playlist awaiting the download-format choice. */
  const [picked, setPicked] = useState<{ id: number; name: string } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);

  const place = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight ?? 240;
    const flipDown = r.top < menuH + 8;
    const top = flipDown ? r.bottom + 4 : r.top - menuH - 4;
    const right = window.innerWidth - r.right;
    setCoords({ top, right });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open, composing, picked]);

  useEffect(() => {
    if (!open) return;
    const onScrollResize = () => place();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const act = (fn: () => Promise<unknown>) => {
    void fn()
      .then(() => setOpen(false))
      .catch((e: unknown) => pushToast(`Playlist update failed — ${String(e)}`));
  };

  /**
   * Stream mode: add the track to the playlist at the chosen quality,
   * downloading it first when needed. Already-downloaded matches attach
   * instantly; the queue store completes the add when a fresh download lands.
   */
  const addStreamWithFormat = (
    playlist: { id: number; name: string },
    choice: { kind: "audio"; quality: "best" | "192" | "128" } | { kind: "video"; height: number },
  ) => {
    if (target.type !== "stream") return;
    const existing = useLibraryStore
      .getState()
      .entries.find((e) => e.videoId === target.videoId && e.status !== "missing");
    if (existing && !(choice.kind === "video" && existing.kind !== "video")) {
      act(() => addTo(playlist.id, existing.id));
      return;
    }
    if (existing) {
      // Only an audio copy exists locally; a video add needs the download.
      act(async () => {
        await addTo(playlist.id, existing.id);
        pushToast(`Downloading video — “${target.title}” stays as audio for now`);
      });
      return;
    }
    const downloadDir = useSettingsStore.getState().settings?.download_dir;
    const request = buildDownloadRequest({
      videoId: target.videoId,
      title: target.title,
      channel: target.channel,
      durationS: target.durationS,
      thumbUrl: target.thumbUrl,
      info: null,
      downloadDir,
      choice:
        choice.kind === "audio"
          ? {
              kind: "audio",
              quality: choice.quality,
              embedThumbnail: true,
              embedMetadata: true,
            }
          : { kind: "video", container: "mp4", height: choice.height },
    });
    useQueueStore.getState().enqueue(request, { addToPlaylist: playlist.id });
    pushToast(`Downloading — will be added to “${playlist.name}”`);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        aria-label="Add to playlist"
        title="Add to playlist"
        onClick={() => setOpen((v) => !v)}
        className="grid h-7 w-7 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
      >
        <Plus size={14} weight="light" aria-hidden />
      </button>
      {open &&
        createPortal(
          <>
            <button
              aria-label="Close add-to-playlist menu"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div
              ref={menuRef}
              role="menu"
              aria-label="Playlists"
              style={
                coords
                  ? { position: "fixed", top: coords.top, right: coords.right, zIndex: 50 }
                  : { position: "fixed", visibility: "hidden" }
              }
              className="w-56 rounded-card border border-line bg-panel p-1 shadow-panel"
            >
              {picked ? (
                <>
                  <button
                    role="menuitem"
                    onClick={() => setPicked(null)}
                    className="flex w-full items-center gap-2 rounded-card px-2.5 py-1.5 text-left text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink"
                  >
                    <ArrowLeft size={12} weight="light" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      Add to “{picked.name}”
                    </span>
                  </button>
                  <div className="px-2.5 pb-1 pt-1.5">
                    <p className="flex items-center gap-1.5 font-mono text-11 uppercase tracking-wide text-dim">
                      <MusicNote size={11} weight="light" aria-hidden /> MP3 audio
                    </p>
                    <div className="mt-1 flex gap-1">
                      {AUDIO_QUALITIES.map((q) => (
                        <button
                          key={q.quality}
                          role="menuitem"
                          title={`Download MP3 (${q.hint}) and add to playlist`}
                          onClick={() => addStreamWithFormat(picked, { kind: "audio", quality: q.quality })}
                          className="flex-1 rounded-full border border-line px-2 py-1 text-center text-12 text-mute transition-colors duration-150 hover:border-ice hover:bg-raise hover:text-ink active:scale-[0.98]"
                        >
                          {q.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-line px-2.5 pb-1.5 pt-2">
                    <p className="flex items-center gap-1.5 font-mono text-11 uppercase tracking-wide text-dim">
                      <MonitorPlay size={11} weight="light" aria-hidden /> Video MP4
                    </p>
                    <div className="mt-1 flex gap-1">
                      {VIDEO_HEIGHTS.map((h) => (
                        <button
                          key={h}
                          role="menuitem"
                          title={`Download ${h}p MP4 and add to playlist`}
                          onClick={() => addStreamWithFormat(picked, { kind: "video", height: h })}
                          className="flex-1 rounded-full border border-line px-2 py-1 text-center font-mono text-12 text-mute transition-colors duration-150 hover:border-ice hover:bg-raise hover:text-ink active:scale-[0.98]"
                        >
                          {h}p
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {playlists.length === 0 && !composing && (
                    <p className="px-2.5 py-2 font-mono text-12 text-dim">
                      no playlists yet
                    </p>
                  )}
                  {playlists.map((p) => {
                    const itemId = membershipForTrack[p.id];
                    return (
                      <button
                        key={p.id}
                        role="menuitem"
                        onClick={async () => {
                          if (target.type === "stream") {
                            setPicked({ id: p.id, name: p.name });
                            return;
                          }
                          if (itemId != null) {
                            const ok = await confirm({
                              title: "Remove from playlist?",
                              message: `Removes this track from “${p.name}” (file stays in your library).`,
                              confirmLabel: "Remove",
                            });
                            if (ok) act(() => removeFrom(p.id, itemId));
                          } else {
                            act(() => addTo(p.id, target.downloadId));
                          }
                        }}
                        className="flex w-full items-center gap-2 rounded-card px-2.5 py-1.5 text-left transition-colors duration-150 hover:bg-raise"
                      >
                        <span
                          className={`grid h-4 w-4 shrink-0 place-items-center rounded-sm border ${
                            itemId != null
                              ? "border-ice bg-ice text-void"
                              : "border-line text-transparent"
                          }`}
                        >
                          <Check size={10} weight="bold" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-13 text-ink">
                          {p.name}
                        </span>
                        <span className="shrink-0 font-mono text-11 text-mute">
                          {p.trackCount}
                        </span>
                      </button>
                    );
                  })}
                  {composing ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const name = draft.trim();
                        if (!name) return;
                        setDraft("");
                        setComposing(false);
                        void (async () => {
                          try {
                            const pl = await create(name);
                            if (target.type === "stream") {
                              setPicked({ id: pl.id, name: pl.name });
                            } else {
                              await addTo(pl.id, target.downloadId);
                              setOpen(false);
                            }
                          } catch (err) {
                            pushToast(`Playlist update failed — ${String(err)}`);
                          }
                        })();
                      }}
                      className="mt-0.5 border-t border-line p-1"
                    >
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setComposing(false);
                            setDraft("");
                          }
                        }}
                        placeholder="New playlist name…"
                        spellCheck={false}
                        aria-label="New playlist name"
                        className="h-7 w-full rounded-card border border-line bg-raise px-2 text-12 text-ink outline-none focus:border-ice placeholder:text-dim"
                      />
                    </form>
                  ) : (
                    <button
                      role="menuitem"
                      onClick={() => setComposing(true)}
                      className="mt-0.5 flex w-full items-center gap-2 border-t border-line px-2.5 py-2 text-left text-13 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink"
                    >
                      <Plus size={12} weight="light" aria-hidden />
                      New playlist…
                    </button>
                  )}
                </>
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
