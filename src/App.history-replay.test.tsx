import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import App from "./App";
import { queryClient } from "./lib/queryClient";
import { useRequestStore } from "./store/requestStore";
import { useUiStore } from "./store/uiStore";

type MockRequest = {
  id: string;
  name: string;
  collection: string;
  collectionFile: string;
  method: string;
  url: string;
  params: Array<{ key: string; value: string; enabled: boolean; description: string }>;
  headers: Array<{ key: string; value: string; enabled: boolean; description: string }>;
  body: string;
  bodyMode: "json" | "raw" | "urlencoded" | "multipart";
  bodyContentType: string;
  bodyRows: Array<{
    key: string;
    value: string;
    enabled: boolean;
    fieldType: "text" | "file";
  }>;
  authType: string;
  authToken: string;
  authBasicUsername: string;
  authBasicPassword: string;
  authApiKeyName: string;
  authApiKeyValue: string;
  authApiKeyIn: "header" | "query";
};

type MockCollection = {
  name: string;
  filePath: string;
  group?: string;
  collapsed?: boolean;
  requests: MockRequest[];
};

type MockEnvironment = {
  name: string;
  filePath: string;
  vars: Array<{ key: string; value: string }>;
};

type MockHistoryEntry = {
  id: number;
  requestId: string;
  method: string;
  url: string;
  status: string;
  durationMs: number;
  createdAt: string;
  requestName: string;
  collection: string;
  params: Array<{ key: string; value: string; enabled: boolean; description: string }>;
  headers: Array<{ key: string; value: string; enabled: boolean; description: string }>;
  body: string;
  bodyMode: "json" | "raw" | "urlencoded" | "multipart";
  bodyContentType: string;
  bodyRows: Array<{
    key: string;
    value: string;
    enabled: boolean;
    fieldType: "text" | "file";
  }>;
  authType: string;
  authToken: string;
  authBasicUsername: string;
  authBasicPassword: string;
  authApiKeyName: string;
  authApiKeyValue: string;
  authApiKeyIn: "header" | "query";
  environmentName: string;
  environmentSource: string;
  environmentVars: Array<{ key: string; value: string }>;
};

const bootstrapState = {
  paths: {
    appDataDir: "/tmp/app",
    databasePath: "/tmp/app/app.db",
    workspacesDir: "/tmp/app/workspaces",
    collectionsDir: "/tmp/app/collections",
    environmentsDir: "/tmp/app/environments",
    cacheDir: "/tmp/app/cache",
    logsDir: "/tmp/app/logs",
  },
  settings: {
    theme: "system",
    recentWorkspace: "default-workspace",
    autoSave: false,
    defaultProxyMode: "system",
    defaultProxyUrl: "",
    defaultTlsVerify: true,
    defaultTlsHostnameVerify: true,
  },
  runtime: {
    cache: {
      directory: "/tmp/app/cache",
      indexFile: "/tmp/app/cache/index.json",
      entries: 0,
      sizeBytes: 0,
      updatedAt: "",
    },
    logs: {
      directory: "/tmp/app/logs",
      activeFile: "/tmp/app/logs/api-client.log",
      sizeBytes: 0,
      lastLine: "",
      updatedAt: "",
    },
  },
  secrets: [],
};

function resetClientState() {
  useRequestStore.setState(useRequestStore.getInitialState());
  useUiStore.setState(useUiStore.getInitialState());
  queryClient.clear();
}

function cloneCollections(collections: MockCollection[]) {
  return JSON.parse(JSON.stringify(collections)) as MockCollection[];
}

function cloneEnvironments(environments: MockEnvironment[]) {
  return JSON.parse(JSON.stringify(environments)) as MockEnvironment[];
}

function cloneHistory(history: MockHistoryEntry[]) {
  return JSON.parse(JSON.stringify(history)) as MockHistoryEntry[];
}

