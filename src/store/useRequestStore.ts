import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  HttpMethod,
  KeyValue,
  RequestItem,
  ResponseData,
  Collection,
  HistoryEntry,
  Environment,
  Workspace,
  AuthConfig,
} from "../types";

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

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
    createdAt: Date.now(),
  };
}

// Convert RequestItem <-> HistoryEntry for SQLite persistence
function requestToHistoryEntry(req: RequestItem, response?: ResponseData | null): HistoryEntry {
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
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
  };
}

interface RequestState {
  // Data
  collections: Collection[];
  environments: Environment[];
  workspace: Workspace | null;
  activeRequestId: string | null;
  activeRequest: RequestItem | null;
  response: ResponseData | null;
  loading: boolean;
  error: string | null;
  history: RequestItem[];
  initialized: boolean;

  // Actions
  initialize: () => Promise<void>;
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
  sendRequest: () => Promise<void>;
  cancelRequest: () => void;
  createNewRequest: () => void;
  addToHistory: (request: RequestItem, response?: ResponseData | null) => void;
  deleteRequestFromHistory: (id: string) => void;
  clearAllHistory: () => Promise<void>;
  loadFromHistory: (id: string) => void;
  searchHistory: (query: string) => Promise<void>;
  // Collections
  addCollection: (name: string) => Promise<void>;
  deleteCollection: (id: string) => Promise<void>;
  renameCollection: (id: string, name: string) => Promise<void>;
  addRequestToCollection: (collectionId: string) => Promise<void>;
  loadRequestFromCollection: (collectionId: string, requestId: string) => void;
  deleteRequestFromCollection: (collectionId: string, requestId: string) => Promise<void>;
  refreshCollections: () => Promise<void>;
  // Environments
  addEnvironment: (name: string) => Promise<void>;
  deleteEnvironment: (id: string) => Promise<void>;
  updateEnvironment: (env: Environment) => Promise<void>;
  refreshEnvironments: () => Promise<void>;
  setActiveEnvironment: (id: string | null) => void;
  // Workspace
  saveWorkspaceState: () => Promise<void>;
}

