import { mockIPC } from "@tauri-apps/api/mocks";

/**
 * E2E test harness for the Tauri IPC layer.
 *
 * Activated when the page is loaded with `?e2e=1`. The actual desktop app
 * never carries that query string, so this code path is dead in production
 * builds.
 *
 * Tests provide command responses by setting `window.__E2E_MOCK_RESPONSES__`
 * via Playwright's `addInitScript()` BEFORE the bundle imports this module.
 * Values can be either:
 *   - A literal JSON-serializable value (the responder returns it verbatim).
 *   - An array of values (each invoke consumes the next one — useful for
 *     "first call returns A, second call returns B" tests).
 *
 * Commands not present in the map fall back to the conservative defaults
 * below, which produce an empty-but-functional UI (one default workspace,
 * no collections, no environments, no history).
 */
declare global {
  interface Window {
    __E2E_MOCK_RESPONSES__?: Record<string, unknown>;
    __E2E_INVOKE_LOG__?: { cmd: string; args: unknown }[];
  }
}

export function isE2EMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).has("e2e");
  } catch {
    return false;
  }
}

export function installE2EMockIPC(): void {
  const overrides = window.__E2E_MOCK_RESPONSES__ ?? {};
  const defaults = defaultResponses();
  // Per-command FIFO queues: when an override is an array, each invoke
  // consumes the next entry (and the queue retains its last entry so
  // subsequent calls keep returning it rather than falling through).
  const queues: Record<string, unknown[]> = {};
  for (const [cmd, value] of Object.entries(overrides)) {
    if (Array.isArray(value)) queues[cmd] = [...value];
  }

  window.__E2E_INVOKE_LOG__ = [];

  mockIPC((cmd, args) => {
    window.__E2E_INVOKE_LOG__?.push({ cmd, args });

    if (cmd in overrides) {
      if (queues[cmd]) {
        const q = queues[cmd];
        const next = q.length > 1 ? q.shift() : q[0];
        return next as unknown;
      }
      return overrides[cmd];
    }
    if (cmd in defaults) {
      return defaults[cmd];
    }
    // Unknown command. Surface in the console so debugging is easier and
    // return null so the store falls back to its no-data branch instead of
    // crashing on `await invoke(...)` rejection.
    console.warn("[e2e-mock] unhandled command:", cmd, args);
    return null;
  });
}

function defaultResponses(): Record<string, unknown> {
  const now = Date.now();
  const workspace = {
    id: "ws_default",
    name: "Default",
    active_environment_id: undefined,
    active_collection_id: undefined,
    active_request_id: undefined,
    window_state: {},
    variables: [],
    created_at: now,
    updated_at: now,
  };
  return {
    load_default_workspace: workspace,
    list_workspaces: [workspace],
    migrate_legacy_to_workspace: 0,
    list_collections: [],
    list_environments: [],
    get_history: [],
    search_history: [],
    get_setting: null,
    set_setting: null,
    save_collection: null,
    save_environment: null,
    save_workspace: null,
    save_history: null,
    delete_collection: null,
    delete_environment: null,
    delete_workspace: null,
    clear_history: null,
    create_workspace: workspace,
    get_all_cookies: [],
    list_cookies: [],
    delete_cookie: null,
    clear_cookies_by_domain: null,
    mock_server_status: { running: false, port: null, workspace_id: null },
    list_mock_routes: [],
    mock_server_start: 0,
    mock_server_stop: null,
    save_mock_route: null,
    delete_mock_route: null,
  };
}
