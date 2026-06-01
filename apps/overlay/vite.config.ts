import { defineConfig } from "vite";
import { resolve } from "node:path";

// Port 1420 is LOAD-BEARING: the daemon allowlist includes "http://localhost:1420"
// as the dev origin (ADR-0003 Amendment 2026-05-30). If this port drifts to the
// Vite default 5173, the WebSocket upgrade is rejected with 403.
export default defineConfig({
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        widget: resolve(__dirname, "widget.html"),
      },
    },
  },
});
