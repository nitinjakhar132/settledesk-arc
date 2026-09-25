import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://localhost:3000",
    channel: "msedge",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: "list",
});
