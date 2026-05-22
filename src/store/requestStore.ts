import { create } from "zustand";
import { sendRequest } from "../lib/tauri";

export type RequestMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";
export type AuthType = "none" | "bearer";

export type KeyValueRow = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};

export type EnvironmentVar = {
  id: string;
  key: string;
  value: string;
};

export type EnvironmentRecord = {
  id: string;
  name: string;
  source: string;
  vars: EnvironmentVar[];
};

export type RequestRecord = {
  id: string;
  name: string;
  collection: string;
  collectionFile: string;
  method: RequestMethod;
  url: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  body: string;
  authType: AuthType;
  authToken: string;
};

export type ResponseSummary = {
  cookieJar: string;
  secretSource: string;
  collectionFile: string;
};

export type ResponseHeader = {
  key: string;
  value: string;
};

export type ResponseTimelineRow = {
  step: string;
  value: string;
};

export type ResponseState = {
  status: string;
  duration: string;
  size: string;
  protocol: string;
  body: string;
  headers: ResponseHeader[];
  timeline: ResponseTimelineRow[];
  summary: ResponseSummary;
};

export type HistoryRecord = {
  id: string;
  title: string;
  meta: string;
  requestId: string;
  method: RequestMethod;
  url: string;
  status: string;
  durationMs: number;
  createdAt: string;
  requestName: string;
  collection: string;
  params: KeyValueRow[];
  headers: KeyValueRow[];
  body: string;
  authType: AuthType;
  authToken: string;
  environment: EnvironmentRecord;
};

export type SecretStatus = {
  name: string;
  exists: boolean;
};

export type RuntimeCacheSummary = {
  directory: string;
  indexFile: string;
  entries: number;
  sizeBytes: number;
  updatedAt: string;
};

export type RuntimeLogSummary = {
  directory: string;
  activeFile: string;
  sizeBytes: number;
  lastLine: string;
  updatedAt: string;
};

export type BootstrapSnapshot = {
  loaded: boolean;
  appDataDir: string;
  databasePath: string;
  environmentsDir: string;
  cacheDir: string;
  logsDir: string;
  recentWorkspace: string;
  runtime: {
    cache: RuntimeCacheSummary;
    logs: RuntimeLogSummary;
  };
  secrets: SecretStatus[];
};

type RequestStore = {
  requests: RequestRecord[];
  environments: EnvironmentRecord[];
  history: HistoryRecord[];
  activeRequestId: string;
  activeEnvironmentId: string;
  activeHistoryId: string | null;
  response: ResponseState;
  bootstrap: BootstrapSnapshot;
  isSending: boolean;
  lastError: string;
  setActiveRequest: (requestId: string) => void;
  setActiveEnvironment: (environmentId: string) => void;
  setActiveHistory: (historyId: string | null) => void;
  updateEnvironmentVar: (
    environmentId: string,
    rowId: string,
    field: "key" | "value",
    value: string,
  ) => void;
  addEnvironmentVar: (environmentId: string) => string;
  removeEnvironmentVar: (environmentId: string, rowId: string) => string;
  upsertEnvironment: (environment: EnvironmentRecord) => void;
  replaceEnvironment: (environment: EnvironmentRecord) => void;
  applyBootstrap: (input: {
    appDataDir: string;
    databasePath: string;
    environmentsDir: string;
    cacheDir: string;
    logsDir: string;
    recentWorkspace: string;
    runtime: BootstrapSnapshot["runtime"];
    history: HistoryRecord[];
    collections: RequestRecord[];
    environments: EnvironmentRecord[];
    secrets: SecretStatus[];
  }) => void;
  updateRequestMethod: (method: RequestMethod) => void;
  updateRequestUrl: (url: string) => void;
  updateRequestBody: (body: string) => void;
  updateAuthType: (authType: AuthType) => void;
  updateAuthToken: (authToken: string) => void;
  updateParamRow: (id: string, field: "key" | "value", value: string) => void;
  updateHeaderRow: (id: string, field: "key" | "value", value: string) => void;
  toggleParamRow: (id: string) => void;
  toggleHeaderRow: (id: string) => void;
  addParamRow: () => string;
  addHeaderRow: () => string;
  removeParamRow: (id: string) => string;
  removeHeaderRow: (id: string) => string;
  replaceRequest: (request: RequestRecord) => void;
  upsertRequestFromHistory: (history: HistoryRecord) => string;
  upsertRequests: (requests: RequestRecord[]) => void;
  upsertSecretStatus: (secret: SecretStatus) => void;
  sendActiveRequest: () => Promise<void>;
};

