import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  HttpMethod,
  RequestItem,
  ResponseData,
  Collection,
  CollectionRequest,
  HistoryEntry,
  Environment,
  Workspace,
  AuthConfig,
  CookieEntry,
  RecentEntry,
} from "../types";
import { activeTab, syncDerived, type RequestState } from "./storeTypes";
import { makeRequestError, toRequestError } from "../utils/requestError";
import { postmanToCollection } from "../utils/postman";
import {
  executeRequestWithScripts,
  pipelineDefaultsFrom,
} from "../utils/requestPipeline";
import { buildScopedVars } from "../utils/variableScope";
import {
  DEFAULT_MAX_HISTORY_BODY_BYTES,
  historyEntryToResponse,
} from "../utils/historySnapshot";
import { resolveAuth, locateAuthSource } from "../utils/auth";
import {
  shouldRefreshOAuth2,
  buildRefreshRequest,
  applyRefreshResult,
  updateFolderAuth,
} from "../utils/oauth2Refresh";
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
import {
  generateId,
  createEmptyKeyValue,
  createNewRequest,
  findRequestInCollection,
  historyEntryToRequest,
  updateActiveTab,
} from "./storeHelpers";
import { createEnvironmentsSlice } from "./slices/environmentsSlice";
import { createHistorySlice } from "./slices/historySlice";
import { createProtocolSlice } from "./slices/protocolSlice";
import { createRecentSlice } from "./slices/recentSlice";
import { createTabSlice } from "./slices/tabSlice";
import { createWorkspaceSlice } from "./slices/workspaceSlice";

