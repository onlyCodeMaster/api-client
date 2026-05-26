import { test, expect } from "@playwright/test";
import { getInvokeLog, installTauriMock } from "./fixtures/mockTauri";

/**
 * Golden-path smoke tests against the React UI with Tauri's IPC stubbed
 * via the in-app harness at `src/utils/e2eMockTauri.ts` (opted in by
 * loading the app with `?e2e=1`).
 *
 * These tests would have caught:
 *  - PR #25 (history schema panic on boot — the app would never finish
 *    loading and the URL input would never render).
 *  - The RequestPanel rules-of-hooks crash fixed in PR #27 (would have
 *    surfaced as a React render error as soon as activeRequest changed).
 *  - i18n key regressions like PR #24's "Saved" / "Copied" mix-up if
 *    the assertion targeted that label specifically.
 *
 * They are intentionally fast and shallow: real network calls, the
 * keychain, and SQLite are out of scope here — those have `cargo test
 * --lib` coverage on the Rust side.
 */

const APP_URL = "/?e2e=1";

test.beforeEach(async ({ page }) => {
  // Force English locale + a stable theme so visible-text assertions stay
  // deterministic regardless of the CI host's `navigator.language`. The
  // `if (!…)` guard keeps test-specific overrides (e.g. the zh-locale
  // assertion below) from being clobbered when a later `page.reload()`
  // re-runs every registered init script.
  await page.addInitScript(() => {
    if (!window.localStorage.getItem("api-client:locale")) {
      window.localStorage.setItem("api-client:locale", "en");
    }
    if (!window.localStorage.getItem("theme")) {
      window.localStorage.setItem("theme", "light");
    }
  });
});

test("app boots, sidebar renders, and the request panel is interactive", async ({
  page,
}) => {
  await installTauriMock(page);
  await page.goto(APP_URL);

  // Sidebar: workspace switcher should show the default workspace name.
  await expect(page.getByText("Default", { exact: false })).toBeVisible({
    timeout: 10_000,
  });

  // Request panel: URL input renders with the configured placeholder so the
  // user can immediately start typing a URL.
  const urlInput = page.getByPlaceholder("https://api.example.com/endpoint");
  await expect(urlInput).toBeVisible();

  // Send button is rendered (not Cancel, since no request is in flight).
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});

test("typing a URL and clicking Send renders the response", async ({
  page,
}) => {
  await installTauriMock(page, {
    responses: {
      send_request: {
        status: 200,
        status_text: "OK",
        headers: { "content-type": "application/json" },
        body: '{"ok":true,"hello":"world"}',
        body_encoding: "text",
        body_truncated: false,
        time_ms: 42,
        size_bytes: 27,
        timings: { wait_ms: 30, download_ms: 12, total_ms: 42 },
      },
    },
  });
  await page.goto(APP_URL);

  const urlInput = page.getByPlaceholder("https://api.example.com/endpoint");
  await urlInput.fill("https://example.com/api/ping");

  await page.getByRole("button", { name: "Send" }).click();

  // The status pill renders "200 OK" together — match on the combined label.
  await expect(page.getByText(/\b200\b.*OK/)).toBeVisible({ timeout: 10_000 });
  // Body content rendered into the response viewer (raw or formatted).
  await expect(page.getByText(/hello/)).toBeVisible();

  // Confirm the mock actually saw the send_request invoke (would catch a
  // regression where the pipeline silently swallowed the click).
  const log = await getInvokeLog(page);
  expect(log.some((entry) => entry.cmd === "send_request")).toBe(true);
});

test("locale switch persists across reloads", async ({ page }) => {
  await installTauriMock(page);
  await page.goto(APP_URL);

  // Wait for initial render so we know the app finished booting.
  await expect(
    page.getByPlaceholder("https://api.example.com/endpoint"),
  ).toBeVisible({ timeout: 10_000 });

  // Flip the locale and reload. We do this AFTER goto so the
  // localStorage write isn't clobbered by the addInitScript in beforeEach
  // (which only seeds the initial state once per navigation).
  await page.evaluate(() => {
    window.localStorage.setItem("api-client:locale", "zh");
  });
  await page.reload();

  // The English Send button label should no longer be present. We
  // explicitly look for the exact name rather than `not.toBeVisible`
  // (which would also be true for a broken app).
  await expect(
    page.getByRole("button", { name: "Send", exact: true }),
  ).toHaveCount(0);
  // URL placeholder text is identical between en and zh, so it stays
  // visible — useful as a "the app didn't break on locale switch" anchor.
  await expect(
    page.getByPlaceholder("https://api.example.com/endpoint"),
  ).toBeVisible();
});