export const useRequestStore = create<RequestState>((set, get) => ({
  collections: [],
  environments: [],
  workspace: null,
  activeRequestId: null,
  activeRequest: createNewRequest(),
  response: null,
  loading: false,
  error: null,
  history: [],
  initialized: false,

  initialize: async () => {
    try {
      // Load workspace
      const workspace = await invoke<Workspace>("load_default_workspace");

      // Load history from SQLite
      const historyEntries = await invoke<HistoryEntry[]>("get_history", { limit: 50, offset: 0 });
      const history = historyEntries.map(historyEntryToRequest);

      // Load collections from filesystem
      const collections = await invoke<Collection[]>("list_collections");

      // Load environments from filesystem
      const environments = await invoke<Environment[]>("list_environments");

      set({
        workspace,
        history,
        collections,
        environments,
        initialized: true,
      });
    } catch (err) {
      console.error("Failed to initialize store:", err);
      set({ initialized: true });
    }
  },

  setActiveRequest: (request) =>
    set({ activeRequest: request, activeRequestId: request.id }),

  updateActiveRequest: (partial) =>
    set((state) => ({
      activeRequest: state.activeRequest
        ? { ...state.activeRequest, ...partial }
        : null,
    })),

  setMethod: (method) =>
    set((state) => ({
      activeRequest: state.activeRequest
        ? { ...state.activeRequest, method }
        : null,
    })),

  setUrl: (url) =>
    set((state) => ({
      activeRequest: state.activeRequest
        ? { ...state.activeRequest, url }
        : null,
    })),

  setHeaders: (headers) =>
    set((state) => ({
      activeRequest: state.activeRequest
        ? { ...state.activeRequest, headers }
        : null,
    })),

  setParams: (params) =>
    set((state) => ({
      activeRequest: state.activeRequest
        ? { ...state.activeRequest, params }
        : null,
    })),

  setBody: (body) =>
    set((state) => ({
      activeRequest: state.activeRequest
        ? { ...state.activeRequest, body }
        : null,
    })),

  setBodyType: (bodyType) =>
    set((state) => ({
      activeRequest: state.activeRequest
        ? { ...state.activeRequest, bodyType }
        : null,
    })),

  setFormData: (formData) =>
    set((state) => ({
      activeRequest: state.activeRequest
        ? { ...state.activeRequest, formData }
        : null,
    })),

  setAuth: (auth) =>
    set((state) => ({
      activeRequest: state.activeRequest
        ? { ...state.activeRequest, auth }
        : null,
    })),

  setName: (name) =>
    set((state) => ({
      activeRequest: state.activeRequest
        ? { ...state.activeRequest, name }
        : null,
    })),

  sendRequest: async () => {
    const { activeRequest, environments, workspace } = get();
    if (!activeRequest || !activeRequest.url) return;

    set({ loading: true, error: null, response: null });

    // Build variable map from active environment
    const envVars: Record<string, string> = {};
    const activeEnvId = workspace?.active_environment_id;
    if (activeEnvId) {
      const activeEnv = environments.find((e) => e.id === activeEnvId);
      if (activeEnv) {
        for (const v of activeEnv.variables) {
          if (v.enabled && v.key) envVars[v.key] = v.value;
        }
      }
    }

    // Substitute {{var}} in a string
    const sub = (str: string) => str.replace(/\{\{(\w+)\}\}/g, (_, key) => envVars[key] ?? `{{${key}}}`);

    try {
      let finalUrl = sub(activeRequest.url);
      const enabledParams = activeRequest.params.filter(
        (p) => p.enabled && p.key
      );
      if (enabledParams.length > 0) {
        const queryString = enabledParams
          .map(
            (p) =>
              `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`
          )
          .join("&");
        const separator = finalUrl.includes("?") ? "&" : "?";
        finalUrl = `${finalUrl}${separator}${queryString}`;
      }

      const headers = activeRequest.headers
        .filter((h) => h.enabled && h.key)
        .map((h) => ({
          key: sub(h.key),
          value: sub(h.value),
          enabled: h.enabled,
        }));

      // Inject auth headers
      const auth = activeRequest.auth;
      if (auth && auth.auth_type !== "none") {
        if (auth.auth_type === "bearer" && auth.bearer_token) {
          headers.push({ key: "Authorization", value: `Bearer ${auth.bearer_token}`, enabled: true });
        } else if (auth.auth_type === "basic" && auth.basic_username) {
          const encoded = btoa(`${auth.basic_username}:${auth.basic_password || ""}`);
          headers.push({ key: "Authorization", value: `Basic ${encoded}`, enabled: true });
        } else if (auth.auth_type === "api_key" && auth.api_key_key && auth.api_key_in === "header") {
          headers.push({ key: auth.api_key_key, value: auth.api_key_value || "", enabled: true });
        }
      }

      // Auto Content-Type
      if (activeRequest.bodyType === "json" && !headers.some((h) => h.key.toLowerCase() === "content-type")) {
        headers.push({ key: "Content-Type", value: "application/json", enabled: true });
      } else if (activeRequest.bodyType === "xml" && !headers.some((h) => h.key.toLowerCase() === "content-type")) {
        headers.push({ key: "Content-Type", value: "application/xml", enabled: true });
      } else if (activeRequest.bodyType === "text" && !headers.some((h) => h.key.toLowerCase() === "content-type")) {
        headers.push({ key: "Content-Type", value: "text/plain", enabled: true });
      }

      // API Key in query params
      if (auth?.auth_type === "api_key" && auth.api_key_in === "query" && auth.api_key_key) {
        const sep = finalUrl.includes("?") ? "&" : "?";
        finalUrl = `${finalUrl}${sep}${encodeURIComponent(auth.api_key_key)}=${encodeURIComponent(auth.api_key_value || "")}`;
      }

      // Build form data entries
      const formDataEntries = activeRequest.bodyType === "form-data"
        ? activeRequest.formData
            .filter((f) => f.enabled && f.key)
            .map((f) => ({ key: f.key, value: f.value, enabled: f.enabled }))
        : null;

      const payload = {
        method: activeRequest.method,
        url: finalUrl,
        headers,
        body:
          activeRequest.bodyType !== "none" && activeRequest.bodyType !== "form-data"
            ? sub(activeRequest.body || "")  || null
            : null,
        body_type:
          activeRequest.bodyType !== "none" ? activeRequest.bodyType : null,
        form_data: formDataEntries,
        timeout_ms: 30000,
        request_id: activeRequest.id,
      };

      const response = await invoke<ResponseData>("send_request", { payload });
      if (get().loading) {
        set({ response, loading: false });
        get().addToHistory(activeRequest, response);
      }
    } catch (err) {
      if (get().loading) {
        set({ error: String(err), loading: false });
      }
    }
  },

  cancelRequest: () => {
    const { loading, activeRequest } = get();
    if (!loading || !activeRequest) return;
    invoke("cancel_request", { requestId: activeRequest.id }).catch(() => {});
    set({ loading: false, error: "Request cancelled" });
  },

  createNewRequest: () => {
    const newReq = createNewRequest();
    set({ activeRequest: newReq, activeRequestId: newReq.id, response: null, error: null });
  },

  addToHistory: (request, response) => {
    const entry = requestToHistoryEntry(request, response);
    // Persist to SQLite (fire and forget)
    invoke("save_history", { entry }).catch((err) =>
      console.error("Failed to save history:", err)
    );

    set((state) => {
      const exists = state.history.find((r) => r.id === request.id);
      if (exists) {
        return {
          history: state.history.map((r) =>
            r.id === request.id ? { ...request, createdAt: Date.now() } : r
          ),
        };
      }
      return { history: [{ ...request, createdAt: Date.now() }, ...state.history].slice(0, 50) };
    });
  },

  deleteRequestFromHistory: (id) => {
    invoke("delete_history", { id }).catch((err) =>
      console.error("Failed to delete history:", err)
    );
    set((state) => ({
      history: state.history.filter((r) => r.id !== id),
    }));
  },

  clearAllHistory: async () => {
    await invoke("clear_history");
    set({ history: [] });
  },

  loadFromHistory: (id) => {
    const { history } = get();
    const request = history.find((r) => r.id === id);
    if (request) {
      set({ activeRequest: { ...request }, activeRequestId: request.id, response: null, error: null });
    }
  },

  searchHistory: async (query) => {
    try {
      const entries = await invoke<HistoryEntry[]>("search_history", { query });
      const history = entries.map(historyEntryToRequest);
      set({ history });
    } catch (err) {
      console.error("Failed to search history:", err);
    }
  },

  // === Collections (filesystem persistence) ===

  addCollection: async (name) => {
    const now = Date.now();
    const collection: Collection = {
      id: generateId(),
      name,
      description: "",
      requests: [],
      folders: [],
      created_at: now,
      updated_at: now,
    };
    await invoke("save_collection", { collection });
    set((state) => ({ collections: [...state.collections, collection] }));
  },

  deleteCollection: async (id) => {
    await invoke("delete_collection", { id });
    set((state) => ({
      collections: state.collections.filter((c) => c.id !== id),
    }));
  },

  renameCollection: async (id, name) => {
    const { collections } = get();
    const col = collections.find((c) => c.id === id);
    if (!col) return;
    const updated = { ...col, name, updated_at: Date.now() };
    await invoke("save_collection", { collection: updated });
    set((state) => ({
      collections: state.collections.map((c) => (c.id === id ? updated : c)),
    }));
  },

  addRequestToCollection: async (collectionId) => {
    const { activeRequest, collections } = get();
    if (!activeRequest) return;
    const col = collections.find((c) => c.id === collectionId);
    if (!col) return;

    const now = Date.now();
    const colReq = {
      id: activeRequest.id,
      name: activeRequest.name,
      method: activeRequest.method,
      url: activeRequest.url,
      headers: activeRequest.headers,
      params: activeRequest.params,
      body: activeRequest.body,
      body_type: activeRequest.bodyType,
      auth: activeRequest.auth,
      created_at: activeRequest.createdAt,
      updated_at: now,
    };

    const updated = {
      ...col,
      requests: [...col.requests, colReq],
      updated_at: now,
    };
    await invoke("save_collection", { collection: updated });
    set((state) => ({
      collections: state.collections.map((c) => (c.id === collectionId ? updated : c)),
    }));
  },

  loadRequestFromCollection: (collectionId, requestId) => {
    const { collections } = get();
    const col = collections.find((c) => c.id === collectionId);
    if (!col) return;
    const req = col.requests.find((r) => r.id === requestId);
    if (!req) return;

    const requestItem: RequestItem = {
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
      createdAt: req.created_at,
    };
    set({ activeRequest: requestItem, activeRequestId: req.id, response: null, error: null });
  },

  deleteRequestFromCollection: async (collectionId, requestId) => {
    const { collections } = get();
    const col = collections.find((c) => c.id === collectionId);
    if (!col) return;

    const updated = {
      ...col,
      requests: col.requests.filter((r) => r.id !== requestId),
      updated_at: Date.now(),
    };
    await invoke("save_collection", { collection: updated });
    set((state) => ({
      collections: state.collections.map((c) => (c.id === collectionId ? updated : c)),
    }));
  },

  refreshCollections: async () => {
    const collections = await invoke<Collection[]>("list_collections");
    set({ collections });
  },

  // === Environments (filesystem persistence) ===

  addEnvironment: async (name) => {
    const now = Date.now();
    const env: Environment = {
      id: generateId(),
      name,
      variables: [],
      created_at: now,
      updated_at: now,
    };
    await invoke("save_environment", { env });
    set((state) => ({ environments: [...state.environments, env] }));
  },

  deleteEnvironment: async (id) => {
    await invoke("delete_environment", { id });
    set((state) => ({
      environments: state.environments.filter((e) => e.id !== id),
    }));
  },

  updateEnvironment: async (env) => {
    const updated = { ...env, updated_at: Date.now() };
    await invoke("save_environment", { env: updated });
    set((state) => ({
      environments: state.environments.map((e) => (e.id === env.id ? updated : e)),
    }));
  },

  refreshEnvironments: async () => {
    const environments = await invoke<Environment[]>("list_environments");
    set({ environments });
  },

  setActiveEnvironment: (id) => {
    set((state) => ({
      workspace: state.workspace
        ? { ...state.workspace, active_environment_id: id ?? undefined }
        : null,
    }));
    get().saveWorkspaceState();
  },

  // === Workspace persistence ===

  saveWorkspaceState: async () => {
    const { workspace } = get();
    if (!workspace) return;
    const updated = { ...workspace, updated_at: Date.now() };
    invoke("save_workspace", { workspace: updated }).catch((err) =>
      console.error("Failed to save workspace:", err)
    );
  },
}));
