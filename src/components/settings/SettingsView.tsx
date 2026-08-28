import { useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  ArrowClockwise,
  FolderOpen,
  Minus,
  Plus,
} from "@phosphor-icons/react";
import { useSettingsStore } from "../../stores/settings";
import { useToolsStore } from "../../stores/tools";
import { pushToast } from "../../stores/toast";
import { ipc } from "../../lib/ipc";
import { Toggle } from "../common/Toggle";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="font-display text-15 font-semibold tracking-tight">{title}</h2>
      <div className="flex flex-col divide-y divide-line rounded-card border border-line bg-panel">
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-13 text-ink">{label}</p>
        {hint && <p className="text-12 leading-snug text-mute">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function StorageSection() {
  const settings = useSettingsStore((s) => s.settings);
  const setDownloadDir = useSettingsStore((s) => s.setDownloadDir);

  const pick = async () => {
    const dir = await ipc.pickFolder();
    if (dir) await setDownloadDir(dir);
  };

  return (
    <Section title="Storage">
      <Row label="Download folder" hint="New downloads land here">
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => void pick()}
            aria-label="Choose download folder"
            className="flex max-w-[240px] items-center gap-2 rounded-card border border-line px-3 py-1.5 font-mono text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.99]"
          >
            <FolderOpen size={14} weight="light" className="shrink-0" aria-hidden />
            <span className="truncate" title={settings?.download_dir}>
              {settings?.download_dir ?? "…"}
            </span>
          </button>
          <button
            aria-label="Open download folder"
            title="Open folder"
            disabled={!settings?.download_dir}
            onClick={() =>
              settings?.download_dir &&
              void ipc
                .openPath(settings.download_dir)
                .catch((e) => pushToast(`Open failed — ${String(e)}`))
            }
            className="grid h-8 w-8 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
          >
            <FolderOpen size={15} weight="light" aria-hidden />
          </button>
        </div>
      </Row>
    </Section>
  );
}

function EngineSection() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const ytdlpVersion = useToolsStore((s) => s.ytdlpVersion);
  const ffmpegVersion = useToolsStore((s) => s.ffmpegVersion);
  const [checking, setChecking] = useState(false);

  const checkForUpdate = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const res = await ipc.updateYtdlp(false);
      if (res.updated && res.ytdlp) {
        useToolsStore.setState({ ytdlpVersion: res.ytdlp });
        pushToast(`yt-dlp updated → ${res.ytdlp}`);
      } else {
        pushToast("yt-dlp is up to date");
      }
    } catch (e) {
      pushToast(`Update check failed — ${String(e)}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Section title="Engine">
      <Row label="yt-dlp" hint="Downloader engine">
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="font-mono text-12 text-mute">
            {ytdlpVersion ?? "—"}
          </span>
          <button
            onClick={() => void checkForUpdate()}
            disabled={checking}
            className="flex items-center gap-1.5 rounded-card border border-line px-2.5 py-1.5 text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
          >
            <ArrowClockwise
              size={13}
              weight="light"
              className={checking ? "animate-spin" : ""}
              aria-hidden
            />
            {checking ? "checking…" : "Check for update"}
          </button>
        </div>
      </Row>
      <Row label="ffmpeg" hint="Conversion and tagging">
        <span className="shrink-0 font-mono text-12 text-dim">
          {ffmpegVersion ?? "—"}
        </span>
      </Row>
      <Row
        label="Auto-update on launch"
        hint="Fetch the latest yt-dlp every start"
      >
        <Toggle
          checked={settings?.autoupdate_ytdlp ?? true}
          onChange={(v) => void update({ autoupdate_ytdlp: v })}
          label="Auto-update on launch"
        />
      </Row>
      <Row
        label="YouTube cookies"
        hint='Browser to pull cookies from, e.g. "chrome", "firefox", "edge". Leave empty unless YouTube blocks downloads or a video is restricted.'
      >
        <input
          type="text"
          value={settings?.youtube_cookies ?? ""}
          placeholder="(none)"
          onChange={(e) => void update({ youtube_cookies: e.target.value })}
          className="w-40 rounded-card border border-line bg-raise px-2.5 py-1.5 font-mono text-12 text-ink outline-none transition-colors duration-150 placeholder:text-dim focus:border-ice"
        />
      </Row>
      <Row
        label="YouTube cookies file"
        hint='Path to a Netscape cookies.txt exported from your browser. Read directly (no browser keyring needed) — the most reliable option when "YouTube cookies" fails.'
      >
        <input
          type="text"
          value={settings?.youtube_cookies_file ?? ""}
          placeholder="(none)"
          onChange={(e) => void update({ youtube_cookies_file: e.target.value })}
          className="w-56 rounded-card border border-line bg-raise px-2.5 py-1.5 font-mono text-12 text-ink outline-none transition-colors duration-150 placeholder:text-dim focus:border-ice"
        />
      </Row>
    </Section>
  );
}

function DownloadsSection() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const concurrent = settings?.concurrent ?? 3;

  const step = (delta: number) => {
    const next = Math.min(5, Math.max(1, concurrent + delta));
    if (next !== concurrent) void update({ concurrent: next });
  };

  return (
    <Section title="Downloads">
      <Row
        label="Concurrent downloads"
        hint="Applies immediately to the running queue"
      >
        <div className="flex shrink-0 items-center gap-2">
          <button
            aria-label="Decrease concurrency"
            onClick={() => step(-1)}
            disabled={concurrent <= 1}
            className="grid h-7 w-7 place-items-center rounded-card border border-line text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
          >
            <Minus size={13} weight="bold" aria-hidden />
          </button>
          <span className="w-6 text-center font-mono text-13 text-ink">
            {concurrent}
          </span>
          <button
            aria-label="Increase concurrency"
            onClick={() => step(1)}
            disabled={concurrent >= 5}
            className="grid h-7 w-7 place-items-center rounded-card border border-line text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
          >
            <Plus size={13} weight="bold" aria-hidden />
          </button>
        </div>
      </Row>
    </Section>
  );
}

function PlaybackSection() {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);

  return (
    <Section title="Playback">
      <Row
        label="Disable video playback"
        hint="Play video files as audio only — show the thumbnail instead of the picture. Auto-applies to each track; you can still toggle it per-track from the player."
      >
        <Toggle
          checked={settings?.disable_video_playback ?? false}
          onChange={(v) => void update({ disable_video_playback: v })}
          label="Disable video playback"
        />
      </Row>
    </Section>
  );
}

function AboutSection() {
  const [version, setVersion] = useState<string>("—");
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("—"));
  }, []);

  return (
    <Section title="About">
      <Row label="CRTube">
        <span className="shrink-0 font-mono text-12 text-mute">v{version}</span>
      </Row>
      <Row
        label="Attribution"
        hint="Powered by yt-dlp and ffmpeg. CRTube is an independent desktop client and is not affiliated with YouTube, Google, or the yt-dlp project."
      />
      <Row
        label="Licenses"
        hint="MIT-licensed open-source dependencies — full license texts in the project repository."
      />
    </Section>
  );
}

export function SettingsView() {
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 pt-[6vh] pb-10">
      <h1 className="font-display text-18 font-semibold tracking-tight">
        Settings
      </h1>
      <StorageSection />
      <EngineSection />
      <PlaybackSection />
      <DownloadsSection />
      <AboutSection />
    </div>
  );
}
