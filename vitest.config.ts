import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: [
      "components/**/*.legacy.test.ts",
      "src/**/*.test.{js,jsx,ts,tsx}",
    ],
  },
});
