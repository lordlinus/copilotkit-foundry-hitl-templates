import { defineConfig } from "vite";

// Relative base so the built site works at any GitHub Pages sub-path
// (e.g. https://<user>.github.io/<repo>/) without rewrites.
export default defineConfig({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