function initialCollections(): MockCollection[] {
  return [
    {
      name: "Core API",
      filePath: "collections/core-api.json",
      group: "Workspace",
      collapsed: false,
      requests: [
        {
          id: "req-workspaces",
          name: "GET /workspaces",
          collection: "Core API",
          collectionFile: "collections/core-api.json",
          method: "GET",
          url: "https://api.example.com/v1/workspaces",
          params: [],
          headers: [],
          body: "",
          bodyMode: "raw",
          bodyContentType: "",
          bodyRows: [],
          authType: "none",
          authToken: "",
          authBasicUsername: "",
          authBasicPassword: "",
          authApiKeyName: "",
          authApiKeyValue: "",
          authApiKeyIn: "header",
        },
        {
          id: "req-search",
          name: "POST /workspaces/search",
          collection: "Core API",
          collectionFile: "collections/core-api.json",
          method: "POST",
          url: "https://api.example.com/v1/workspaces/search",
          params: [
            {
              key: "query",
              value: "workspace",
              enabled: true,
              description: "Search term",
            },
          ],
          headers: [
            {
              key: "Accept",
              value: "application/json",
              enabled: true,
              description: "Preferred response type",
            },
          ],
          body: '{"query":"workspace"}',
          bodyMode: "json",
          bodyContentType: "application/json",
          bodyRows: [],
          authType: "none",
          authToken: "",
          authBasicUsername: "",
          authBasicPassword: "",
          authApiKeyName: "",
          authApiKeyValue: "",
          authApiKeyIn: "header",
        },
      ],
    },
  ];
}

function initialEnvironments(): MockEnvironment[] {
  return [
    {
      name: "Production",
      filePath: "environments/production.json",
      vars: [
        { key: "base_url", value: "https://api.example.com" },
        { key: "proxy", value: "system" },
        { key: "cookie_jar", value: "workspace_default" },
      ],
    },
    {
      name: "Staging",
      filePath: "environments/staging.yaml",
      vars: [
        { key: "base_url", value: "https://staging-api.example.com" },
        { key: "proxy", value: "disabled" },
        { key: "cookie_jar", value: "workspace_staging" },
      ],
    },
  ];
}

function initialHistory(): MockHistoryEntry[] {
  return [
    {
      id: 1,
      requestId: "req-workspaces",
      method: "GET",
      url: "https://api.example.com/v1/workspaces?page=1",
      status: "200 OK",
      durationMs: 184,
      createdAt: "20 min ago",
      requestName: "GET /workspaces",
      collection: "Core API",
      params: [
        {
          key: "page",
          value: "1",
          enabled: true,
          description: "Current page",
        },
      ],
      headers: [
        {
          key: "Accept",
          value: "application/json",
          enabled: true,
          description: "Preferred response type",
        },
      ],
      body: "",
      bodyMode: "raw",
      bodyContentType: "",
      bodyRows: [],
      authType: "none",
      authToken: "",
      authBasicUsername: "",
      authBasicPassword: "",
      authApiKeyName: "",
      authApiKeyValue: "",
      authApiKeyIn: "header",
      environmentName: "Production",
      environmentSource: "environments/production.json",
      environmentVars: [
        { key: "base_url", value: "https://api.example.com" },
        { key: "proxy", value: "system" },
        { key: "cookie_jar", value: "workspace_default" },
      ],
    },
    {
      id: 2,
      requestId: "req-search",
      method: "POST",
      url: "https://staging-api.example.com/v1/workspaces/search?archived=true",
      status: "202 Accepted",
      durationMs: 221,
      createdAt: "6 min ago",
      requestName: "POST /workspaces/search",
      collection: "Core API",
      params: [
        {
          key: "query",
          value: "alpha",
          enabled: true,
          description: "Search term",
        },
        {
          key: "archived",
          value: "true",
          enabled: true,
          description: "Include archived workspaces",
        },
      ],
      headers: [
        {
          key: "Accept",
          value: "application/json",
          enabled: true,
          description: "Preferred response type",
        },
        {
          key: "X-Trace",
          value: "trace-staging",
          enabled: true,
          description: "Trace marker",
        },
      ],
      body: '{"query":"alpha","archived":true}',
      bodyMode: "json",
      bodyContentType: "application/json",
      bodyRows: [],
      authType: "bearer",
      authToken: "{{secret.staging_token}}",
      authBasicUsername: "",
      authBasicPassword: "",
      authApiKeyName: "",
      authApiKeyValue: "",
      authApiKeyIn: "header",
      environmentName: "Staging",
      environmentSource: "environments/staging.yaml",
      environmentVars: [
        { key: "base_url", value: "https://staging-api.example.com" },
        { key: "proxy", value: "disabled" },
        { key: "cookie_jar", value: "workspace_staging" },
      ],
    },
  ];
}

