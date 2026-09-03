import { defineConfig } from "vite";
import { resolve } from "node:path";

// Builds the UI-free audit engine as a standalone IIFE exposing window.DOMSurgeon.
// Output lands in public/ so the main app build copies it into dist/, which makes
// it fetchable by the bookmarklet and by the CLI's Playwright injection.
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/engine-entry.ts"),
      name: "DOMSurgeon",
      formats: ["iife"],
      fileName: () => "dom-surgeon-engine.js",
    },
    outDir: "public",
    emptyOutDir: false,
    minify: "esbuild",
    sourcemap: false,
    target: "es2021",
    rollupOptions: {
      // Makes window.DOMSurgeon the API object itself rather than a module
      // namespace wrapper (which would put the API at window.DOMSurgeon.default).
      output: { exports: "default" },
    },
  },
});
