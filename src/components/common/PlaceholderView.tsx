import type { View } from "../../stores/ui";
import { ConsolePrompt } from "./ConsolePrompt";

const PROMPTS: Record<View, string[]> = {
  search: ["> awaiting input"],
  downloads: ["> no active transfers"],
  library: ["> nothing archived yet"],
  settings: ["> awaiting calibration"],
};

export function PlaceholderView({ view }: { view: View }) {
  return <ConsolePrompt lines={PROMPTS[view]} />;
}
