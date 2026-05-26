import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  HttpMethod,
  KeyValue,
  RequestItem,
  ResponseData,
  ResponseSnapshot,
  Collection,
  CollectionRequest,
  HistoryEntry,
  Environment,
  EnvVariable,
  Workspace,
  AuthConfig,
  CookieEntry,
  WsMessage,
  SseEventRecord,
  Protocol,
  TestResult,
  ScriptLog,
} from "../types";
import { postmanToCollection } from "../utils/postman";
import { executeRequestWithScripts } from "../utils/requestPipeline";
import { substituteAll } from "../utils/dynamicVars";
import { buildScopedVars } from "../utils/variableScope";
import {
  createNewFolder,
  addFolderTo,
  removeFolder,
  renameFolder as renameFolderInTree,
  removeRequest as removeRequestFromTree,
  renameRequest as renameRequestInTree,
  moveRequest,
  moveFolder,
  reorderFoldersInContainer,
  reorderRequestsInContainer,
  type NodeContainer,
} from "../utils/folderTree";

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

// Debounce token for tab persistence. Tab content edits fire on every
// keystroke (URL bar, body editor, ...) and we don't want to serialize +
// fsync the workspace JSON that often. 500 ms is long enough to coalesce
// burst typing without losing work if the user closes the window.
let persistTabsTimer: ReturnType<typeof setTimeout> | null = null;

function createEmptyKeyValue(): KeyValue {
  return { id: generateId(), key: "", value: "", enabled: true };
}

function createNewRequest(): RequestItem {
  return {
    id: generateId(),
    name: "New Request",
    method: "GET",
    url: "",
    headers: [createEmptyKeyValue()],
    params: [createEmptyKeyValue()],
    body: "",
    bodyType: "none",
    formData: [createEmptyKeyValue()],
    protocol: "http",
    createdAt: Date.now(),
  };
}

// Convert RequestItem <-> HistoryEntry for SQLite persistence
function requestToHistoryEntry(
  req: RequestItem,
  response?: ResponseData | null,
  workspaceId?: string
): HistoryEntry {
  const now = Date.now();
  return {
    id: req.id,
    name: req.name,
    method: req.method,
    url: req.url,
    headers: JSON.stringify(req.headers),
    params: JSON.stringify(req.params),
    body: req.body,
    body_type: req.bodyType,
    response_status: response?.status,
    response_time_ms: response?.time_ms,
    created_at: req.createdAt,
    updated_at: now,
    workspace_id: workspaceId,
  };
}

function historyEntryToRequest(entry: HistoryEntry): RequestItem {
  let headers: KeyValue[] = [];
  let params: KeyValue[] = [];
  try { headers = JSON.parse(entry.headers); } catch { headers = [createEmptyKeyValue()]; }
  try { params = JSON.parse(entry.params); } catch { params = [createEmptyKeyValue()]; }
  if (headers.length === 0) headers = [createEmptyKeyValue()];
  if (params.length === 0) params = [createEmptyKeyValue()];

  return {
    id: entry.id,
    name: entry.name,
    method: entry.method as HttpMethod,
    url: entry.url,
    headers,
    params,
    body: entry.body,
    bodyType: entry.body_type as RequestItem["bodyType"],
    formData: [createEmptyKeyValue()],
    protocol: "http",
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  };
}

interface RequestState {
  // Data
  collections: Collection[];
  environments: Environment[];
  workspace: Workspace | null;
  /** All available workspaces. Always non-empty after `initialize`. */
  workspaces: Workspace[];
  history: RequestItem[];
  initialized: boolean;

  // Multi-tabs
  tabs: RequestItem[];
  activeTabId: string | null;
  responses: Record<string, ResponseData | null>;
  errors: Record<string, string | null>;
  loadings: Record<string, boolean>;
  /** Test results from the most recent post-response script, keyed by request id. */
  testResults: Record<string, TestResult[] | null>;
  /** Script execution logs (pre + post combined), keyed by request id. */
  scriptLogs: Record<string, ScriptLog[] | null>;
  /** Script error message (timeout, syntax, etc.), keyed by request id. */
  scriptError: Record<string, string | null>;
  /** Recent response snapshots (newest first) per request id, capped at 10, for diff view. */
  responseHistory: Record<string, ResponseSnapshot[]>;

  // WebSocket state per tab
  wsConnected: Record<string, boolean>;
  wsMessages: Record<string, WsMessage[]>;

  // Server-Sent Events state per tab
  sseConnected: Record<string, boolean>;
  sseEvents: Record<string, SseEventRecord[]>;

  // Cookies
  cookies: CookieEntry[];

  // Settings
  defaultTimeoutMs: number;
  /** Default TLS verification policy when a request doesn't override it. */
  verifyTlsDefault: boolean;

  // Computed-like accessors (read from active tab)
  // Derived: activeRequest / response / loading / error
  activeRequest: RequestItem | null;
  activeRequestId: string | null;
  response: ResponseData | null;
  loading: boolean;
  error: string | null;

  // === Actions ===
  initialize: () => Promise<void>;

  // Tabs
  openTab: (request: RequestItem) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  reorderTabs: (fromId: string, toId: string) => void;
  /** Move the active tab focus by `delta` (e.g. `-1` for prev, `+1` for next).
   *  Wraps at both ends. No-op when there are no tabs. */
  cycleTab: (delta: number) => void;
  /** Duplicate the active tab: clones the RequestItem with a fresh id and
   *  reset response state, then makes the clone the active tab. */
  duplicateActiveTab: () => void;

  // Active-tab convenience setters (mutate active tab)
  setActiveRequest: (request: RequestItem) => void;
  updateActiveRequest: (partial: Partial<RequestItem>) => void;
  setMethod: (method: HttpMethod) => void;
  setUrl: (url: string) => void;
  setHeaders: (headers: KeyValue[]) => void;
  setParams: (params: KeyValue[]) => void;
  setBody: (body: string) => void;
  setBodyType: (bodyType: RequestItem["bodyType"]) => void;
  setFormData: (formData: KeyValue[]) => void;
  setAuth: (auth: AuthConfig) => void;
  setName: (name: string) => void;
  setTimeoutMs: (ms: number | undefined) => void;
  setVerifyTls: (verify: boolean | undefined) => void;
  setRedirectPolicy: (policy: "follow" | "none" | "manual" | undefined) => void;
  setMaxRedirects: (n: number | undefined) => void;
  setProxyUrl: (url: string | undefined) => void;
  setClientCert: (cert: RequestItem["clientCert"]) => void;
  setProtocol: (protocol: Protocol) => void;
  setGraphqlQuery: (q: string) => void;
  setGraphqlVariables: (v: string) => void;
  setPreScript: (s: string) => void;
  setTestScript: (s: string) => void;
  setTags: (tags: string[]) => void;