const scratchRequest: RequestRecord = {
  id: "scratch-request",
  name: "Untitled Request",
  collection: "Unfiled",
  collectionFile: "collections/unfiled.json",
  method: "GET",
  url: "",
  params: [],
  headers: [],
  body: "",
  authType: "none",
  authToken: "",
};

export function makeScratchEnvironment(): EnvironmentRecord {
  return {
    id: "scratch-environment",
    name: "No Environment",
    source: "environments/default.json",
    vars: [
      { id: "scratch-environment-var-1", key: "base_url", value: "" },
      { id: "scratch-environment-var-2", key: "proxy", value: "system" },
      { id: "scratch-environment-var-3", key: "cookie_jar", value: "default" },
    ],
  };
}

const scratchEnvironment: EnvironmentRecord = makeScratchEnvironment();

function normalizeEnvironmentVars(
  rows: Array<{ key: string; value: string }>,
  prefix: string,
): EnvironmentVar[] {
  return rows.map((row, index) => ({
    id: `${prefix}-env-${index + 1}-${row.key || "var"}`,
    key: row.key,
    value: row.value,
  }));
}

const initialRequests: RequestRecord[] = [
  {
    id: "req-workspaces",
    name: "GET /workspaces",
    collection: "Core API",
    collectionFile: "collections/core-api.json",
    method: "GET",
    url: "https://api.example.com/v1/workspaces",
    params: [
      { id: "param-1", key: "page", value: "1", enabled: true },
      { id: "param-2", key: "limit", value: "20", enabled: true },
      { id: "param-3", key: "include", value: "details,owner", enabled: true },
    ],
    headers: [
      { id: "header-1", key: "Accept", value: "application/json", enabled: true },
      {
        id: "header-2",
        key: "Authorization",
        value: "Bearer {{secret.prod_token}}",
        enabled: true,
      },
      {
        id: "header-3",
        key: "X-Workspace-Trace",
        value: "req_live_4021",
        enabled: true,
      },
    ],
    body: "",
    authType: "bearer",
    authToken: "{{secret.prod_token}}",
  },
  {
    id: "req-search",
    name: "POST /workspaces/search",
    collection: "Core API",
    collectionFile: "collections/core-api.json",
    method: "POST",
    url: "https://api.example.com/v1/workspaces/search",
    params: [
      { id: "param-a", key: "query", value: "workspace", enabled: true },
      { id: "param-b", key: "limit", value: "20", enabled: true },
    ],
    headers: [
      { id: "header-a", key: "Accept", value: "application/json", enabled: true },
      {
        id: "header-b",
        key: "Authorization",
        value: "Bearer {{secret.prod_token}}",
        enabled: true,
      },
      { id: "header-c", key: "Content-Type", value: "application/json", enabled: true },
      { id: "header-d", key: "Cookie", value: "workspace_session=auto", enabled: true },
    ],
    body: `{
  "query": "workspace",
  "limit": 20,
  "include": ["details", "owner"],
  "filters": {
    "region": "apac",
    "status": "active"
  },
  "preview": true
}`,
    authType: "bearer",
    authToken: "{{secret.prod_token}}",
  },
  {
    id: "req-login",
    name: "POST /login",
    collection: "Auth",
    collectionFile: "collections/auth.json",
    method: "POST",
    url: "https://api.example.com/v1/login",
    params: [],
    headers: [
      { id: "header-l1", key: "Accept", value: "application/json", enabled: true },
      { id: "header-l2", key: "Content-Type", value: "application/json", enabled: true },
    ],
    body: `{
  "email": "dev@example.com",
  "password": "••••••••"
}`,
    authType: "none",
    authToken: "",
  },
];

