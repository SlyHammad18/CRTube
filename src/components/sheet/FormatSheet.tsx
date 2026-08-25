import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowClockwise,
  DownloadSimple,
  FileAudio,
  FileVideo,
  FolderOpen,
  X,
} from "@phosphor-icons/react";
import { useSheetStore } from "../../stores/sheet";
import { useSettingsStore } from "../../stores/settings";
import { useQueueStore } from "../../stores/queue";
import { ipc, type AudioQualityPref, type DownloadKind } from "../../lib/ipc";
import { fmtBytes, fmtDuration } from "../../lib/format";
import { Toggle } from "../common/Toggle";
import type { FormatInfo } from "../../types/search";

const CONTAINER_ORDER = ["mp4", "webm", "mkv"] as const;

function watchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function TabPill({
  active,
  onClick,
  icon: Icon,
  label,
  layoutId,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FileVideo;
  label: string;
  layoutId: string;
}) {
  const reduce = useReducedMotion();
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-13 font-semibold transition-colors duration-150 ${
        active ? "text-void" : "text-mute hover:text-ink"
      }`}
    >
      {active && (
        <motion.span
          layoutId={layoutId}
          transition={
            reduce
              ? { duration: 0 }
              : { type: "spring", stiffness: 300, damping: 22 }
          }
          className="absolute inset-0 rounded-full bg-ice"
        />
      )}
      <Icon size={15} weight="bold" className="relative" aria-hidden />
      <span className="relative">{label}</span>
    </button>
  );
}

function FormatRow({
  selected,
  onSelect,
  children,
  ariaLabel,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  ariaLabel: string;
}) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      aria-label={ariaLabel}
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 rounded-card border px-3 py-2.5 text-left transition-colors duration-150 active:scale-[0.99] ${
        selected
          ? "border-ice bg-raise"
          : "border-line hover:bg-raise hover:border-mute"
      }`}
    >
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          selected ? "border-ice" : "border-dim"
        }`}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-ice" />}
      </span>
      {children}
    </button>
  );
}

function Chip({ children, tone = "mute" }: { children: ReactNode; tone?: "mute" | "amber" | "ink" }) {
  const cls =
    tone === "amber"
      ? "border-amber text-amber"
      : tone === "ink"
        ? "border-ink text-ink"
        : "border-line text-mute";
  return (
    <span className={`rounded-full border px-1.5 py-px font-mono text-11 leading-tight ${cls}`}>
      {children}
    </span>
  );
}

function VideoTab({
  formats,
  container,
  setContainer,
  height,
  setHeight,
}: {
  formats: FormatInfo[];
  container: string;
  setContainer: (c: string) => void;
  height: number | null;
  setHeight: (h: number) => void;
}) {
  const containers = CONTAINER_ORDER.filter((c) =>
    formats.some((f) => f.ext === c),
  );
  const rows = formats.filter((f) => f.ext === container);

  if (!formats.length) {
    return (
      <p className="py-8 text-center font-mono text-13 text-mute">
        {"> no video formats in source — try MP3"}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {containers.length > 1 && (
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-12 text-dim">container:</span>
          {containers.map((c) => (
            <button
              key={c}
              onClick={() => setContainer(c)}
              aria-pressed={container === c}
              className={`rounded-full border px-2.5 py-0.5 font-mono text-12 transition-colors duration-150 active:scale-[0.98] ${
                container === c
                  ? "border-ice bg-ice text-void"
                  : "border-line text-mute hover:bg-raise hover:text-ink"
              }`}
            >
              ({c})
            </button>
          ))}
        </div>
      )}
      <div role="radiogroup" aria-label="Video quality" className="flex flex-col gap-1.5">
        {rows.map((f) => (
          <FormatRow
            key={`${f.height}-${f.ext}`}
            selected={f.height === height}
            onSelect={() => f.height != null && setHeight(f.height)}
            ariaLabel={`${f.height}p ${f.ext}`}
          >
            <Chip tone="ink">{f.height}p</Chip>
            {f.fps != null && f.fps > 30 && <Chip>{f.fps}fps</Chip>}
            {f.dynamicRange && <Chip tone="amber">{f.dynamicRange}</Chip>}
            <span className="ml-auto font-mono text-12 text-mute">
              {fmtBytes(f.filesize) ?? "—"}
            </span>
          </FormatRow>
        ))}
      </div>
    </div>
  );
}

function AudioTab({
  quality,
  setQuality,
  embedThumb,
  setEmbedThumb,
  embedMeta,
  setEmbedMeta,
}: {
  quality: AudioQualityPref;
  setQuality: (q: AudioQualityPref) => void;
  embedThumb: boolean;
  setEmbedThumb: (v: boolean) => void;
  embedMeta: boolean;
  setEmbedMeta: (v: boolean) => void;
}) {
  const options: { id: AudioQualityPref; label: string; hint: string }[] = [
    { id: "best", label: "Best", hint: "≈ V0 / 320 kbps" },
    { id: "192", label: "192", hint: "high" },
    { id: "128", label: "128", hint: "compact" },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="Audio quality" className="flex flex-col gap-1.5">
        {options.map((o) => (
          <FormatRow
            key={o.id}
            selected={quality === o.id}
            onSelect={() => setQuality(o.id)}
            ariaLabel={`${o.label} kbps`}
          >
            <span className="font-mono text-13 text-ink">{o.label}</span>
            <span className="ml-auto font-mono text-12 text-dim">{o.hint}</span>
          </FormatRow>
        ))}
      </div>
      <div className="mt-2 flex flex-col gap-2.5 border-t border-line pt-3">
        <div className="flex items-center justify-between">
          <span className="text-13 text-mute">Embed cover art</span>
          <Toggle checked={embedThumb} onChange={setEmbedThumb} label="Embed cover art" />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-13 text-mute">Embed metadata</span>
          <Toggle checked={embedMeta} onChange={setEmbedMeta} label="Embed metadata" />
        </div>
      </div>
    </div>
  );
}

function SheetSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-11 animate-pulse rounded-card bg-raise" />
      ))}
    </div>
  );
}

export function FormatSheet() {
  const open = useSheetStore((s) => s.open);
  const prefill = useSheetStore((s) => s.prefill);
  const info = useSheetStore((s) => s.info);
  const loading = useSheetStore((s) => s.loading);
  const error = useSheetStore((s) => s.error);
  const retry = useSheetStore((s) => s.retry);
  const close = useSheetStore((s) => s.close);

  const settings = useSettingsStore((s) => s.settings);
  const setDownloadDir = useSettingsStore((s) => s.setDownloadDir);
  const reduce = useReducedMotion();

  const [tab, setTab] = useState<DownloadKind>("video");
  const [container, setContainer] = useState("mp4");
  const [height, setHeight] = useState<number | null>(null);
  const [quality, setQuality] = useState<AudioQualityPref>("best");
  const [embedThumb, setEmbedThumb] = useState(true);
  const [embedMeta, setEmbedMeta] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const videoFormats = (info?.formats ?? []).filter((f) => f.height != null);

  useEffect(() => {
    if (!info) return;
    const containers = CONTAINER_ORDER.filter((c) =>
      videoFormats.some((f) => f.ext === c),
    );
    const first = containers[0];
    setContainer(first ?? "mp4");
    setHeight(videoFormats.find((f) => f.ext === first)?.height ?? null);
    setTab(videoFormats.length ? "video" : "audio");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.videoId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const title = prefill?.title ?? info?.title ?? "Loading…";
  const channel = prefill?.channel ?? info?.channel;
  const duration = fmtDuration(info?.durationS ?? prefill?.durationS);
  const thumb = prefill?.thumbUrl ?? info?.thumbUrl;

  const onDownload = async () => {
    const videoId = prefill?.videoId ?? info?.videoId;
    if (!videoId || !title || submitting) return;
    const selectedRow = videoFormats.find(
      (f) => f.height === height && f.ext === container,
    );
    const audioRows = info?.formats.filter((f) => f.height == null) ?? [];
    const bestAudioSize = Math.max(0, ...audioRows.map((f) => f.filesize ?? 0));
    const expectedSize =
      tab === "video"
        ? (selectedRow?.filesize ?? 0) + bestAudioSize > 0
          ? (selectedRow?.filesize ?? 0) + bestAudioSize
          : undefined
        : bestAudioSize > 0
          ? bestAudioSize
          : undefined;
    setSubmitting(true);
    try {
      useQueueStore.getState().enqueue({
        url: watchUrl(videoId),
        kind: tab,
        videoId,
        title,
        channel,
        durationS: info?.durationS ?? prefill?.durationS,
        container: tab === "video" ? container : undefined,
        height: tab === "video" ? (height ?? undefined) : undefined,
        quality: tab === "audio" ? quality : undefined,
        thumbUrl: info?.thumbUrl ?? prefill?.thumbUrl,
        downloadDir: settings?.download_dir,
        embedThumbnail: tab === "audio" ? embedThumb : true,
        embedMetadata: tab === "audio" ? embedMeta : true,
        expectedSize,
      });
      close();
    } finally {
      setSubmitting(false);
    }
  };

  const onPickFolder = async () => {
    const dir = await ipc.pickFolder();
    if (dir) await setDownloadDir(dir);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="format-sheet"
          role="dialog"
          aria-label="Download options"
          className="fixed bottom-0 right-0 top-10 z-40 flex w-[420px] max-w-full flex-col border-l border-line bg-panel shadow-panel"
          initial={reduce ? { opacity: 0 } : { x: "100%" }}
          animate={reduce ? { opacity: 1 } : { x: 0 }}
          exit={reduce ? { opacity: 0 } : { x: "100%" }}
          transition={
            reduce
              ? { duration: 0.01 }
              : { type: "spring", stiffness: 380, damping: 34 }
          }
        >
          <div className="flex items-start gap-3 border-b border-line p-4">
            <div className="h-[54px] w-[96px] shrink-0 overflow-hidden rounded-card bg-raise">
              {thumb && (
                <img src={thumb} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-2 text-15 font-semibold leading-snug text-ink">
                {title}
              </h2>
              <p className="mt-0.5 truncate text-12 text-mute">
                {channel ?? "—"}
                {duration && (
                  <span className="font-mono text-dim"> · {duration}</span>
                )}
              </p>
            </div>
            <button
              aria-label="Close"
              onClick={close}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-card text-dim transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
            >
              <X size={16} weight="light" aria-hidden />
            </button>
          </div>

          <div className="border-b border-line p-4 pb-3">
            <div
              role="tablist"
              aria-label="Download type"
              className="flex rounded-full border border-line bg-void p-1"
            >
              <TabPill
                active={tab === "video"}
                onClick={() => setTab("video")}
                icon={FileVideo}
                label="MP4"
                layoutId="sheet-seg"
              />
              <TabPill
                active={tab === "audio"}
                onClick={() => setTab("audio")}
                icon={FileAudio}
                label="MP3"
                layoutId="sheet-seg"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {loading && <SheetSkeleton />}
            {!loading && error && (
              <div className="flex flex-col items-center gap-3 py-8">
                <p className="break-all text-center font-mono text-12 text-signal">
                  {"> probe failed"} — {error}
                </p>
                <button
                  onClick={retry}
                  className="flex items-center gap-2 rounded-card border border-line px-3 py-1.5 text-13 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
                >
                  <ArrowClockwise size={14} weight="light" aria-hidden />
                  Retry
                </button>
              </div>
            )}
            {!loading && !error && info && (
              <>
                {tab === "video" ? (
                  <VideoTab
                    formats={videoFormats}
                    container={container}
                    setContainer={setContainer}
                    height={height}
                    setHeight={setHeight}
                  />
                ) : (
                  <AudioTab
                    quality={quality}
                    setQuality={setQuality}
                    embedThumb={embedThumb}
                    setEmbedThumb={setEmbedThumb}
                    embedMeta={embedMeta}
                    setEmbedMeta={setEmbedMeta}
                  />
                )}
              </>
            )}
          </div>

          <div className="border-t border-line p-4">
            <button
              onClick={() => void onPickFolder()}
              aria-label="Change download folder"
              className="mb-3 flex w-full items-center gap-2 rounded-card border border-line px-3 py-2 text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.99]"
            >
              <FolderOpen size={15} weight="light" className="shrink-0" aria-hidden />
              <span className="truncate font-mono" title={settings?.download_dir}>
                {settings?.download_dir ?? "…"}
              </span>
            </button>
            <button
              onClick={() => void onDownload()}
              disabled={loading || !info || submitting}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-card bg-ice text-14 font-semibold text-void transition-colors duration-150 hover:bg-ink active:scale-[0.98] disabled:pointer-events-none disabled:border disabled:border-line disabled:bg-transparent disabled:text-dim"
            >
              <DownloadSimple size={17} weight="bold" aria-hidden />
              {submitting ? "Queuing…" : "DOWNLOAD"}
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
