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
};

export type SecretStatus = {
  name: string;
  exists: boolean;
};

export type BootstrapSnapshot = {
  loaded: boolean;
  appDataDir: string;
  databasePath: string;
  environmentsDir: string;
  recentWorkspace: string;
  secrets: SecretStatus[];
};

type RequestStore = {
  requests: RequestRecord[];
  environments: EnvironmentRecord[];
  history: HistoryRecord[];
  activeRequestId: string;
  activeEnvironmentId: string;
  response: ResponseState;
  bootstrap: BootstrapSnapshot;
  isSending: boolean;
  lastError: string;
  setActiveRequest: (requestId: string) => void;
  setActiveEnvironment: (environmentId: string) => void;
  updateEnvironmentVar: (
    environmentId: string,
    key: string,
    value: string,
  ) => void;
  replaceEnvironment: (environment: EnvironmentRecord) => void;
  applyBootstrap: (input: {
    appDataDir: string;
    databasePath: string;
    environmentsDir: string;
    recentWorkspace: string;
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
  addParamRow: () => void;
  addHeaderRow: () => void;
  replaceRequest: (request: RequestRecord) => void;
  upsertSecretStatus: (secret: SecretStatus) => void;
  sendActiveRequest: () => Promise<void>;
};

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
    vars: [
      { key: "base_url", value: "https://api.example.com" },
      { key: "auth_token", value: "{{secret.prod_token}}" },
      { key: "proxy", value: "system" },
      { key: "cookie_jar", value: "workspace_default" },
    ],
  },
  {
    id: "env-staging",
    name: "Staging",
    source: "environments/staging.json",
    vars: [
      { key: "base_url", value: "https://staging-api.example.com" },
      { key: "auth_token", value: "{{secret.staging_token}}" },
      { key: "proxy", value: "disabled" },
      { key: "cookie_jar", value: "workspace_staging" },
    ],
  },
  {
    id: "env-local",
    name: "Local Mock",
    source: "environments/local.yaml",
    vars: [
      { key: "base_url", value: "http://127.0.0.1:8787" },
      { key: "auth_token", value: "dev-token" },
      { key: "proxy", value: "disabled" },
      { key: "cookie_jar", value: "workspace_local" },
    ],
  },
];

const initialHistory: HistoryRecord[] = [
  {
    id: "history-1",
    title: "GET /v1/workspaces",
    meta: "200 / 184ms / just now",
    requestId: "req-workspaces",
  },
  {
    id: "history-2",
    title: "POST /v1/login",
    meta: "401 / 96ms / 6 min ago",
    requestId: "req-login",
  },
  {
    id: "history-3",
    title: "POST /v1/workspaces/search",
    meta: "200 / 221ms / 15 min ago",
    requestId: "req-search",
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
  recentWorkspace: "",
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

function addRow(prefix: string, rows: KeyValueRow[]): KeyValueRow[] {
  return [
    ...rows,
    {
      id: `${prefix}-${rows.length + 1}-${Date.now()}`,
      key: "",
      value: "",
      enabled: true,
    },
  ];
}

function toggleRow(rows: KeyValueRow[], id: string): KeyValueRow[] {
  return rows.map((row) => (row.id === id ? { ...row, enabled: !row.enabled } : row));
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export const useRequestStore = create<RequestStore>((set, get) => ({
  requests: initialRequests,
  environments: initialEnvironments,
  history: initialHistory,
  activeRequestId: "req-search",
  activeEnvironmentId: "env-production",
  response: initialResponse,
  bootstrap: initialBootstrap,
  isSending: false,
  lastError: "",
  setActiveRequest: (requestId) => set({ activeRequestId: requestId }),
  setActiveEnvironment: (environmentId) => set({ activeEnvironmentId: environmentId }),
  updateEnvironmentVar: (environmentId, key, value) =>
    set((state) => ({
      environments: state.environments.map((environment) =>
        environment.id === environmentId
          ? {
              ...environment,
              vars: environment.vars.map((item) =>
                item.key === key ? { ...item, value } : item,
              ),
            }
          : environment,
      ),
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
      requests: input.collections.length > 0 ? input.collections : state.requests,
      history: input.history.length > 0 ? input.history : state.history,
      environments:
        input.environments.length > 0
          ? input.environments.map((environment) => {
              const fallback = state.environments.find(
                (item) =>
                  item.name === environment.name || item.source === environment.source,
              );

              return environment.vars.length > 0
                ? environment
                : {
                    ...environment,
                    vars: fallback?.vars ?? [],
                  };
            })
          : state.environments,
      activeEnvironmentId:
        input.environments.find((environment) => environment.id === state.activeEnvironmentId)
          ?.id ??
        input.environments[0]?.id ??
        state.activeEnvironmentId,
      activeRequestId:
        input.collections.find((request) => request.id === state.activeRequestId)?.id ??
        input.collections[0]?.id ??
        state.activeRequestId,
      bootstrap: {
        loaded: true,
        appDataDir: input.appDataDir,
        databasePath: input.databasePath,
        environmentsDir: input.environmentsDir,
        recentWorkspace: input.recentWorkspace,
        secrets: input.secrets,
      },
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
  addParamRow: () =>
    set((state) => ({
      requests: state.requests.map((request) =>
        request.id === state.activeRequestId
          ? { ...request, params: addRow("param", request.params) }
          : request,
      ),
    })),
  addHeaderRow: () =>
    set((state) => ({
      requests: state.requests.map((request) =>
        request.id === state.activeRequestId
          ? { ...request, headers: addRow("header", request.headers) }
          : request,
      ),
    })),
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
      }));
    } catch (error) {
      set({
        isSending: false,
        lastError: error instanceof Error ? error.message : "Request failed",
      });
    }
  },
}));