function findLastCall(
  calls: Array<{ cmd: string; payload: unknown }>,
  command: string,
) {
  return [...calls].reverse().find((call) => call.cmd === command);
}

function renderHistoryApp(options?: {
  sendResult?: {
    status: string;
    durationMs: number;
    sizeBytes: number;
    protocol: string;
    body: string;
    headers: Array<{ key: string; value: string }>;
    timeline: Array<{ step: string; value: string }>;
    summary: {
      cookieJar: string;
      secretSource: string;
      collectionFile: string;
    };
  };
}) {
  const calls: Array<{ cmd: string; payload: unknown }> = [];
  const collections = initialCollections();
  const environments = initialEnvironments();
  const history = initialHistory();
  const sendResult = options?.sendResult ?? {
    status: "201 Created",
    durationMs: 19,
    sizeBytes: 64,
    protocol: "HTTP/2",
    body: '{"items":[{"id":"ws_1"}]}',
    headers: [{ key: "content-type", value: "application/json" }],
    timeline: [{ step: "server", value: "19 ms" }],
    summary: {
      cookieJar: "SQLite / workspace_staging / 1 updated",
      secretSource: "Bearer token",
      collectionFile: "Core API / History / POST /workspaces/search replay",
    },
  };

  mockIPC(
    (cmd, payload) => {
      calls.push({ cmd, payload });

      switch (cmd) {
        case "plugin:event|listen":
          return 1;
        case "load_bootstrap_state":
          return {
            ...bootstrapState,
            collections: cloneCollections(collections),
            environments: cloneEnvironments(environments),
            history: cloneHistory(history),
          };
        case "send_request":
          return sendResult;
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );

  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );

  return calls;
}

describe("App P0-5 history replay", () => {
  beforeEach(() => {
    mockWindows("main");
    resetClientState();
  });

  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("restores a history session into a clean replay request and replay environment", async () => {
    renderHistoryApp();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("https://api.example.com/v1/workspaces/search"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole("button", { name: "History" })[0]!);

    const historyPanel = await waitFor(() => {
      const panel = screen
        .getByRole("heading", { name: "Recent Request Sessions" })
        .closest("section");
      if (!panel) {
        throw new Error("history panel not found");
      }
      return panel as HTMLElement;
    });

    const historyCards = historyPanel.querySelectorAll(".history-session-card");
    const targetCard = historyCards[1];
    if (!(targetCard instanceof HTMLElement)) {
      throw new Error("target history card not found");
    }

    await user.click(within(targetCard).getByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(
        screen.getByDisplayValue(
          "https://staging-api.example.com/v1/workspaces/search?archived=true",
        ),
      ).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("query")).toBeInTheDocument();
    expect(screen.getByDisplayValue("alpha")).toBeInTheDocument();
    expect(screen.getByText("All changes saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Staging replay" })).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Environments" })[0]!);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Staging replay" })).toBeInTheDocument();
    });

    expect(screen.getByText("Environment saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Env" })).toBeDisabled();
    expect(screen.getByDisplayValue("https://staging-api.example.com")).toBeInTheDocument();
  });

  it("resends a restored history session with its replay snapshot and records fresh status and time", async () => {
    const calls = renderHistoryApp();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("https://api.example.com/v1/workspaces/search"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole("button", { name: "History" })[0]!);

    const historyPanel = await waitFor(() => {
      const panel = screen
        .getByRole("heading", { name: "Recent Request Sessions" })
        .closest("section");
      if (!panel) {
        throw new Error("history panel not found");
      }
      return panel as HTMLElement;
    });

    const historyCards = historyPanel.querySelectorAll(".history-session-card");
    const targetCard = historyCards[1];
    if (!(targetCard instanceof HTMLElement)) {
      throw new Error("target history card not found");
    }

    await user.click(within(targetCard).getByRole("button", { name: "Resend" }));

    await waitFor(() => {
      expect(calls.filter((call) => call.cmd === "send_request")).toHaveLength(1);
    });

    const sendPayload = findLastCall(calls, "send_request")?.payload as
      | {
          input: {
            requestId: string;
            requestName: string;
            collection: string;
            method: string;
            url: string;
            params: Array<Record<string, unknown>>;
            headers: Array<Record<string, unknown>>;
            body: string;
            bodyMode: string;
            bodyContentType: string;
            authType: string;
            authToken: string;
            environment: {
              name: string;
              filePath: string;
              vars: Array<Record<string, unknown>>;
            };
          };
        }
      | undefined;

    expect(sendPayload?.input.requestId).toBe("req-search-history-history-db-2");
    expect(sendPayload?.input.requestName).toBe("POST /workspaces/search replay");
    expect(sendPayload?.input.collection).toBe("Core API / History");
    expect(sendPayload?.input.method).toBe("POST");
    expect(sendPayload?.input.url).toBe(
      "https://staging-api.example.com/v1/workspaces/search?archived=true",
    );
    expect(sendPayload?.input.body).toBe('{"query":"alpha","archived":true}');
    expect(sendPayload?.input.bodyMode).toBe("json");
    expect(sendPayload?.input.bodyContentType).toBe("application/json");
    expect(sendPayload?.input.authType).toBe("bearer");
    expect(sendPayload?.input.authToken).toBe("{{secret.staging_token}}");
    expect(sendPayload?.input.params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "query",
          value: "alpha",
          enabled: true,
          description: "Search term",
        }),
        expect.objectContaining({
          key: "archived",
          value: "true",
          enabled: true,
          description: "Include archived workspaces",
        }),
      ]),
    );
    expect(sendPayload?.input.headers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "X-Trace",
          value: "trace-staging",
          enabled: true,
          description: "Trace marker",
        }),
      ]),
    );
    expect(sendPayload?.input.environment.name).toBe("Staging replay");
    expect(sendPayload?.input.environment.filePath).toBe("environments/staging.yaml");
    expect(sendPayload?.input.environment.vars).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "base_url",
          value: "https://staging-api.example.com",
        }),
        expect.objectContaining({
          key: "proxy",
          value: "disabled",
        }),
        expect.objectContaining({
          key: "cookie_jar",
          value: "workspace_staging",
        }),
      ]),
    );

    await waitFor(() => {
      const responseSummary = document.querySelector(".response-summary");
      if (!(responseSummary instanceof HTMLElement)) {
        throw new Error("response summary not found");
      }

      expect(within(responseSummary).getByText("201 Created")).toBeInTheDocument();
      expect(within(responseSummary).getByText("19 ms")).toBeInTheDocument();
      expect(screen.getByText("3 sessions")).toBeInTheDocument();
    });

    const updatedCards = historyPanel.querySelectorAll(".history-session-card");
    const latestCard = updatedCards[0];
    if (!(latestCard instanceof HTMLElement)) {
      throw new Error("latest history card not found");
    }

    expect(within(latestCard).getByText("201 Created")).toBeInTheDocument();
    expect(within(latestCard).getByText(/just now/i)).toBeInTheDocument();
  });
});