  sendRequest: () => Promise<void>;
  cancelRequest: () => void;
  createNewRequest: () => void;
  clearResponseHistory: (requestId: string) => void;

  // History
  addToHistory: (request: RequestItem, response?: ResponseData | null) => void;
  deleteRequestFromHistory: (id: string) => void;
  clearAllHistory: () => Promise<void>;
  loadFromHistory: (id: string) => void;
  searchHistory: (query: string) => Promise<void>;
  reorderHistory: (fromId: string, toId: string) => void;

  // Collections
  addCollection: (name: string) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  renameCollection: (id: string, name: string) => Promise<void>;
  addRequestToCollection: (collectionId: string) => Promise<void>;
  loadRequestFromCollection: (collectionId: string, requestId: string) => void;
  deleteRequestFromCollection: (collectionId: string, requestId: string) => Promise<void>;
  renameRequestInCollection: (collectionId: string, requestId: string, name: string) => Promise<void>;
  reorderCollections: (fromId: string, toId: string) => void;
  reorderRequestsInCollection: (collectionId: string, fromId: string, toId: string) => Promise<void>;

  // === Folders ===

  /** Create a new folder. `parentFolderId === null` places it at the
   *  collection root, otherwise inside the named folder. */
  createFolder: (collectionId: string, parentFolderId: string | null, name: string) => Promise<void>;
  /** Rename a folder anywhere in the collection tree. */
  renameFolder: (collectionId: string, folderId: string, name: string) => Promise<void>;
  /** Delete a folder and its entire subtree (matching Postman/Insomnia). */
  deleteFolder: (collectionId: string, folderId: string) => Promise<void>;
  /** Move a request to a different container within the same collection.
   *  Pass `targetFolderId === null` to move it to the collection root. */
  moveRequestToFolder: (
    collectionId: string,
    requestId: string,
    targetFolderId: string | null,
  ) => Promise<void>;
  /** Move a folder (and its subtree) to a different container within the
   *  same collection. Refuses to move a folder into its own descendant. */
  moveFolderToFolder: (
    collectionId: string,
    folderId: string,
    targetParentFolderId: string | null,
  ) => Promise<void>;
  /** Reorder two folders that share the same parent container. */
  reorderFoldersInCollection: (
    collectionId: string,
    fromFolderId: string,
    toFolderId: string,
  ) => Promise<void>;
  importPostmanCollection: (data: unknown) => Promise<void>;
  /** Save a batch of already-built collections (used by every import format). */
  importCollections: (cols: Collection[]) => Promise<void>;
  updateCollection: (col: Collection) => Promise<void>;
  setCollectionAuth: (collectionId: string, auth: AuthConfig | undefined) => Promise<void>;
  /** Overwrite the variable list on a collection. Used by the variable scope editor. */
  setCollectionVariables: (collectionId: string, variables: EnvVariable[]) => Promise<void>;
  /** Overwrite the workspace-global variable list. */
  setGlobalVariables: (variables: EnvVariable[]) => Promise<void>;
  refreshCollections: () => Promise<void>;

  // Environments
  addEnvironment: (name: string) => Promise<void>;
  deleteEnvironment: (id: string) => Promise<void>;
  updateEnvironment: (env: Environment) => Promise<void>;
  refreshEnvironments: () => Promise<void>;
  setActiveEnvironment: (id: string | null) => void;

  /** Patch the workspace's window_state and persist (debounced via
   *  caller's responsibility — caller is expected to commit on drag end). */
  setWindowState: (patch: Partial<NonNullable<Workspace["window_state"]>>) => void;

  /** Snapshot the current tab list + active tab into `window_state.open_tabs`
   *  and persist (debounced). Wired into every tab-mutating action so users
   *  keep their tabs across restarts. */
  persistTabsState: () => void;

  // Cookies
  refreshCookies: () => Promise<void>;
  deleteCookie: (id: string) => Promise<void>;
  clearCookiesByDomain: (domain: string) => Promise<void>;

  // Settings
  setDefaultTimeoutMs: (ms: number) => Promise<void>;
  setVerifyTlsDefault: (verify: boolean) => Promise<void>;

  // WebSocket
  wsConnect: () => Promise<void>;
  wsSend: (text: string) => Promise<void>;
  wsClose: () => Promise<void>;
  appendWsEvent: (requestId: string, kind: string, text?: string | null) => void;

  // Server-Sent Events
  sseConnect: () => Promise<void>;
  sseClose: () => Promise<void>;
  appendSseEvent: (
    requestId: string,
    kind: string,
    detail: { event?: string; data?: string; id?: string; retry?: number; error?: string }
  ) => void;

  // Workspace
  saveWorkspaceState: () => Promise<void>;

  /** Switch the active workspace; loads its collections / environments / history. */
  switchWorkspace: (workspaceId: string) => Promise<void>;
  /** Create a new empty workspace and switch to it. */
  createWorkspace: (name: string) => Promise<Workspace>;
  /** Rename an existing workspace. */
  renameWorkspace: (id: string, name: string) => Promise<void>;
  /** Cascade-delete a workspace, its collections, environments, and history. */
  deleteWorkspace: (id: string) => Promise<void>;
  /** Refresh the workspaces list from disk. */
  refreshWorkspaces: () => Promise<void>;
}

function activeTab(state: RequestState): RequestItem | null {
  if (!state.activeTabId) return null;
  return state.tabs.find((t) => t.id === state.activeTabId) ?? null;
}

/** Search a collection (including nested folders) for a request by id. */
function findRequestInCollection(
  collection: Collection,
  requestId: string
): CollectionRequest | null {
  const direct = collection.requests.find((r) => r.id === requestId);
  if (direct) return direct;
  const walk = (folders: typeof collection.folders): CollectionRequest | null => {
    for (const f of folders) {
      const here = f.requests.find((r) => r.id === requestId);
      if (here) return here;
      const deeper = walk(f.folders);
      if (deeper) return deeper;
    }
    return null;
  };
  return walk(collection.folders);
}

function updateActiveTab(
  state: RequestState,
  patch: Partial<RequestItem>
): Partial<RequestState> {
  if (!state.activeTabId) return {};
  const tabs = state.tabs.map((t) =>
    t.id === state.activeTabId ? { ...t, ...patch } : t
  );
  const active = tabs.find((t) => t.id === state.activeTabId) || null;
  return {
    tabs,
    activeRequest: active,
  };
}

function syncDerived(state: RequestState): Partial<RequestState> {
  const active = activeTab(state);
  return {
    activeRequest: active,
    activeRequestId: active?.id ?? null,
    response: active ? state.responses[active.id] ?? null : null,
    loading: active ? !!state.loadings[active.id] : false,
    error: active ? state.errors[active.id] ?? null : null,
  };
}