// `RequestState`, `activeTab`, and `syncDerived` live in
// `./storeTypes.ts` so slice modules in `./slices/*.ts` can reference
// them without creating a circular import (store → slice → store).

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
    maxBodyBytes: 10 * 1024 * 1024,
    maxHistoryBodyBytes: DEFAULT_MAX_HISTORY_BODY_BYTES,
    defaultRedirectPolicy: "follow",
    defaultMaxRedirects: 10,
    defaultProxyUrl: "",
    historyResponses: {},
    recentItems: [],

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

        let maxBodyBytes = 10 * 1024 * 1024;
        try {
          const stored = await invoke<string | null>("get_setting", { key: "max_body_bytes" });
          if (stored) {
            const v = parseInt(stored, 10);
            if (Number.isFinite(v) && v > 0) maxBodyBytes = v;
          }
        } catch {}

        let maxHistoryBodyBytes = DEFAULT_MAX_HISTORY_BODY_BYTES;
        try {
          const stored = await invoke<string | null>("get_setting", { key: "max_history_body_bytes" });
          if (stored) {
            const v = parseInt(stored, 10);
            if (Number.isFinite(v) && v >= 0) maxHistoryBodyBytes = v;
          }
        } catch {}

        let defaultRedirectPolicy: "follow" | "none" | "manual" = "follow";
        try {
          const stored = await invoke<string | null>("get_setting", { key: "default_redirect_policy" });
          if (stored === "follow" || stored === "none" || stored === "manual") {
            defaultRedirectPolicy = stored;
          }
        } catch {}

        let defaultMaxRedirects = 10;
        try {
          const stored = await invoke<string | null>("get_setting", { key: "default_max_redirects" });
          if (stored) {
            const v = parseInt(stored, 10);
            if (Number.isFinite(v) && v >= 0 && v <= 100) defaultMaxRedirects = v;
          }
        } catch {}

        let defaultProxyUrl = "";
        try {
          const stored = await invoke<string | null>("get_setting", { key: "default_proxy_url" });
          if (stored) defaultProxyUrl = stored;
        } catch {}

        // Pre-warm the response cache so loadFromHistory can restore without
        // a network call.
        const historyResponses: Record<string, ResponseData> = {};
        for (const entry of historyEntries) {
          const r = historyEntryToResponse(entry);
          if (r) historyResponses[entry.id] = r;
        }

        let recentItems: RecentEntry[] = [];
        try {
          recentItems = await invoke<RecentEntry[]>("get_recent", { limit: 30 });
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
          maxBodyBytes,
          maxHistoryBodyBytes,
          defaultRedirectPolicy,
          defaultMaxRedirects,
          defaultProxyUrl,
          historyResponses,
          recentItems,
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

    // === Tabs + active-tab field setters ===
    ...createTabSlice(set, get),

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

      // Pre-flight: auto-refresh an expired OAuth2 token if we have a
      // refresh_token on file. Runs before the loading spinner so the user
      // sees "refreshing…" vs "sending…" latency, but errors here are
      // non-fatal — we'll still attempt the request with the stale token
      // and let the 401 inform the user.
      try { await get().ensureFreshOAuth2(req); } catch { /* best-effort */ }

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

      // Per-scope maps so scripts can mutate each layer independently via
      // pm.globals / pm.collectionVariables. Captured as snapshots here;
      // mutations land back on these maps and we diff to persist below.
      const globalVars: Record<string, string> = {};
      for (const v of state.workspace?.variables ?? []) {
        if (v.enabled && v.key) globalVars[v.key] = v.value;
      }
      const globalBaseline = { ...globalVars };

      const owningCollection = req.collectionId
        ? state.collections.find((c) => c.id === req.collectionId)
        : undefined;
      const collectionVars: Record<string, string> = {};
      for (const v of owningCollection?.variables ?? []) {
        if (v.enabled && v.key) collectionVars[v.key] = v.value;
      }
      const collectionBaseline = { ...collectionVars };

      let result: Awaited<ReturnType<typeof executeRequestWithScripts>>;
      try {
        result = await executeRequestWithScripts({
          request: req,
          collections: get().collections,
          envVars,
          transientVars,
          globalVars,
          collectionVars,
          defaults: pipelineDefaultsFrom(get()),
        });
      } catch (err) {
        // Bubble-up failures from the script worker (worker import failure,
        // unexpected exceptions) — never leave the loading spinner stuck.
        const structured = toRequestError(err);
        set((s) => ({
          errors: { ...s.errors, [reqId]: structured },
          loadings: { ...s.loadings, [reqId]: false },
          ...syncDerived({
            ...s,
            errors: { ...s.errors, [reqId]: structured },
            loadings: { ...s.loadings, [reqId]: false },
          }),
        }));
        return;
      }

      // Persist global-scope mutations (pm.globals.set/unset). Diff against
      // the pre-script baseline so we only touch what the script actually
      // changed.
      if (state.workspace) {
        const globalChanges: Record<string, string> = {};
        for (const [k, v] of Object.entries(globalVars)) {
          if (globalBaseline[k] !== v) globalChanges[k] = v;
        }
        const globalDeletions = Object.keys(globalBaseline).filter(
          (k) => !(k in globalVars),
        );
        if (Object.keys(globalChanges).length > 0 || globalDeletions.length > 0) {
          const prev = state.workspace.variables ?? [];
          const nextVars = prev
            .filter((v) => !v.enabled || !v.key || !globalDeletions.includes(v.key))
            .map((v) =>
              v.enabled && v.key && v.key in globalChanges
                ? { ...v, value: globalChanges[v.key] }
                : v,
            );
          for (const k of Object.keys(globalChanges)) {
            if (!prev.some((v) => v.key === k)) {
              nextVars.push({ key: k, value: globalChanges[k], enabled: true, is_secret: false });
            }
          }
          get()
            .setGlobalVariables(nextVars)
            .catch((e) => console.error("Failed to persist global var mutations:", e));
        }
      }

      // Persist collection-scope mutations (pm.collectionVariables.set/unset).
      if (owningCollection) {
        const colChanges: Record<string, string> = {};
        for (const [k, v] of Object.entries(collectionVars)) {
          if (collectionBaseline[k] !== v) colChanges[k] = v;
        }
        const colDeletions = Object.keys(collectionBaseline).filter(
          (k) => !(k in collectionVars),
        );
        if (Object.keys(colChanges).length > 0 || colDeletions.length > 0) {
          const prev = owningCollection.variables ?? [];
          const nextVars = prev
            .filter((v) => !v.enabled || !v.key || !colDeletions.includes(v.key))
            .map((v) =>
              v.enabled && v.key && v.key in colChanges
                ? { ...v, value: colChanges[v.key] }
                : v,
            );
          for (const k of Object.keys(colChanges)) {
            if (!prev.some((v) => v.key === k)) {
              nextVars.push({ key: k, value: colChanges[k], enabled: true, is_secret: false });
            }
          }
          get()
            .setCollectionVariables(owningCollection.id, nextVars)
            .catch((e) => console.error("Failed to persist collection var mutations:", e));
        }
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

    ensureFreshOAuth2: async (req) => {
      const { collections } = get();
      const auth = resolveAuth(req, collections);
      if (!shouldRefreshOAuth2(auth)) return;

      const payload = buildRefreshRequest(auth!);
      const resp = await invoke<{
        access_token: string;
        expires_at: number | null;
        refresh_token: string | null;
      }>("oauth2_fetch_token", { request: payload });

      const newAuth = applyRefreshResult(auth!, resp);
      const src = locateAuthSource(req, collections);
      if (!src) return;

      switch (src.source) {
        case "request":
          get().updateActiveRequest({ auth: newAuth });
          break;
        case "collection":
          await get().setCollectionAuth(src.collectionId, newAuth);
          break;
        case "folder": {
          const col = collections.find((c) => c.id === src.collectionId);
          if (!col) break;
          const updated = updateFolderAuth(col, src.folderId, newAuth);
          await get().updateCollection(updated);
          break;
        }
      }
    },

    cancelRequest: () => {
      const state = get();
      const req = activeTab(state);
      if (!req) return;
      if (!state.loadings[req.id]) return;
      invoke("cancel_request", { requestId: req.id }).catch(() => {});
      const cancelled = makeRequestError("cancelled", "CANCELLED", "Request cancelled");
      set((s) => ({
        loadings: { ...s.loadings, [req.id]: false },
        errors: { ...s.errors, [req.id]: cancelled },
        ...syncDerived({
          ...s,
          loadings: { ...s.loadings, [req.id]: false },
          errors: { ...s.errors, [req.id]: cancelled },
        }),
      }));
    },

    createNewRequest: () => {
      const newReq = createNewRequest();
      get().openTab(newReq);
    },

    // === History ===
    ...createHistorySlice(set, get),

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
      // Fire-and-forget — don't block the tab switch on persistence.
      get().recordRecent({
        item_type: "request",
        item_id: `${collectionId}:${req.id}`,
        name: req.name,
      }).catch(() => {});
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
    ...createEnvironmentsSlice(set, get),

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

    setMaxBodyBytes: async (bytes) => {
      try {
        await invoke("set_setting", { key: "max_body_bytes", value: String(bytes) });
      } catch (err) {
        console.error("Failed to persist max body bytes:", err);
      }
      set({ maxBodyBytes: bytes });
    },

    setMaxHistoryBodyBytes: async (bytes) => {
      try {
        await invoke("set_setting", { key: "max_history_body_bytes", value: String(bytes) });
      } catch (err) {
        console.error("Failed to persist max history body bytes:", err);
      }
      set({ maxHistoryBodyBytes: bytes });
    },

    setDefaultRedirectPolicy: async (policy) => {
      try {
        await invoke("set_setting", { key: "default_redirect_policy", value: policy });
      } catch (err) {
        console.error("Failed to persist default redirect policy:", err);
      }
      set({ defaultRedirectPolicy: policy });
    },

    setDefaultMaxRedirects: async (n) => {
      try {
        await invoke("set_setting", { key: "default_max_redirects", value: String(n) });
      } catch (err) {
        console.error("Failed to persist default max redirects:", err);
      }
      set({ defaultMaxRedirects: n });
    },

    setDefaultProxyUrl: async (url) => {
      const trimmed = url.trim();
      try {
        await invoke("set_setting", { key: "default_proxy_url", value: trimmed });
      } catch (err) {
        console.error("Failed to persist default proxy URL:", err);
      }
      set({ defaultProxyUrl: trimmed });
    },

    saveActiveRequest: async (target) => {
      const state = get();
      const req = activeTab(state);
      if (!req) return false;
      // Caller-provided target wins; otherwise fall back to whatever
      // collection this tab was opened from. If neither is known the
      // caller must show a picker first.
      const collectionId = target?.collectionId ?? req.collectionId;
      const folderId = target?.folderId ?? null;
      if (!collectionId) return false;
      const col = state.collections.find((c) => c.id === collectionId);
      if (!col) return false;
      const now = Date.now();
      const auth: AuthConfig =
        req.auth && req.auth.auth_type !== "inherit"
          ? req.auth
          : { auth_type: "inherit" };
      const existing = findRequestInCollection(col, req.id);
      const updatedReq: CollectionRequest = {
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
        created_at: existing?.created_at ?? req.createdAt ?? now,
        updated_at: now,
      };

      // Build an updated collection tree, swapping the matching request
      // wherever it lives (root requests[], or any nested folder).
      const replaceInFolders = (folders: typeof col.folders): typeof col.folders =>
        folders.map((f) => ({
          ...f,
          requests: f.requests.map((r) => (r.id === updatedReq.id ? updatedReq : r)),
          folders: replaceInFolders(f.folders),
        }));

      let updated = {
        ...col,
        requests: col.requests.map((r) => (r.id === updatedReq.id ? updatedReq : r)),
        folders: replaceInFolders(col.folders),
        updated_at: now,
      };

      // If the request didn't exist yet anywhere in the tree, append it
      // to the target location (folder if specified, otherwise root).
      if (!existing) {
        if (folderId) {
          const appendToFolder = (folders: typeof col.folders): typeof col.folders =>
            folders.map((f) =>
              f.id === folderId
                ? { ...f, requests: [...f.requests, updatedReq] }
                : { ...f, folders: appendToFolder(f.folders) },
            );
          updated = { ...updated, folders: appendToFolder(updated.folders) };
        } else {
          updated = { ...updated, requests: [...updated.requests, updatedReq] };
        }
      }

      await invoke("save_collection", { collection: updated });
      set((s) => ({
        ...updateActiveTab(s, { collectionId, auth }),
        collections: s.collections.map((c) => (c.id === collectionId ? updated : c)),
      }));
      return true;
    },

    clearAllRecent: async () => {
      try {
        await invoke("clear_recent");
      } catch (err) {
        console.error("Failed to clear recent:", err);
      }
      set({ recentItems: [] });
    },

    clearAllCookies: async () => {
      const { cookies } = get();
      const domains = Array.from(new Set(cookies.map((c) => c.domain).filter(Boolean)));
      for (const domain of domains) {
        try {
          await invoke("clear_cookies_by_domain", { domain });
        } catch (err) {
          console.error(`Failed to clear cookies for ${domain}:`, err);
        }
      }
      set({ cookies: [] });
    },

    // === Recent Opened ===
    ...createRecentSlice(set, get),

    // The implementations live in `slices/protocolSlice.ts` to keep
    // this file focused on non-streaming actions.
    ...createProtocolSlice(set, get),

    // === Workspace + window-state persistence ===
    ...createWorkspaceSlice(set, get),
  };
});