const initialEnvironments: EnvironmentRecord[] = [
  {
    id: "env-production",
    name: "Production",
    source: "environments/production.json",
    vars: normalizeEnvironmentVars(
      [
        { key: "base_url", value: "https://api.example.com" },
        { key: "auth_token", value: "{{secret.prod_token}}" },
        { key: "proxy", value: "system" },
        { key: "tls_verify", value: "true" },
        { key: "tls_hostname_verify", value: "true" },
        { key: "https_only", value: "false" },
        { key: "cookie_jar", value: "workspace_default" },
      ],
      "env-production",
    ),
  },
  {
    id: "env-staging",
    name: "Staging",
    source: "environments/staging.json",
    vars: normalizeEnvironmentVars(
      [
        { key: "base_url", value: "https://staging-api.example.com" },
        { key: "auth_token", value: "{{secret.staging_token}}" },
        { key: "proxy", value: "disabled" },
        { key: "tls_verify", value: "true" },
        { key: "tls_hostname_verify", value: "true" },
        { key: "https_only", value: "false" },
        { key: "cookie_jar", value: "workspace_staging" },
      ],
      "env-staging",
    ),
  },
  {
    id: "env-local",
    name: "Local Mock",
    source: "environments/local.yaml",
    vars: normalizeEnvironmentVars(
      [
        { key: "base_url", value: "http://127.0.0.1:8787" },
        { key: "auth_token", value: "dev-token" },
        { key: "proxy", value: "disabled" },
        { key: "tls_verify", value: "false" },
        { key: "tls_hostname_verify", value: "false" },
        { key: "https_only", value: "false" },
        { key: "cookie_jar", value: "workspace_local" },
      ],
      "env-local",
    ),
  },
];

const initialHistory: HistoryRecord[] = [
  {
    id: "history-1",
    title: "GET /v1/workspaces",
    meta: "200 / 184ms / just now",
    requestId: "req-workspaces",
    method: "GET",
    url: "https://api.example.com/v1/workspaces",
    status: "200 OK",
    durationMs: 184,
    createdAt: "just now",
    requestName: "GET /workspaces",
    collection: "Core API",
    params: [
      { id: "history-param-1", key: "page", value: "1", enabled: true },
      { id: "history-param-2", key: "limit", value: "20", enabled: true },
      { id: "history-param-3", key: "include", value: "details,owner", enabled: true },
    ],
    headers: [
      { id: "history-header-1", key: "Accept", value: "application/json", enabled: true },
      {
        id: "history-header-2",
        key: "Authorization",
        value: "Bearer {{secret.prod_token}}",
        enabled: true,
      },
      {
        id: "history-header-3",
        key: "X-Workspace-Trace",
        value: "req_live_4021",
        enabled: true,
      },
    ],
    body: "",
    authType: "bearer",
    authToken: "{{secret.prod_token}}",
    environment: initialEnvironments[0],
  },
  {
    id: "history-2",
    title: "POST /v1/login",
    meta: "401 / 96ms / 6 min ago",
    requestId: "req-login",
    method: "POST",
    url: "https://api.example.com/v1/login",
    status: "401 Unauthorized",
    durationMs: 96,
    createdAt: "6 min ago",
    requestName: "POST /login",
    collection: "Auth",
    params: [],
    headers: [
      { id: "history-header-l1", key: "Accept", value: "application/json", enabled: true },
      { id: "history-header-l2", key: "Content-Type", value: "application/json", enabled: true },
    ],
    body: `{
  "email": "dev@example.com",
  "password": "••••••••"
}`,
    authType: "none",
    authToken: "",
    environment: initialEnvironments[0],
  },
  {
    id: "history-3",
    title: "POST /v1/workspaces/search",
    meta: "200 / 221ms / 15 min ago",
    requestId: "req-search",
    method: "POST",
    url: "https://api.example.com/v1/workspaces/search",
    status: "200 OK",
    durationMs: 221,
    createdAt: "15 min ago",
    requestName: "POST /workspaces/search",
    collection: "Core API",
    params: [
      { id: "history-param-a", key: "query", value: "workspace", enabled: true },
      { id: "history-param-b", key: "limit", value: "20", enabled: true },
    ],
    headers: [
      { id: "history-header-a", key: "Accept", value: "application/json", enabled: true },
      {
        id: "history-header-b",
        key: "Authorization",
        value: "Bearer {{secret.prod_token}}",
        enabled: true,
      },
      { id: "history-header-c", key: "Content-Type", value: "application/json", enabled: true },
      { id: "history-header-d", key: "Cookie", value: "workspace_session=auto", enabled: true },
    ],
    body: `{
  "query": "workspace",
  "limit": 20,
  "include": ["details", "owner"],
  "filters": {
    "region": "apac",
    "status": "active"
  },
  "preview": true
}`,
    authType: "bearer",
    authToken: "{{secret.prod_token}}",
    environment: initialEnvironments[0],
  },
];

