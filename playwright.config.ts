import { defineConfig, devices } from "@playwright/test";

const appPort = process.env.FACET_E2E_APP_PORT ?? "5173";
const relayPort = process.env.FACET_E2E_RELAY_PORT ?? "17777";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "bun tests/e2e/server.ts",
    url: `http://127.0.0.1:${appPort}`,
    reuseExistingServer: false,
    env: {
      ...process.env,
      FACET_E2E_APP_PORT: appPort,
      FACET_E2E_RELAY_PORT: relayPort,
      VITE_FACET_RELAY_URL: `ws://127.0.0.1:${relayPort}`,
      VITE_FACET_PROFILE_RELAYS: "",
    },
  },
});
