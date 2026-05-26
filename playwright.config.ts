import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for end-to-end tests against the React UI.
 *
 * NOTE: These tests run against the standard `vite dev` server in a real
 * Chromium browser — they do NOT drive the Tauri WebView itself. Driving
 * the Tauri shell would require `tauri-driver` (WebDriver) plus a built
 * Tauri binary, which is far too heavy for a per-PR CI signal.
 *
 * Instead, every test injects a mock for `window.__TAURI_INTERNALS__.invoke`
 * (see `e2e/fixtures/mockTauri.ts`) before the React bundle loads. This
 * lets us exercise the frontend's command-dispatch and rendering layer
 * exactly as it would behave at runtime, with deterministic backend
 * responses. The Rust side has its own `cargo test --lib` coverage.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  },
});
