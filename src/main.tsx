import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/noto-naskh-arabic/400.css";
import "@fontsource/noto-naskh-arabic/700.css";
import "./theme.css";
import App from "./App";
import { LyricsOverlay } from "./components/lyrics-overlay/LyricsOverlay";

const lyricsOverlay = window.location.hash.startsWith("#lyrics-overlay");
document.documentElement.dataset.surface = lyricsOverlay
  ? "lyrics-overlay"
  : "app";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {lyricsOverlay ? <LyricsOverlay /> : <App />}
  </React.StrictMode>,
);
