import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        mootools: fileURLToPath(new URL("index.html", import.meta.url)),
        react: fileURLToPath(new URL("react.html", import.meta.url)),
      },
    },
  },
  server: {
    fs: {
      allow: [projectRoot],
    },
  },
});
