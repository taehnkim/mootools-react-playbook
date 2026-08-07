import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        react: fileURLToPath(new URL("index.html", import.meta.url)),
        mootools: fileURLToPath(
          new URL("legacy/index.html", import.meta.url),
        ),
      },
    },
  },
  server: {
    fs: {
      allow: [projectRoot],
    },
  },
});
