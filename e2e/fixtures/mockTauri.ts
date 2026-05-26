import type { Page } from "@playwright/test";

/**
 * Configure the in-app Tauri IPC mock (see `src/utils/e2eMockTauri.ts`)
 * via Playwright's `addInitScript`. Values flow through to the running
 * page as a JSON-serialized payload set on `window.__E2E_MOCK_RESPONSES__`
 * BEFORE the React bundle imports the mock harness.
 *
 * Each entry is either:
 *  - A literal value returned for every invoke of that command, OR
 *  - An array of values, consumed FIFO (with the last value sticky), so
 *    tests can model "first call → A, then → B" sequences without writing
 *    a stateful responder.
 *
 * Functions are NOT supported (Playwright serializes the payload as JSON);
 * for stateful behaviour, use the array form.
 */
export interface MockTauriOptions {
  responses?: Record<string, unknown>;
}

export async function installTauriMock(
  page: Page,
  options: MockTauriOptions = {},
): Promise<void> {
  const responses = options.responses ?? {};
  await page.addInitScript((payload) => {
     
    (window as any).__E2E_MOCK_RESPONSES__ = payload;
  }, responses);
}

/**
 * Convenience: read the in-page log of invoke calls (cmd + args) that
 * the e2e mock recorded. Useful for asserting "did the UI actually call
 * `save_history` after the request?" style flows.
 */
export async function getInvokeLog(
  page: Page,
): Promise<{ cmd: string; args: unknown }[]> {
  return page.evaluate(() => {
     
    return ((window as any).__E2E_INVOKE_LOG__ ?? []) as {
      cmd: string;
      args: unknown;
    }[];
  });
}
