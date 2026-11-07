import { useEffect } from "react";
import { ipc } from "../lib/ipc";
import { useSettingsStore } from "../stores/settings";
import { pushToast } from "../stores/toast";

/**
 * Urdu lyrics font selector (§4.6). "naskh" is the bundled default (the
 * theme.css `--font-urdu` stack); "custom" loads a font file the user picked
 * themselves — copied into `{app_data}/fonts/` by `pick_urdu_font`, served
 * from the loopback media server, and registered as a runtime FontFace. The
 * face is applied by overriding `--font-urdu` on :root, so every `.font-urdu`
 * element (Caption Deck, floating overlay, fullscreen caption) switches
 * instantly.
 */
const CUSTOM_STACK =
  '"CRTube Urdu Custom", "Noto Naskh Arabic", system-ui, sans-serif';
const NASKH_STACK = '"Noto Naskh Arabic", system-ui, sans-serif';

// Registry for the currently-added custom face so re-picking replaces it.
let customFaceKey: string | null = null;
let customFaceHandle: FontFace | null = null;

async function loadCustomFace(file: string): Promise<void> {
  if (customFaceKey === file && customFaceHandle) return;
  if (customFaceHandle) {
    document.fonts.delete(customFaceHandle);
    customFaceHandle = null;
  }
  const url = await ipc.urduCustomFontUrl();
  // Weight range: user fonts usually ship a single Regular — map semibold
  // onto the file instead of synthesizing faux bold (smears Nastaliq strokes).
  const face = new FontFace("CRTube Urdu Custom", `url(${url})`, {
    weight: "400 900",
  });
  await face.load();
  document.fonts.add(face);
  customFaceHandle = face;
  customFaceKey = file;
}

export function useUrduFont() {
  const pref = useSettingsStore((s) => s.settings?.urdu_font ?? "naskh");
  const customFile = useSettingsStore(
    (s) => s.settings?.urdu_custom_file ?? null,
  );

  useEffect(() => {
    const root = document.documentElement;
    if (pref === "custom") {
      if (!customFile) {
        // Nothing picked yet — fall back to the bundled Naskh.
        root.style.setProperty("--font-urdu", NASKH_STACK);
        return;
      }
      let cancelled = false;
      loadCustomFace(customFile)
        .then(() => {
          if (!cancelled) root.style.setProperty("--font-urdu", CUSTOM_STACK);
        })
        .catch((e) => {
          if (!cancelled) {
            root.style.setProperty("--font-urdu", NASKH_STACK);
            pushToast(`Custom font failed to load — ${String(e)}`);
          }
        });
      return () => {
        cancelled = true;
      };
    }
    // Bundled Naskh — theme.css default; clear any override.
    root.style.removeProperty("--font-urdu");
  }, [pref, customFile]);
}
