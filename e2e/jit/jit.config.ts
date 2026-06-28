import { defineConfig } from "@playwright/test";
import * as path from "path";

/**
 * Purpose-built E2E for the Just-in-Time access feature.
 *
 * Unlike the upstream suite (Zitadel + static `out/` on :1337), this drives the
 * live local JIT stack:
 *   - the dashboard at http://localhost (NetBird OSS + embedded IdP behind nginx)
 *   - the jit-service host process on :8090, proxied at /jit-api/
 *
 * Prereqs + run instructions: see e2e/jit/README.md. Credentials come from
 * JIT_E2E_USER / JIT_E2E_PASSWORD (never hard-coded).
 */
export default defineConfig({
  testDir: __dirname,
  outputDir: path.join(__dirname, "test-results"),
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: [["list"], ["html", { outputFolder: path.join(__dirname, "report"), open: "never" }]],
  use: {
    baseURL: process.env.JIT_E2E_BASE_URL || "http://localhost",
    viewport: { width: 1600, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  projects: [
    { name: "setup", testMatch: /jit-auth\.setup\.ts/ },
    {
      name: "jit",
      testMatch: /\.spec\.ts$/,
      dependencies: ["setup"],
      use: { storageState: path.join(__dirname, ".auth", "jack.json") },
    },
  ],
});
