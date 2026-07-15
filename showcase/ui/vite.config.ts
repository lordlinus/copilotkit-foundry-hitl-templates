import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the built site works at any GitHub Pages sub-path
// (e.g. https://<user>.github.io/<repo>/) without rewrites.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