export const useRequestStore = create<RequestState>((set, get) => {
  const initialReq = createNewRequest();
  return {
    collections: [],
    environments: [],
    workspace: null,
    workspaces: [],
    history: [],
    initialized: false,

    tabs: [initialReq],
    activeTabId: initialReq.id,
    responses: {},
    errors: {},
    loadings: {},
    testResults: {},
    scriptLogs: {},
    scriptError: {},
    responseHistory: {},

    wsConnected: {},
    wsMessages: {},

    sseConnected: {},
    sseEvents: {},

    cookies: [],
    defaultTimeoutMs: 30000,
    verifyTlsDefault: true,

    activeRequest: initialReq,
    activeRequestId: initialReq.id,
    response: null,
    loading: false,
    error: null,

    initialize: async () => {
      try {
        const workspace = await invoke<Workspace>("load_default_workspace");
        // One-shot legacy migration: stamp every pre-multi-workspace artifact
        // with the default workspace id so it appears in exactly one workspace.
        try {
          await invoke<number>("migrate_legacy_to_workspace", { workspaceId: workspace.id });
        } catch (err) {
          console.warn("Legacy workspace migration skipped:", err);
        }
        const workspaces = await invoke<Workspace[]>("list_workspaces");
        const wsId = workspace.id;
        const historyEntries = await invoke<HistoryEntry[]>("get_history", {
          workspaceId: wsId,
          limit: 50,
          offset: 0,
        });
        const history = historyEntries.map(historyEntryToRequest);
        const collections = await invoke<Collection[]>("list_collections", { workspaceId: wsId });
        const environments = await invoke<Environment[]>("list_environments", { workspaceId: wsId });

        let defaultTimeoutMs = 30000;
        try {
          const stored = await invoke<string | null>("get_setting", { key: "default_timeout_ms" });
          if (stored) {
            const v = parseInt(stored, 10);
            if (Number.isFinite(v) && v > 0) defaultTimeoutMs = v;
          }
        } catch {}

        let verifyTlsDefault = true;
        try {
          const stored = await invoke<string | null>("get_setting", { key: "verify_tls_default" });
          if (stored === "false") verifyTlsDefault = false;
        } catch {}

        // Restore the user's tabs from the workspace's window_state, if any.
        // Falls back to the default single blank tab when no snapshot exists
          // or when the snapshot is empty.
        const savedTabs = workspace.window_state?.open_tabs;
        const savedActiveId = workspace.window_state?.active_tab_id;
        const hasSnapshot = Array.isArray(savedTabs) && savedTabs.length > 0;
        const tabs = hasSnapshot ? savedTabs! : get().tabs;
        const activeTabId = hasSnapshot
          ? (savedActiveId && tabs.some((t) => t.id === savedActiveId)
              ? savedActiveId
              : tabs[0].id)
          : get().activeTabId;

        set((s) => ({
          workspace,
          workspaces,
          history,
          collections,
          environments,
          defaultTimeoutMs,
          verifyTlsDefault,
          tabs,
          activeTabId,
          initialized: true,
          ...syncDerived({ ...s, tabs, activeTabId }),
        }));
      } catch (err) {
        console.error("Failed to initialize store:", err);
        set({ initialized: true });
      }
    },

    // === Tabs ===

    openTab: (request) => {
      const { tabs } = get();
      if (tabs.find((t) => t.id === request.id)) {
        set((s) => ({ activeTabId: request.id, ...syncDerived({ ...s, activeTabId: request.id }) }));
        get().persistTabsState();
        return;
      }
      const next = [...tabs, request];
      set((s) => ({
        tabs: next,
        activeTabId: request.id,
        ...syncDerived({ ...s, tabs: next, activeTabId: request.id }),
      }));
      get().persistTabsState();
    },

    closeTab: (id) => {
      const state = get();
      const { tabs, activeTabId, responses, errors, loadings, wsConnected, wsMessages,
        testResults, scriptLogs, scriptError, responseHistory, sseConnected, sseEvents } = state;
      // If a WebSocket is still open in this tab, close it on the backend
      if (wsConnected[id]) {
        invoke("ws_close", { requestId: id }).catch(() => {});
      }
      // Same for an open SSE stream
      if (sseConnected[id]) {
        invoke("sse_close", { requestId: id }).catch(() => {});
      }
      // If an HTTP request is still in flight, cancel it
      if (loadings[id]) {
        invoke("cancel_request", { requestId: id }).catch(() => {});
      }
      if (tabs.length === 1) {
        // Replace with a fresh new request rather than zero tabs. Reset every
        // per-request map so we don't keep stale entries (notably
        // responseHistory, which can hold large response bodies).
        const fresh = createNewRequest();
        set((s) => ({
          tabs: [fresh],
          activeTabId: fresh.id,
          responses: {},
          errors: {},
          loadings: {},
          testResults: {},
          scriptLogs: {},
          scriptError: {},
          responseHistory: {},
          wsConnected: {},
          wsMessages: {},
          sseConnected: {},
          sseEvents: {},
          ...syncDerived({ ...s, tabs: [fresh], activeTabId: fresh.id, responses: {}, errors: {}, loadings: {} }),
        }));
        // Persist the fresh-tab state too — otherwise the workspace file
        // keeps the closed tab snapshot and the next launch restores it.
        get().persistTabsState();
        return;
      }
      const idx = tabs.findIndex((t) => t.id === id);
      const remaining = tabs.filter((t) => t.id !== id);
      let nextActive = activeTabId;
      if (activeTabId === id) {
        const fallback = remaining[Math.max(0, idx - 1)] ?? remaining[0];
        nextActive = fallback.id;
      }
      const respRest = { ...responses }; delete respRest[id];
      const errRest = { ...errors }; delete errRest[id];
      const loadRest = { ...loadings }; delete loadRest[id];
      const wsConnRest = { ...wsConnected }; delete wsConnRest[id];
      const wsMsgRest = { ...wsMessages }; delete wsMsgRest[id];
      const testResultsRest = { ...testResults }; delete testResultsRest[id];
      const scriptLogsRest = { ...scriptLogs }; delete scriptLogsRest[id];
      const scriptErrorRest = { ...scriptError }; delete scriptErrorRest[id];
      const responseHistoryRest = { ...responseHistory }; delete responseHistoryRest[id];
      const sseConnRest = { ...sseConnected }; delete sseConnRest[id];
      const sseEventsRest = { ...sseEvents }; delete sseEventsRest[id];
      set((s) => ({
        tabs: remaining,
        activeTabId: nextActive,
        responses: respRest,
        errors: errRest,
        loadings: loadRest,
        wsConnected: wsConnRest,
        wsMessages: wsMsgRest,
        testResults: testResultsRest,
        scriptLogs: scriptLogsRest,
        scriptError: scriptErrorRest,
        responseHistory: responseHistoryRest,
        sseConnected: sseConnRest,
        sseEvents: sseEventsRest,
        ...syncDerived({
          ...s,
          tabs: remaining,
          activeTabId: nextActive,
          responses: respRest,
          errors: errRest,
          loadings: loadRest,
        }),
      }));
      get().persistTabsState();
    },

    setActiveTab: (id) => {
      set((s) => ({ activeTabId: id, ...syncDerived({ ...s, activeTabId: id }) }));
      get().persistTabsState();
    },

    reorderTabs: (fromId, toId) => {
      const { tabs } = get();
      const from = tabs.findIndex((t) => t.id === fromId);
      const to = tabs.findIndex((t) => t.id === toId);
      if (from === -1 || to === -1 || from === to) return;
      const next = [...tabs];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      set({ tabs: next });
      get().persistTabsState();
    },

    cycleTab: (delta) => {
      const { tabs, activeTabId } = get();
      if (tabs.length === 0) return;
      const idx = activeTabId ? tabs.findIndex((t) => t.id === activeTabId) : -1;
      if (idx === -1) {
        get().setActiveTab(tabs[0].id);
        return;
      }
      const len = tabs.length;
      // Modulo arithmetic that handles negative deltas correctly.
      const nextIdx = (((idx + delta) % len) + len) % len;
      get().setActiveTab(tabs[nextIdx].id);
    },

    duplicateActiveTab: () => {
      const { tabs, activeTabId } = get();
      const active = tabs.find((t) => t.id === activeTabId);
      if (!active) return;
      const now = Date.now();
      const clone: RequestItem = {
        ...active,
        id: generateId(),
        name: `${active.name} (copy)`,
        createdAt: now,
        updatedAt: now,
        // Deep-copy mutable arrays so future edits to the clone don't bleed
        // back into the source tab through shared references.
        headers: active.headers.map((h) => ({ ...h })),
        params: active.params.map((p) => ({ ...p })),
        formData: active.formData.map((f) => ({ ...f })),
      };
      get().openTab(clone);
    },

    setActiveRequest: (request) => {
      get().openTab(request);
    },

    updateActiveRequest: (partial) => {
      set((s) => ({ ...updateActiveTab(s, partial), ...syncDerived({ ...s, ...updateActiveTab(s, partial) } as RequestState) }));
      get().persistTabsState();
    },

    // All individual setters delegate to updateActiveRequest so the
    // workspace persistence layer fires for every keystroke-driven change
    // (debounced inside persistTabsState). Without this, edits typed into
    // RequestPanel — URL, headers, body, scripts, … — would only be
    // written to disk when the user happens to perform a structural tab
    // action (open/close/switch), and a crash mid-edit would lose work.
    setMethod: (method) => get().updateActiveRequest({ method }),
    setUrl: (url) => get().updateActiveRequest({ url }),
    setHeaders: (headers) => get().updateActiveRequest({ headers }),
    setParams: (params) => get().updateActiveRequest({ params }),
    setBody: (body) => get().updateActiveRequest({ body }),
    setBodyType: (bodyType) => get().updateActiveRequest({ bodyType }),
    setFormData: (formData) => get().updateActiveRequest({ formData }),
    setAuth: (auth) => get().updateActiveRequest({ auth }),
    setName: (name) => get().updateActiveRequest({ name }),
    setTimeoutMs: (timeoutMs) => get().updateActiveRequest({ timeoutMs }),
    setVerifyTls: (verifyTls) => get().updateActiveRequest({ verifyTls }),
    setRedirectPolicy: (redirectPolicy) => get().updateActiveRequest({ redirectPolicy }),
    setMaxRedirects: (maxRedirects) => get().updateActiveRequest({ maxRedirects }),
    setProxyUrl: (proxyUrl) => get().updateActiveRequest({ proxyUrl }),
    setClientCert: (clientCert) => get().updateActiveRequest({ clientCert }),
    setProtocol: (protocol) => get().updateActiveRequest({ protocol }),
    setGraphqlQuery: (graphqlQuery) => get().updateActiveRequest({ graphqlQuery }),
    setGraphqlVariables: (graphqlVariables) => get().updateActiveRequest({ graphqlVariables }),
    setPreScript: (preScript) => get().updateActiveRequest({ preScript }),
    setTestScript: (testScript) => get().updateActiveRequest({ testScript }),
    setTags: (tags) => get().updateActiveRequest({ tags }),

    sendRequest: async () => {
      const state = get();
      const req = activeTab(state);
      if (!req || !req.url) return;
      // Streaming protocols (WS, SSE) have their own connect/disconnect flow
      // (wsConnect / sseConnect). Cmd+Enter is wired to sendRequest globally,
      // so without this guard hitting the shortcut on an SSE tab would fire
      // an HTTP GET against the event-stream endpoint and try to buffer the
      // entire long-lived response.
      if (req.protocol === "websocket" || req.protocol === "sse") return;

      const reqId = req.id;
      set((s) => ({
        loadings: { ...s.loadings, [reqId]: true },
        errors: { ...s.errors, [reqId]: null },
        responses: { ...s.responses, [reqId]: null },
        testResults: { ...s.testResults, [reqId]: null },
        scriptLogs: { ...s.scriptLogs, [reqId]: null },
        scriptError: { ...s.scriptError, [reqId]: null },
        ...syncDerived({
          ...s,
          loadings: { ...s.loadings, [reqId]: true },
          errors: { ...s.errors, [reqId]: null },
          responses: { ...s.responses, [reqId]: null },
        }),
      }));

      // Build variable map from the full scope hierarchy: global → collection
      // → folder(s) → environment. Pre/post scripts may mutate this map; if
      // anything changes we persist back to the active environment so the
      // change sticks across requests / restarts. (Scripts can only mutate
      // the environment layer — global/collection/folder vars require
      // explicit user edits via their UIs.)
      const envVars = buildScopedVars({
        workspace: state.workspace,
        collections: state.collections,
        environments: state.environments,
        request: req,
      });
      // Snapshot the baseline so we can later attribute script mutations
      // back to the env layer (and not mistake a global/collection var for
      // a new env var).
      const baseline = { ...envVars };
      const activeEnvId = state.workspace?.active_environment_id;
      const activeEnv = activeEnvId
        ? state.environments.find((e) => e.id === activeEnvId)
        : undefined;
      const transientVars: Record<string, string> = {};

      let result: Awaited<ReturnType<typeof executeRequestWithScripts>>;
      try {
        result = await executeRequestWithScripts({
          request: req,
          collections: get().collections,
          envVars,
          transientVars,
          defaults: {
            defaultTimeoutMs: get().defaultTimeoutMs,
            verifyTlsDefault: get().verifyTlsDefault,
          },
        });
      } catch (err) {
        // Bubble-up failures from the script worker (worker import failure,
        // unexpected exceptions) — never leave the loading spinner stuck.
        const msg = err instanceof Error ? err.message : String(err);
        set((s) => ({
          errors: { ...s.errors, [reqId]: msg },
          loadings: { ...s.loadings, [reqId]: false },
          ...syncDerived({
            ...s,
            errors: { ...s.errors, [reqId]: msg },
            loadings: { ...s.loadings, [reqId]: false },
          }),
        }));
        return;
      }

      // Persist script-induced mutations to the env layer only. Script writes
      // are diffed against the pre-script `baseline`, so changes coming from
      // the global / collection / folder layers don't leak into env. Deletions
      // are only honored for keys that originally lived in env (we can't
      // delete from lower scopes through a script).
      if (activeEnv) {
        const changes: Record<string, string> = {};
        for (const [k, v] of Object.entries(envVars)) {
          if (baseline[k] !== v) changes[k] = v;
        }
        const envKeys = new Set(
          activeEnv.variables.filter((v) => v.enabled && v.key).map((v) => v.key)
        );
        const deletions = Object.keys(baseline).filter(
          (k) => !(k in envVars) && envKeys.has(k)
        );
        if (Object.keys(changes).length > 0 || deletions.length > 0) {
          const nextVars = activeEnv.variables
            .filter((v) => !v.enabled || !v.key || !deletions.includes(v.key))
            .map((v) =>
              v.enabled && v.key && v.key in changes
                ? { ...v, value: changes[v.key] }
                : v
            );
          for (const k of Object.keys(changes)) {
            if (!activeEnv.variables.some((v) => v.key === k)) {
              nextVars.push({ key: k, value: changes[k], enabled: true, is_secret: false });
            }
          }
          // Fire-and-forget so a save failure doesn't mask the response.
          get()
            .updateEnvironment({ ...activeEnv, variables: nextVars })
            .catch((e) => console.error("Failed to persist env mutations:", e));
        }
      }

      if (!get().loadings[reqId]) return;

      if (result.error) {
        set((s) => ({
          errors: { ...s.errors, [reqId]: result.error ?? null },
          loadings: { ...s.loadings, [reqId]: false },
          scriptLogs: { ...s.scriptLogs, [reqId]: result.logs },
          scriptError: { ...s.scriptError, [reqId]: result.scriptError ?? null },
          ...syncDerived({
            ...s,
            errors: { ...s.errors, [reqId]: result.error ?? null },
            loadings: { ...s.loadings, [reqId]: false },
          }),
        }));
        return;
      }

      set((s) => {
        const prevHistory = s.responseHistory[reqId] ?? [];
        const nextHistory = result.response
          ? [
              { id: generateId(), takenAt: Date.now(), response: result.response },
              ...prevHistory,
            ].slice(0, 10)
          : prevHistory;
        return {
          responses: { ...s.responses, [reqId]: result.response ?? null },
          loadings: { ...s.loadings, [reqId]: false },
          testResults: { ...s.testResults, [reqId]: result.tests },
          scriptLogs: { ...s.scriptLogs, [reqId]: result.logs },
          scriptError: { ...s.scriptError, [reqId]: result.scriptError ?? null },
          responseHistory: { ...s.responseHistory, [reqId]: nextHistory },
          ...syncDerived({
            ...s,
            responses: { ...s.responses, [reqId]: result.response ?? null },
            loadings: { ...s.loadings, [reqId]: false },
          }),
        };
      });
      if (result.response) {
        get().addToHistory(req, result.response);
      }
    },

    clearResponseHistory: (requestId: string) => {
      set((s) => ({
        responseHistory: { ...s.responseHistory, [requestId]: [] },
      }));
    },

    cancelRequest: () => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      if (!state.loadings[req.id]) return;
      invoke("cancel_request", { requestId: req.id }).catch(() => {});
      set((s) => ({
        loadings: { ...s.loadings, [req.id]: false },
        errors: { ...s.errors, [req.id]: "Request cancelled" },
        ...syncDerived({
          ...s,
          loadings: { ...s.loadings, [req.id]: false },
          errors: { ...s.errors, [req.id]: "Request cancelled" },
        }),
      }));
    },

    createNewRequest: () => {
      const newReq = createNewRequest();
      get().openTab(newReq);
    },

    addToHistory: (request, response) => {
      const { workspace } = get();
      const entry = requestToHistoryEntry(request, response, workspace?.id);
      invoke("save_history", { entry }).catch((err) => console.error("Failed to save history:", err));
      set((state) => {
        const exists = state.history.find((r) => r.id === request.id);
        if (exists) {
          return {
            history: state.history.map((r) => (r.id === request.id ? { ...request, createdAt: Date.now() } : r)),
          };
        }
        return { history: [{ ...request, createdAt: Date.now() }, ...state.history].slice(0, 50) };
      });
    },

    deleteRequestFromHistory: (id) => {
      invoke("delete_history", { id }).catch((err) => console.error("Failed to delete history:", err));
      set((state) => ({ history: state.history.filter((r) => r.id !== id) }));
    },

    clearAllHistory: async () => {
      await invoke("clear_history");
      set({ history: [] });
    },

    loadFromHistory: (id) => {
      const { history } = get();
      const request = history.find((r) => r.id === id);
      if (!request) return;
      // Clone the request into a fresh tab id to avoid stomping the history entry.
      const cloned: RequestItem = { ...request, id: generateId() };
      get().openTab(cloned);
    },

    searchHistory: async (query) => {
      try {
        const { workspace } = get();
        const entries = await invoke<HistoryEntry[]>("search_history", {
          workspaceId: workspace?.id,
          query,
        });
        const history = entries.map(historyEntryToRequest);
        set({ history });
      } catch (err) {
        console.error("Failed to search history:", err);
      }
    },

    reorderHistory: (fromId, toId) => {
      const { history } = get();
      const from = history.findIndex((r) => r.id === fromId);
      const to = history.findIndex((r) => r.id === toId);
      if (from === -1 || to === -1 || from === to) return;
      const next = [...history];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      set({ history: next });
    },

    // === Collections ===

    addCollection: async (name) => {
      const now = Date.now();
      const { workspace } = get();
      const collection: Collection = {
        id: generateId(),
        name,
        description: "",
        requests: [],
        folders: [],
        created_at: now,
        updated_at: now,
        workspace_id: workspace?.id,
      };
      await invoke("save_collection", { collection });
      set((state) => ({ collections: [...state.collections, collection] }));
    },

    deleteCollection: async (id) => {
      await invoke("delete_collection", { id });
      set((state) => ({ collections: state.collections.filter((c) => c.id !== id) }));
    },

    renameCollection: async (id, name) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === id);
      if (!col) return;
      const updated = { ...col, name, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({ collections: state.collections.map((c) => (c.id === id ? updated : c)) }));
    },

    addRequestToCollection: async (collectionId) => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      const col = state.collections.find((c) => c.id === collectionId);
      if (!col) return;
      const now = Date.now();
      // Default new collection requests to inheriting auth from the
      // collection/folder. If the user already configured concrete auth on
      // this tab, keep it.
      const auth: AuthConfig =
        req.auth && req.auth.auth_type !== "inherit"
          ? req.auth
          : { auth_type: "inherit" };
      const colReq: CollectionRequest = {
        id: req.id,
        name: req.name,
        method: req.method,
        url: req.url,
        headers: req.headers,
        params: req.params,
        body: req.body,
        body_type: req.bodyType,
        auth,
        pre_script: req.preScript,
        test_script: req.testScript,
        tags: req.tags,
        created_at: req.createdAt,
        updated_at: now,
      };
      // Tag the open tab with its source collection so future inheritance
      // resolution works without a reload.
      set((s) => ({
        ...updateActiveTab(s, { collectionId, auth }),
      }));
      const updated = { ...col, requests: [...col.requests, colReq], updated_at: now };
      await invoke("save_collection", { collection: updated });
      set((s) => ({ collections: s.collections.map((c) => (c.id === collectionId ? updated : c)) }));
    },

    loadRequestFromCollection: (collectionId, requestId) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const req = findRequestInCollection(col, requestId);
      if (!req) return;
      const requestItem: RequestItem = {
        // Keep the original collection request id (not a freshly generated
        // one) so the auth-inheritance walker can locate this request's
        // parent folder inside the collection tree. Re-opening the same
        // collection request reactivates the existing tab.
        id: req.id,
        name: req.name,
        method: req.method as HttpMethod,
        url: req.url,
        headers: req.headers.length > 0 ? req.headers : [createEmptyKeyValue()],
        params: req.params.length > 0 ? req.params : [createEmptyKeyValue()],
        body: req.body,
        bodyType: req.body_type as RequestItem["bodyType"],
        formData: [createEmptyKeyValue()],
        auth: req.auth,
        collectionId,
        preScript: req.pre_script,
        testScript: req.test_script,
        tags: req.tags,
        protocol: "http",
        createdAt: req.created_at,
      };
      get().openTab(requestItem);
    },

    deleteRequestFromCollection: async (collectionId, requestId) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      // Walk the whole tree — requests can live inside nested folders
      // since the folder UI shipped. The earlier root-only filter silently
      // succeeded for nested requests.
      const next = removeRequestFromTree(col, requestId);
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({ collections: state.collections.map((c) => (c.id === collectionId ? updated : c)) }));
    },

    renameRequestInCollection: async (collectionId, requestId, name) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      // Walk the tree for the same reason as deleteRequestFromCollection.
      const next = renameRequestInTree(col, requestId, name);
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({ collections: state.collections.map((c) => (c.id === collectionId ? updated : c)) }));
    },

    reorderCollections: (fromId, toId) => {
      const { collections } = get();
      const from = collections.findIndex((c) => c.id === fromId);
      const to = collections.findIndex((c) => c.id === toId);
      if (from === -1 || to === -1 || from === to) return;
      const next = [...collections];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      set({ collections: next });
    },

    reorderRequestsInCollection: async (collectionId, fromId, toId) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      // Delegate to the folder-tree helper so reorders also work inside
      // nested folders (not just at the collection root).
      const next = reorderRequestsInContainer(col, fromId, toId);
      if (next === col) return;
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({ collections: state.collections.map((c) => (c.id === collectionId ? updated : c)) }));
    },

    // === Folders ===

    createFolder: async (collectionId, parentFolderId, name) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const folder = createNewFolder(name);
      const container: NodeContainer =
        parentFolderId === null ? { kind: "root" } : { kind: "folder", folderId: parentFolderId };
      const next = addFolderTo(col, container, folder);
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({ collections: state.collections.map((c) => (c.id === collectionId ? updated : c)) }));
    },

    renameFolder: async (collectionId, folderId, name) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const next = renameFolderInTree(col, folderId, name);
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({ collections: state.collections.map((c) => (c.id === collectionId ? updated : c)) }));
    },

    deleteFolder: async (collectionId, folderId) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const next = removeFolder(col, folderId);
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({ collections: state.collections.map((c) => (c.id === collectionId ? updated : c)) }));
    },

    moveRequestToFolder: async (collectionId, requestId, targetFolderId) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const target: NodeContainer =
        targetFolderId === null ? { kind: "root" } : { kind: "folder", folderId: targetFolderId };
      const next = moveRequest(col, requestId, target);
      if (next === col) return;
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({ collections: state.collections.map((c) => (c.id === collectionId ? updated : c)) }));
    },

    moveFolderToFolder: async (collectionId, folderId, targetParentFolderId) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const target: NodeContainer =
        targetParentFolderId === null
          ? { kind: "root" }
          : { kind: "folder", folderId: targetParentFolderId };
      const next = moveFolder(col, folderId, target);
      if (next === col) return;
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({ collections: state.collections.map((c) => (c.id === collectionId ? updated : c)) }));
    },

    reorderFoldersInCollection: async (collectionId, fromFolderId, toFolderId) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      const next = reorderFoldersInContainer(col, fromFolderId, toFolderId);
      if (next === col) return;
      const updated = { ...next, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((state) => ({ collections: state.collections.map((c) => (c.id === collectionId ? updated : c)) }));
    },

    importPostmanCollection: async (data) => {
      const cols = postmanToCollection(data);
      await get().importCollections(cols);
    },

    importCollections: async (cols) => {
      for (const col of cols) {
        await invoke("save_collection", { collection: col });
      }
      set((state) => ({ collections: [...state.collections, ...cols] }));
    },

    updateCollection: async (col) => {
      const updated = { ...col, updated_at: Date.now() };
      await invoke("save_collection", { collection: updated });
      set((s) => ({
        collections: s.collections.map((c) => (c.id === updated.id ? updated : c)),
      }));
    },

    setCollectionAuth: async (collectionId, auth) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      await get().updateCollection({ ...col, auth });
    },

    setCollectionVariables: async (collectionId, variables) => {
      const { collections } = get();
      const col = collections.find((c) => c.id === collectionId);
      if (!col) return;
      await get().updateCollection({ ...col, variables });
    },

    setGlobalVariables: async (variables) => {
      const { workspace } = get();
      if (!workspace) return;
      const updated = { ...workspace, variables, updated_at: Date.now() };
      set({ workspace: updated });
      try {
        await invoke("save_workspace", { workspace: updated });
      } catch (err) {
        console.error("Failed to persist global variables:", err);
      }
    },

    refreshCollections: async () => {
      const { workspace } = get();
      const collections = await invoke<Collection[]>("list_collections", {
        workspaceId: workspace?.id,
      });
      set({ collections });
    },

    // === Environments ===

    addEnvironment: async (name) => {
      const now = Date.now();
      const { workspace } = get();
      const env: Environment = {
        id: generateId(),
        name,
        variables: [],
        created_at: now,
        updated_at: now,
        workspace_id: workspace?.id,
      };
      await invoke("save_environment", { env });
      set((state) => ({ environments: [...state.environments, env] }));
    },

    deleteEnvironment: async (id) => {
      await invoke("delete_environment", { id });
      set((state) => ({ environments: state.environments.filter((e) => e.id !== id) }));
    },

    updateEnvironment: async (env) => {
      const updated = { ...env, updated_at: Date.now() };
      await invoke("save_environment", { env: updated });
      set((state) => ({ environments: state.environments.map((e) => (e.id === env.id ? updated : e)) }));
    },

    refreshEnvironments: async () => {
      const { workspace } = get();
      const environments = await invoke<Environment[]>("list_environments", {
        workspaceId: workspace?.id,
      });
      set({ environments });
    },

    setActiveEnvironment: (id) => {
      set((state) => ({
        workspace: state.workspace ? { ...state.workspace, active_environment_id: id ?? undefined } : null,
      }));
      get().saveWorkspaceState();
    },

    setWindowState: (patch) => {
      set((state) => {
        if (!state.workspace) return state;
        const next = { ...(state.workspace.window_state ?? {}), ...patch };
        return {
          workspace: { ...state.workspace, window_state: next },
        };
      });
      get().saveWorkspaceState();
    },

    persistTabsState: () => {
      if (persistTabsTimer) clearTimeout(persistTabsTimer);
      persistTabsTimer = setTimeout(() => {
        persistTabsTimer = null;
        const state = get();
        if (!state.workspace) return;
        const next = {
          ...(state.workspace.window_state ?? {}),
          open_tabs: state.tabs,
          active_tab_id: state.activeTabId ?? undefined,
        };
        const updated: Workspace = {
          ...state.workspace,
          window_state: next,
          updated_at: Date.now(),
        };
        // Reflect locally so subsequent reads see the new state. Avoid the
        // standard `setWindowState` action so we don't fire a redundant
        // workspace save — the invoke below handles it.
        set({ workspace: updated });
        invoke("save_workspace", { workspace: updated }).catch((err) =>
          console.error("Failed to persist tabs:", err)
        );
      }, 500);
    },

    // === Cookies ===

    refreshCookies: async () => {
      try {
        const cookies = await invoke<CookieEntry[]>("get_all_cookies");
        set({ cookies });
      } catch (err) {
        console.error("Failed to load cookies:", err);
      }
    },

    deleteCookie: async (id) => {
      await invoke("delete_cookie", { id });
      set((state) => ({ cookies: state.cookies.filter((c) => c.id !== id) }));
    },

    clearCookiesByDomain: async (domain) => {
      await invoke("clear_cookies_by_domain", { domain });
      set((state) => ({ cookies: state.cookies.filter((c) => c.domain !== domain) }));
    },

    // === Settings ===

    setDefaultTimeoutMs: async (ms) => {
      try {
        await invoke("set_setting", { key: "default_timeout_ms", value: String(ms) });
      } catch (err) {
        console.error("Failed to persist default timeout:", err);
      }
      set({ defaultTimeoutMs: ms });
    },

    setVerifyTlsDefault: async (verify) => {
      try {
        await invoke("set_setting", { key: "verify_tls_default", value: verify ? "true" : "false" });
      } catch (err) {
        console.error("Failed to persist verify-tls default:", err);
      }
      set({ verifyTlsDefault: verify });
    },

    // === WebSocket ===

    wsConnect: async () => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      const reqId = req.id;

      // Variable substitution honors the full scope hierarchy.
      const envVars = buildScopedVars({
        workspace: state.workspace,
        collections: state.collections,
        environments: state.environments,
        request: req,
      });
      const sub = (str: string) => substituteAll(str, (key) => envVars[key]);

      try {
        set((s) => ({
          wsMessages: { ...s.wsMessages, [reqId]: [] },
          errors: { ...s.errors, [reqId]: null },
          ...syncDerived({ ...s, errors: { ...s.errors, [reqId]: null } }),
        }));
        await invoke("ws_connect", {
          payload: {
            url: sub(req.url),
            headers: req.headers.filter((h) => h.enabled && h.key).map((h) => ({ key: sub(h.key), value: sub(h.value), enabled: true, is_file: false, file_path: null })),
            request_id: reqId,
          },
        });
      } catch (err) {
        set((s) => ({
          errors: { ...s.errors, [reqId]: String(err) },
          ...syncDerived({ ...s, errors: { ...s.errors, [reqId]: String(err) } }),
        }));
      }
    },

    wsSend: async (text) => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      try {
        await invoke("ws_send", { requestId: req.id, text });
        set((s) => ({
          wsMessages: {
            ...s.wsMessages,
            [req.id]: [
              ...(s.wsMessages[req.id] || []),
              { id: generateId(), direction: "sent", text, ts: Date.now() } as WsMessage,
            ],
          },
        }));
      } catch (err) {
        set((s) => ({
          errors: { ...s.errors, [req.id]: String(err) },
          ...syncDerived({ ...s, errors: { ...s.errors, [req.id]: String(err) } }),
        }));
      }
    },

    wsClose: async () => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      try {
        await invoke("ws_close", { requestId: req.id });
      } catch {}
    },

    appendWsEvent: (requestId, kind, text) => {
      set((s) => {
        const list = s.wsMessages[requestId] || [];
        const msg: WsMessage = {
          id: generateId(),
          direction: kind === "message" ? "received" : "system",
          text: text || (kind === "open" ? "(connected)" : kind === "close" ? "(closed)" : kind === "error" ? "(error)" : kind),
          ts: Date.now(),
        };
        return {
          wsMessages: { ...s.wsMessages, [requestId]: [...list, msg] },
          wsConnected: { ...s.wsConnected, [requestId]: kind === "open" ? true : kind === "close" || kind === "error" ? false : !!s.wsConnected[requestId] },
        };
      });
    },

    // === Server-Sent Events ===

    sseConnect: async () => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      const reqId = req.id;

      // Variable substitution honors the full scope hierarchy. SSE has no
      // request body so there's nothing else to substitute beyond URL/headers.
      const envVars = buildScopedVars({
        workspace: state.workspace,
        collections: state.collections,
        environments: state.environments,
        request: req,
      });
      const sub = (str: string) => substituteAll(str, (key) => envVars[key]);

      try {
        set((s) => ({
          sseEvents: { ...s.sseEvents, [reqId]: [] },
          errors: { ...s.errors, [reqId]: null },
          ...syncDerived({ ...s, errors: { ...s.errors, [reqId]: null } }),
        }));
        await invoke("sse_connect", {
          payload: {
            url: sub(req.url),
            headers: req.headers
              .filter((h) => h.enabled && h.key)
              .map((h) => ({
                key: sub(h.key),
                value: sub(h.value),
                enabled: true,
                is_file: false,
                file_path: null,
              })),
            request_id: reqId,
            verify_tls: req.verifyTls,
            timeout_ms: req.timeoutMs ?? state.defaultTimeoutMs,
          },
        });
      } catch (err) {
        set((s) => ({
          errors: { ...s.errors, [reqId]: String(err) },
          ...syncDerived({ ...s, errors: { ...s.errors, [reqId]: String(err) } }),
        }));
      }
    },

    sseClose: async () => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      try {
        await invoke("sse_close", { requestId: req.id });
      } catch {}
    },

    appendSseEvent: (requestId, kind, detail) => {
      set((s) => {
        const list = s.sseEvents[requestId] || [];
        const next: SseEventRecord = {
          id: generateId(),
          ts: Date.now(),
          kind: kind as SseEventRecord["kind"],
          event: detail.event,
          data: detail.data,
          lastEventId: detail.id,
          retry: detail.retry,
          error: detail.error,
        };
        const connectedNext =
          kind === "open"
            ? true
            : kind === "close" || kind === "error"
              ? false
              : !!s.sseConnected[requestId];
        return {
          sseEvents: { ...s.sseEvents, [requestId]: [...list, next] },
          sseConnected: { ...s.sseConnected, [requestId]: connectedNext },
        };
      });
    },

    // === Workspace ===

    saveWorkspaceState: async () => {
      const { workspace } = get();
      if (!workspace) return;
      const updated = { ...workspace, updated_at: Date.now() };
      invoke("save_workspace", { workspace: updated }).catch((err) =>
        console.error("Failed to save workspace:", err)
      );
    },

    switchWorkspace: async (workspaceId) => {
      const { workspaces, workspace: current } = get();
      if (current?.id === workspaceId) return;
      const target = workspaces.find((w) => w.id === workspaceId);
      if (!target) {
        console.error("Cannot switch to unknown workspace:", workspaceId);
        return;
      }

      // Cancel any in-flight requests and close any open streams from the old
      // workspace's tabs — they're scoped to the previous workspace and
      // shouldn't survive the switch.
      const prev = get();
      Object.entries(prev.loadings)
        .filter(([, v]) => v)
        .forEach(([id]) => invoke("cancel_request", { requestId: id }).catch(() => {}));
      Object.entries(prev.wsConnected)
        .filter(([, v]) => v)
        .forEach(([id]) => invoke("ws_close", { requestId: id }).catch(() => {}));
      Object.entries(prev.sseConnected)
        .filter(([, v]) => v)
        .forEach(([id]) => invoke("sse_close", { requestId: id }).catch(() => {}));

      // Flush any pending tab persistence for the workspace we're leaving so
      // we don't lose recently typed-into tabs across the switch.
      if (persistTabsTimer) {
        clearTimeout(persistTabsTimer);
        persistTabsTimer = null;
        if (prev.workspace) {
          const window_state = {
            ...(prev.workspace.window_state ?? {}),
            open_tabs: prev.tabs,
            active_tab_id: prev.activeTabId ?? undefined,
          };
          const flushed: Workspace = {
            ...prev.workspace,
            window_state,
            updated_at: Date.now(),
          };
          invoke("save_workspace", { workspace: flushed }).catch((err) =>
            console.error("Failed to flush previous workspace tabs:", err)
          );
        }
      }

      try {
        const [collections, environments, historyEntries] = await Promise.all([
          invoke<Collection[]>("list_collections", { workspaceId }),
          invoke<Environment[]>("list_environments", { workspaceId }),
          invoke<HistoryEntry[]>("get_history", {
            workspaceId,
            limit: 50,
            offset: 0,
          }),
        ]);
        const history = historyEntries.map(historyEntryToRequest);

        // Restore the target workspace's tabs from its window_state, if any.
        // Falls back to a single fresh blank tab when no snapshot exists.
        const savedTabs = target.window_state?.open_tabs;
        const savedActiveId = target.window_state?.active_tab_id;
        const hasSnapshot = Array.isArray(savedTabs) && savedTabs.length > 0;
        const restoredTabs = hasSnapshot ? savedTabs! : [createNewRequest()];
        const restoredActiveId = hasSnapshot
          ? (savedActiveId && restoredTabs.some((t) => t.id === savedActiveId)
              ? savedActiveId
              : restoredTabs[0].id)
          : restoredTabs[0].id;

        set((s) => ({
          workspace: target,
          collections,
          environments,
          history,
          tabs: restoredTabs,
          activeTabId: restoredActiveId,
          responses: {},
          errors: {},
          loadings: {},
          testResults: {},
          scriptLogs: {},
          scriptError: {},
          responseHistory: {},
          wsConnected: {},
          wsMessages: {},
          sseConnected: {},
          sseEvents: {},
          ...syncDerived({
            ...s,
            tabs: restoredTabs,
            activeTabId: restoredActiveId,
            responses: {},
            errors: {},
            loadings: {},
          }),
        }));
      } catch (err) {
        console.error("Failed to switch workspace:", err);
      }
    },

    createWorkspace: async (name) => {
      const ws = await invoke<Workspace>("create_workspace", { name });
      set((s) => ({ workspaces: [...s.workspaces, ws] }));
      await get().switchWorkspace(ws.id);
      return ws;
    },

    renameWorkspace: async (id, name) => {
      const { workspaces, workspace } = get();
      const target = workspaces.find((w) => w.id === id);
      if (!target) return;
      const updated: Workspace = { ...target, name, updated_at: Date.now() };
      await invoke("save_workspace", { workspace: updated });
      set((s) => ({
        workspaces: s.workspaces.map((w) => (w.id === id ? updated : w)),
        workspace: workspace?.id === id ? updated : s.workspace,
      }));
    },

    deleteWorkspace: async (id) => {
      const { workspaces, workspace } = get();
      if (workspaces.length <= 1) {
        throw new Error("Cannot delete the last remaining workspace.");
      }
      await invoke("delete_workspace", { id });
      const remaining = workspaces.filter((w) => w.id !== id);
      set({ workspaces: remaining });
      if (workspace?.id === id) {
        // Switch to whichever workspace is left, preferring the oldest.
        const fallback = remaining[0];
        await get().switchWorkspace(fallback.id);
      }
    },

    refreshWorkspaces: async () => {
      const workspaces = await invoke<Workspace[]>("list_workspaces");
      set({ workspaces });
    },
  };
});
