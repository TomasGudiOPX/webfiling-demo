import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://localhost:3107",
    trace: "retain-on-failure",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  },
  webServer: {
    command: "npm run dev -- --port 3107",
    url: "http://localhost:3107/file",
    reuseExistingServer: false,
    env: {
      DATABASE_PATH: "./.test-data/library.sqlite",
      MANAGED_STORAGE_ROOT: "./.test-data/managed",
      DEMO_MODE: "true",
      SESSION_SECRET: "isolated-library-test-secret",
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
