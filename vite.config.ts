import { defineConfig } from "vite";

// Static single-page build. No backend — DOM-Surgeon runs entirely client-side.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    target: "es2021",
    sourcemap: true,
  },
});