const initialResponse: ResponseState = {
  status: "200 OK",
  duration: "184 ms",
  size: "2.4 KB",
  protocol: "HTTP/2",
  body: `{
  "data": [
    {
      "id": "req_1024",
      "name": "Primary Workspace",
      "owner": "codex",
      "environment": "production",
      "cookiePolicy": "persisted"
    }
  ],
  "meta": {
    "page": 1,
    "hasMore": false
  }
}`,
  headers: [
    { key: "content-type", value: "application/json; charset=utf-8" },
    { key: "cache-control", value: "no-store" },
    { key: "set-cookie", value: "workspace_session=renewed; HttpOnly; Secure" },
    { key: "x-request-id", value: "resp_4021" },
  ],
  timeline: [
    { step: "DNS", value: "12ms" },
    { step: "TCP", value: "29ms" },
    { step: "TLS", value: "41ms" },
    { step: "Server", value: "88ms" },
    { step: "Download", value: "14ms" },
  ],
  summary: {
    cookieJar: "SQLite / workspace_default",
    secretSource: "Keychain / prod_token",
    collectionFile: "workspace.json / Core API",
  },
};

const initialBootstrap: BootstrapSnapshot = {
  loaded: false,
  appDataDir: "",
  databasePath: "",
  environmentsDir: "",
  cacheDir: "",
  logsDir: "",
  recentWorkspace: "",
  runtime: {
    cache: {
      directory: "",
      indexFile: "",
      entries: 0,
      sizeBytes: 0,
      updatedAt: "",
    },
    logs: {
      directory: "",
      activeFile: "",
      sizeBytes: 0,
      lastLine: "",
      updatedAt: "",
    },
  },
  secrets: [],
};

function updateRow(
  rows: KeyValueRow[],
  id: string,
  field: "key" | "value",
  value: string,
): KeyValueRow[] {
  return rows.map((row) => (row.id === id ? { ...row, [field]: value } : row));
}

function toggleRow(rows: KeyValueRow[], id: string): KeyValueRow[] {
  return rows.map((row) => (row.id === id ? { ...row, enabled: !row.enabled } : row));
}

function appendRow(prefix: string, rows: KeyValueRow[]) {
  const nextRow = {
    id: `${prefix}-${rows.length + 1}-${Date.now()}`,
    key: "",
    value: "",
    enabled: true,
  };

  return {
    rows: [...rows, nextRow],
    focusRowId: nextRow.id,
  };
}

