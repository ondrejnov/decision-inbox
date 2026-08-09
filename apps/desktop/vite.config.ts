import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(directory, "src/renderer"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@renderer": path.join(directory, "src/renderer"),
    },
  },
  build: {
    outDir: path.join(directory, "dist/renderer"),
    emptyOutDir: true,
  },
});
