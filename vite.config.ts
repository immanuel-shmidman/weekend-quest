import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the build works on *.pages.dev without extra config.
  base: "./",
  server: {
    host: true, // expose on the LAN so you can test on a real phone during dev
    port: 5173,
    // Forward API calls to `npx wrangler pages dev dist` (port 8788), so the
    // hot-reloading dev server still hits a real Function and a local D1.
    proxy: { "/api": "http://127.0.0.1:8788" },
  },
  build: {
    target: "es2020",
    outDir: "dist",
  },
});