function removeRow(prefix: string, rows: KeyValueRow[], id: string) {
  const removedIndex = rows.findIndex((row) => row.id === id);
  const remainingRows = rows.filter((row) => row.id !== id);

  if (remainingRows.length === 0) {
    const fallbackRow = {
      id: `${prefix}-1-${Date.now()}`,
      key: "",
      value: "",
      enabled: true,
    };

    return {
      rows: [fallbackRow],
      focusRowId: fallbackRow.id,
    };
  }

  const nextFocusIndex =
    removedIndex < 0 ? 0 : Math.min(removedIndex, remainingRows.length - 1);

  return {
    rows: remainingRows,
    focusRowId: remainingRows[nextFocusIndex]?.id ?? "",
  };
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function appendEnvironmentVar(environmentId: string, rows: EnvironmentVar[]) {
  const nextRow = {
    id: `${environmentId}-env-var-${rows.length + 1}-${Date.now()}`,
    key: "",
    value: "",
  };

  return {
    rows: [...rows, nextRow],
    focusRowId: nextRow.id,
  };
}

function removeEnvironmentVarRow(rows: EnvironmentVar[], id: string) {
  const removedIndex = rows.findIndex((row) => row.id === id);
  const remainingRows = rows.filter((row) => row.id !== id);

  if (remainingRows.length === 0) {
    return {
      rows: [],
      focusRowId: "",
    };
  }

  const nextFocusIndex =
    removedIndex < 0 ? 0 : Math.min(removedIndex, remainingRows.length - 1);

  return {
    rows: remainingRows,
    focusRowId: remainingRows[nextFocusIndex]?.id ?? "",
  };
}

export const useRequestStore = create<RequestStore>((set, get) => ({
  requests: initialRequests,
  environments: initialEnvironments,
  history: initialHistory,
  activeRequestId: "req-search",
  activeEnvironmentId: "env-production",
  activeHistoryId: null,
  response: initialResponse,
  bootstrap: initialBootstrap,
  isSending: false,
  lastError: "",
  setActiveRequest: (requestId) => set({ activeRequestId: requestId }),
  setActiveEnvironment: (environmentId) => set({ activeEnvironmentId: environmentId }),
  setActiveHistory: (historyId) => set({ activeHistoryId: historyId }),
  updateEnvironmentVar: (environmentId, rowId, field, value) =>
    set((state) => ({
      environments: state.environments.map((environment) =>
        environment.id === environmentId
          ? {
              ...environment,
              vars: environment.vars.map((item) =>
                item.id === rowId ? { ...item, [field]: value } : item,
              ),
            }
          : environment,
      ),
    })),
  addEnvironmentVar: (environmentId) => {
    let focusRowId = "";

    set((state) => ({
      environments: state.environments.map((environment) => {
        if (environment.id !== environmentId) {
          return environment;
        }

        const next = appendEnvironmentVar(environment.id, environment.vars);
        focusRowId = next.focusRowId;
        return { ...environment, vars: next.rows };
      }),
    }));

    return focusRowId;
  },
  removeEnvironmentVar: (environmentId, rowId) => {
    let focusRowId = "";

    set((state) => ({
      environments: state.environments.map((environment) => {
        if (environment.id !== environmentId) {
          return environment;
        }

        const next = removeEnvironmentVarRow(environment.vars, rowId);
        focusRowId = next.focusRowId;
        return { ...environment, vars: next.rows };
      }),
    }));

    return focusRowId;
  },
  upsertEnvironment: (environment) =>
    set((state) => ({
      environments: state.environments.some((item) => item.id === environment.id)
        ? state.environments.map((item) => (item.id === environment.id ? environment : item))
        : [...state.environments, environment],
    })),
  replaceEnvironment: (environment) =>
    set((state) => ({
      environments: state.environments.map((item) =>
        item.id === environment.id ? environment : item,
      ),
    })),
  replaceRequest: (request) =>
    set((state) => ({
      requests: state.requests.map((item) => (item.id === request.id ? request : item)),
    })),
  upsertRequestFromHistory: (historyEntry) => {
    const replayRequestId = `${historyEntry.requestId}-history-${historyEntry.id}`;
    const replayRequest: RequestRecord = {
      id: replayRequestId,
      name: `${historyEntry.requestName} replay`,
      collection: `${historyEntry.collection} / History`,
      collectionFile: `history/${historyEntry.requestId}.json`,
      method: historyEntry.method,
      url: historyEntry.url,
      params: historyEntry.params.map((row, index) => ({
        ...row,
        id: `${replayRequestId}-param-${index + 1}`,
      })),
      headers: historyEntry.headers.map((row, index) => ({
        ...row,
        id: `${replayRequestId}-header-${index + 1}`,
      })),
      body: historyEntry.body,
      authType: historyEntry.authType,
      authToken: historyEntry.authToken,
    };
    const replayEnvironmentId = `${historyEntry.environment.id}-history-${historyEntry.id}`;
    const replayEnvironment: EnvironmentRecord = {
      ...historyEntry.environment,
      id: replayEnvironmentId,
      name: `${historyEntry.environment.name} replay`,
      source: historyEntry.environment.source,
      vars: normalizeEnvironmentVars(historyEntry.environment.vars, replayEnvironmentId),
    };

    set((state) => ({
      requests: state.requests.some((request) => request.id === replayRequestId)
        ? state.requests.map((request) =>
            request.id === replayRequestId ? replayRequest : request,
          )
        : [...state.requests, replayRequest],
      environments: state.environments.some((environment) => environment.id === replayEnvironmentId)
        ? state.environments.map((environment) =>
            environment.id === replayEnvironmentId ? replayEnvironment : environment,
          )
        : [...state.environments, replayEnvironment],
      activeRequestId: replayRequestId,
      activeEnvironmentId: replayEnvironmentId,
      activeHistoryId: historyEntry.id,
    }));

    return replayRequestId;
  },
  upsertRequests: (requests) =>
    set((state) => {
      if (requests.length === 0) {
        return state;
      }

      const incomingIds = new Set(requests.map((request) => request.id));
      return {
        requests: [
          ...state.requests.filter((request) => !incomingIds.has(request.id)),
          ...requests,
        ],
        activeRequestId: requests[0].id,
      };
    }),
  upsertSecretStatus: (secret) =>
    set((state) => ({
      bootstrap: {
        ...state.bootstrap,
        secrets: state.bootstrap.secrets.some((item) => item.name === secret.name)
          ? state.bootstrap.secrets.map((item) =>
              item.name === secret.name ? secret : item,
            )
          : [...state.bootstrap.secrets, secret],
      },
    })),
  applyBootstrap: (input) =>
    set((state) => ({
      requests: input.collections.length > 0 ? input.collections : [scratchRequest],
      history: input.history,
      environments:
        input.environments.length > 0
          ? input.environments.map((environment) => {
              const fallback = state.environments.find(
                (item) =>
                  item.name === environment.name || item.source === environment.source,
              );

              const sourceVars =
                environment.vars.length > 0
                  ? environment.vars
                  : fallback?.vars.map((row) => ({
                      key: row.key,
                      value: row.value,
                    })) ?? [];

              return {
                ...environment,
                vars: normalizeEnvironmentVars(
                  sourceVars,
                  environment.source || environment.name,
                ),
              };
            })
          : [scratchEnvironment],
      activeEnvironmentId:
        input.environments.find((environment) => environment.id === state.activeEnvironmentId)
          ?.id ??
        input.environments[0]?.id ??
        scratchEnvironment.id,
      activeRequestId:
        input.collections.find((request) => request.id === state.activeRequestId)?.id ??
        input.collections[0]?.id ??
        scratchRequest.id,
      bootstrap: {
        loaded: true,
        appDataDir: input.appDataDir,
        databasePath: input.databasePath,
        environmentsDir: input.environmentsDir,
        cacheDir: input.cacheDir,
        logsDir: input.logsDir,
        recentWorkspace: input.recentWorkspace,
        runtime: input.runtime,
        secrets: input.secrets,
      },
      activeHistoryId: null,
      lastError: "",
    })),
  updateRequestMethod: (method) =>
    set((state) => ({
      requests: state.requests.map((request) =>
        request.id === state.activeRequestId ? { ...request, method } : request,
      ),
    })),
  updateRequestUrl: (url) =>
    set((state) => ({
      requests: state.requests.map((request) =>
        request.id === state.activeRequestId ? { ...request, url } : request,
      ),
    })),
  updateRequestBody: (body) =>
    set((state) => ({
      requests: state.requests.map((request) =>
        request.id === state.activeRequestId ? { ...request, body } : request,
      ),
    })),
  updateAuthType: (authType) =>
    set((state) => ({
      requests: state.requests.map((request) =>
        request.id === state.activeRequestId ? { ...request, authType } : request,
      ),
    })),
  updateAuthToken: (authToken) =>
    set((state) => ({
      requests: state.requests.map((request) =>
        request.id === state.activeRequestId ? { ...request, authToken } : request,
      ),
    })),
  updateParamRow: (id, field, value) =>
    set((state) => ({
      requests: state.requests.map((request) =>
        request.id === state.activeRequestId
          ? { ...request, params: updateRow(request.params, id, field, value) }
          : request,
      ),
    })),
  updateHeaderRow: (id, field, value) =>
    set((state) => ({
      requests: state.requests.map((request) =>
        request.id === state.activeRequestId
          ? { ...request, headers: updateRow(request.headers, id, field, value) }
          : request,
      ),
    })),
  toggleParamRow: (id) =>
    set((state) => ({
      requests: state.requests.map((request) =>
        request.id === state.activeRequestId
          ? { ...request, params: toggleRow(request.params, id) }
          : request,
      ),
    })),
  toggleHeaderRow: (id) =>
    set((state) => ({
      requests: state.requests.map((request) =>
        request.id === state.activeRequestId
          ? { ...request, headers: toggleRow(request.headers, id) }
          : request,
      ),
    })),
  addParamRow: () => {
    let focusRowId = "";

    set((state) => ({
      requests: state.requests.map((request) => {
        if (request.id !== state.activeRequestId) {
          return request;
        }

        const next = appendRow("param", request.params);
        focusRowId = next.focusRowId;
        return { ...request, params: next.rows };
      }),
    }));

    return focusRowId;
  },
  addHeaderRow: () => {
    let focusRowId = "";

    set((state) => ({
      requests: state.requests.map((request) => {
        if (request.id !== state.activeRequestId) {
          return request;
        }

        const next = appendRow("header", request.headers);
        focusRowId = next.focusRowId;
        return { ...request, headers: next.rows };
      }),
    }));

    return focusRowId;
  },
  removeParamRow: (id) => {
    let focusRowId = "";

    set((state) => ({
      requests: state.requests.map((request) => {
        if (request.id !== state.activeRequestId) {
          return request;
        }

        const next = removeRow("param", request.params, id);
        focusRowId = next.focusRowId;
        return { ...request, params: next.rows };
      }),
    }));

    return focusRowId;
  },
  removeHeaderRow: (id) => {
    let focusRowId = "";

    set((state) => ({
      requests: state.requests.map((request) => {
        if (request.id !== state.activeRequestId) {
          return request;
        }

        const next = removeRow("header", request.headers, id);
        focusRowId = next.focusRowId;
        return { ...request, headers: next.rows };
      }),
    }));

    return focusRowId;
  },
  sendActiveRequest: async () => {
    const state = get();
    const request = state.requests.find((item) => item.id === state.activeRequestId);
    const environment = state.environments.find(
      (item) => item.id === state.activeEnvironmentId,
    );

    if (!request || !environment) {
      return;
    }

    set({ isSending: true, lastError: "" });

    try {
      const result = await sendRequest({
        requestId: request.id,
        requestName: request.name,
        collection: request.collection,
        method: request.method,
        url: request.url,
        params: request.params,
        headers: request.headers,
        body: request.body,
        authType: request.authType,
        authToken: request.authToken,
        environment: {
          name: environment.name,
          filePath: environment.source,
          vars: environment.vars,
        },
      });

      const historyEntry: HistoryRecord = {
        id: `history-${Date.now()}`,
        title: `${request.method} ${safePathname(request.url)}`,
        meta: `${result.status.split(" ")[0]} / ${result.durationMs}ms / just now`,
        requestId: request.id,
        method: request.method,
        url: request.url,
        status: result.status,
        durationMs: result.durationMs,
        createdAt: "just now",
        requestName: request.name,
        collection: request.collection,
        params: request.params.map((row) => ({ ...row })),
        headers: request.headers.map((row) => ({ ...row })),
        body: request.body,
        authType: request.authType,
        authToken: request.authToken,
        environment: {
          ...environment,
          vars: environment.vars.map((row) => ({ ...row })),
        },
      };

      set((current) => ({
        isSending: false,
        lastError: "",
        response: {
          status: result.status,
          duration: `${result.durationMs} ms`,
          size: `${Math.max(0.1, result.sizeBytes / 1024).toFixed(1)} KB`,
          protocol: result.protocol,
          body: result.body,
          headers: result.headers,
          timeline: result.timeline,
          summary: result.summary,
        },
        history: [historyEntry, ...current.history.slice(0, 7)],
        activeHistoryId: historyEntry.id,
      }));
    } catch (error) {
      set({
        isSending: false,
        lastError: error instanceof Error ? error.message : "Request failed",
      });
    }
  },
}));
