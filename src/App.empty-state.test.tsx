import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import App from "./App";
import { queryClient } from "./lib/queryClient";
import { useRequestStore } from "./store/requestStore";
import { useUiStore } from "./store/uiStore";

type MockCollection = {
  name: string;
  filePath: string;
  group: string;
  collapsed: boolean;
  requests: Array<{
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
  }>;
};

type MockEnvironment = {
  name: string;
  filePath: string;
  vars: Array<{ key: string; value: string }>;
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

function renderEmptyWorkspaceApp() {
  const calls: Array<{ cmd: string; payload: unknown }> = [];
  const collections: MockCollection[] = [];
  const environments: MockEnvironment[] = [];

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
            history: [],
          };
        case "save_request": {
          const input = payload as {
            input: MockCollection["requests"][number];
          };
          const existingCollection = collections.find(
            (collection) => collection.filePath === input.input.collectionFile,
          );
          const savedRequest = JSON.parse(
            JSON.stringify(input.input),
          ) as MockCollection["requests"][number];

          if (existingCollection) {
            const targetIndex = existingCollection.requests.findIndex(
              (request) => request.id === savedRequest.id,
            );
            if (targetIndex >= 0) {
              existingCollection.requests[targetIndex] = savedRequest;
            } else {
              existingCollection.requests.push(savedRequest);
            }
            return existingCollection;
          }

          const createdCollection: MockCollection = {
            name: savedRequest.collection,
            filePath: savedRequest.collectionFile,
            group: "",
            collapsed: false,
            requests: [savedRequest],
          };
          collections.push(createdCollection);
          return createdCollection;
        }
        case "save_environment": {
          const input = payload as {
            input: { name: string; filePath: string; vars: Array<{ key: string; value: string }> };
          };
          const savedEnvironment = JSON.parse(JSON.stringify(input.input)) as MockEnvironment;
          const existingIndex = environments.findIndex(
            (environment) => environment.filePath === savedEnvironment.filePath,
          );
          if (existingIndex >= 0) {
            environments[existingIndex] = savedEnvironment;
          } else {
            environments.push(savedEnvironment);
          }
          return savedEnvironment;
        }
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

describe("App P0-6 empty workspace states", () => {
  beforeEach(() => {
    mockWindows("main");
    resetClientState();
  });

  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("shows empty workspace guidance and lets the first request create a real local collection", async () => {
    const calls = renderEmptyWorkspaceApp();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Create your first request" })).toBeInTheDocument();
    });

    expect(screen.getByText("No requests yet. Import or save your first request.")).toBeInTheDocument();
    expect(screen.getAllByText("No collections yet").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Create collection" })).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "History" })[0]!);

    await waitFor(() => {
      expect(screen.getByText("No history yet")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Send a request to start building a replayable request history."),
    ).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Collections" })[0]!);
    await user.click(screen.getByRole("button", { name: "New Request" }));

    await waitFor(() => {
      const saveCalls = calls.filter((call) => call.cmd === "save_request");
      expect(saveCalls).toHaveLength(1);
      expect(saveCalls[0]!.payload).toMatchObject({
        input: {
          name: "Untitled Request",
          collection: "Unfiled",
          collectionFile: "collections/unfiled.json",
          method: "GET",
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Untitled Request" })).toBeInTheDocument();
    });

    expect(screen.getByText("Request saved to collection")).toBeInTheDocument();
    expect(screen.getAllByText("Unfiled").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Create your first request" })).not.toBeInTheDocument();
  });

  it("shows empty environment guidance and creates the first local environment from the empty state", async () => {
    const calls = renderEmptyWorkspaceApp();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Create your first request" })).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole("button", { name: "Environments" })[0]!);

    await waitFor(() => {
      expect(screen.getAllByText("No environments yet").length).toBeGreaterThan(0);
    });
    expect(screen.getAllByRole("button", { name: "Create local environment" }).length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: "Create local environment" })[0]!);

    const actionCard = await waitFor(() => {
      const card = screen.getByText("Create Environment").closest(".collection-action-card");
      if (!card) {
        throw new Error("environment action card not found");
      }
      return card as HTMLElement;
    });

    expect(within(actionCard).getByDisplayValue("Local Environment")).toBeInTheDocument();

    await user.click(within(actionCard).getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      const saveCalls = calls.filter((call) => call.cmd === "save_environment");
      expect(saveCalls).toHaveLength(1);
      expect(saveCalls[0]!.payload).toMatchObject({
        input: {
          name: "Local Environment",
          filePath: "environments/local-environment.json",
          vars: expect.arrayContaining([
            { key: "base_url", value: "http://localhost:3000" },
            { key: "proxy", value: "system" },
            { key: "tls_verify", value: "true" },
            { key: "tls_hostname_verify", value: "true" },
            { key: "cookie_jar", value: "default" },
          ]),
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Local Environment" })).toBeInTheDocument();
    });

    expect(screen.getByText("Created your first local environment")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Env" })).toBeDisabled();
    expect(screen.getByDisplayValue("http://localhost:3000")).toBeInTheDocument();
  });
});
