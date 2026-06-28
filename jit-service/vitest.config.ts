import { defineConfig } from "vitest/config";

export default defineConfig({
  // Pin an inline (empty) PostCSS config so Vite does NOT search upward and
  // pick up the parent dashboard's postcss.config.js / tailwind setup.
  css: { postcss: {} },
  test: {
    root: __dirname,
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
