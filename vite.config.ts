import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Rust's target tree contains tens of thousands of generated files and
      // can exhaust Linux's per-user inotify-watch limit when watched by Vite.
      ignored: ["**/src-tauri/target/**"],
    },
  },
  build: {
    target: "es2021",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("motion") || id.includes("framer")) return "motion";
            if (id.includes("@tanstack")) return "virtual";
            if (id.includes("zustand")) return "zustand";
            if (id.includes("@phosphor-icons")) return "icons";
            if (id.includes("react-dom") || id.includes("react")) return "react";
            return "vendor";
          }
        },
      },
    },
  },
});
