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
          headers: [],
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
    {
      name: "Auth",
      filePath: "collections/auth.json",
      group: "Security",
      collapsed: false,
      requests: [
        {
          id: "req-login",
          name: "POST /login",
          collection: "Auth",
          collectionFile: "collections/auth.json",
          method: "POST",
          url: "https://api.example.com/v1/login",
          params: [],
          headers: [],
          body: '{"email":"dev@example.com"}',
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
      requestId: "req-search",
      method: "POST",
      url: "https://api.example.com/v1/workspaces/search",
      status: "200 OK",
      durationMs: 221,
      createdAt: "15 min ago",
      requestName: "POST /workspaces/search",
      collection: "Core API",
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
      environmentName: "Production",
      environmentSource: "environments/production.json",
      environmentVars: [
        { key: "base_url", value: "https://api.example.com" },
        { key: "cookie_jar", value: "workspace_default" },
      ],
    },
    {
      id: 2,
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
        {
          key: "X-Trace",
          value: "trace-staging",
          enabled: true,
          description: "Trace marker",
        },
      ],
      body: '{"email":"qa@example.com"}',
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
      environmentName: "Staging",
      environmentSource: "environments/staging.yaml",
      environmentVars: [
        { key: "base_url", value: "https://staging-api.example.com" },
        { key: "cookie_jar", value: "workspace_staging" },
      ],
    },
  ];
}

function renderExplorerApp(options?: {
  collections?: MockCollection[];
  environments?: MockEnvironment[];
  history?: MockHistoryEntry[];
}) {
  const collections = options?.collections ?? initialCollections();
  const environments = options?.environments ?? initialEnvironments();
  const history = options?.history ?? initialHistory();

  mockIPC(
    (cmd) => {
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
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );

  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App P0-3 explorer search", () => {
  beforeEach(() => {
    mockWindows("main");
    resetClientState();
  });

  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("filters collections by collection and request content with empty feedback", async () => {
    renderExplorerApp();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("https://api.example.com/v1/workspaces/search"),
      ).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search collections");
    const explorerPanel = searchInput.closest(".explorer-panel") as HTMLElement | null;
    if (!explorerPanel) {
      throw new Error("collections explorer panel not found");
    }

    expect(explorerPanel.querySelectorAll(".tree-request")).toHaveLength(3);

    await user.type(searchInput, "login");

    await waitFor(() => {
      expect(explorerPanel.querySelectorAll(".tree-request")).toHaveLength(1);
      expect(within(explorerPanel).getByText("POST /login")).toBeInTheDocument();
    });

    await user.clear(searchInput);
    await user.type(searchInput, "missing-collection");

    await waitFor(() => {
      expect(within(explorerPanel).getByText("No results")).toBeInTheDocument();
      expect(
        within(explorerPanel).getByText("No matching requests or collections."),
      ).toBeInTheDocument();
    });

    await user.clear(searchInput);

    await waitFor(() => {
      expect(explorerPanel.querySelectorAll(".tree-request")).toHaveLength(3);
      expect(within(explorerPanel).getByText("POST /workspaces/search")).toBeInTheDocument();
    });
  });

  it("filters history in both sidebar and workspace panel with empty feedback", async () => {
    renderExplorerApp();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("https://api.example.com/v1/workspaces/search"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole("button", { name: "History" })[0]!);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Recent Request Sessions" })).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search history");
    const explorerPanel = searchInput.closest(".explorer-panel") as HTMLElement | null;
    const historyPanel = screen
      .getByRole("heading", { name: "Recent Request Sessions" })
      .closest("section") as HTMLElement | null;
    if (!explorerPanel || !historyPanel) {
      throw new Error("history panels not found");
    }

    expect(explorerPanel.querySelectorAll(".sidebar-row--history")).toHaveLength(2);
    expect(historyPanel.querySelectorAll(".history-session-card")).toHaveLength(2);

    await user.type(searchInput, "workspace_staging");

    await waitFor(() => {
      expect(explorerPanel.querySelectorAll(".sidebar-row--history")).toHaveLength(1);
      expect(historyPanel.querySelectorAll(".history-session-card")).toHaveLength(1);
      expect(within(historyPanel).getByText("Staging")).toBeInTheDocument();
    });

    await user.clear(searchInput);
    await user.type(searchInput, "missing-history");

    await waitFor(() => {
      expect(within(explorerPanel).getByText("No results")).toBeInTheDocument();
      expect(
        within(explorerPanel).getByText("No matching history entries."),
      ).toBeInTheDocument();
      expect(
        within(historyPanel).getByText("No matching history entries"),
      ).toBeInTheDocument();
      expect(
        within(historyPanel).getByText("No matching history entries."),
      ).toBeInTheDocument();
    });

    await user.clear(searchInput);

    await waitFor(() => {
      expect(explorerPanel.querySelectorAll(".sidebar-row--history")).toHaveLength(2);
      expect(historyPanel.querySelectorAll(".history-session-card")).toHaveLength(2);
    });
  });

  it("filters environments by names and variables with empty feedback", async () => {
    renderExplorerApp();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("https://api.example.com/v1/workspaces/search"),
      ).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole("button", { name: "Environments" })[0]!);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Production" })).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search environments");
    const explorerPanel = searchInput.closest(".explorer-panel") as HTMLElement | null;
    if (!explorerPanel) {
      throw new Error("environments explorer panel not found");
    }

    expect(explorerPanel.querySelectorAll(".environment-card")).toHaveLength(2);

    await user.type(searchInput, "workspace_staging");

    await waitFor(() => {
      expect(explorerPanel.querySelectorAll(".environment-card")).toHaveLength(1);
      expect(within(explorerPanel).getByText("Staging")).toBeInTheDocument();
    });

    await user.clear(searchInput);
    await user.type(searchInput, "missing-environment");

    await waitFor(() => {
      expect(within(explorerPanel).getByText("No results")).toBeInTheDocument();
      expect(
        within(explorerPanel).getByText("No matching environments or variables."),
      ).toBeInTheDocument();
    });

    await user.clear(searchInput);

    await waitFor(() => {
      expect(explorerPanel.querySelectorAll(".environment-card")).toHaveLength(2);
      expect(within(explorerPanel).getAllByText("Production").length).toBeGreaterThan(0);
    });
  });
});
