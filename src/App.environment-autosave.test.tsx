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
  history: [],
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

function findEnvironment(environments: MockEnvironment[], filePath: string) {
  const environment = environments.find((item) => item.filePath === filePath);
  if (!environment) {
    throw new Error(`environment not found: ${filePath}`);
  }
  return environment;
}

function initialCollections(): MockCollection[] {
  return [
    {
      name: "Core API",
      filePath: "collections/core-api.json",
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
      filePath: "environments/staging.json",
      vars: [
        { key: "base_url", value: "https://staging-api.example.com" },
        { key: "proxy", value: "disabled" },
        { key: "cookie_jar", value: "workspace_staging" },
      ],
    },
  ];
}

describe("App environment autosave and save states", () => {
  beforeEach(() => {
    mockWindows("main");
    resetClientState();
  });

  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("autosaves the latest environment edits and row removals", async () => {
    const calls: Array<{ cmd: string; payload: unknown }> = [];
    const collections = initialCollections();
    const environments = initialEnvironments();

    mockIPC(
      (cmd, payload) => {
        calls.push({ cmd, payload });

        switch (cmd) {
          case "plugin:event|listen":
            return 1;
          case "load_bootstrap_state":
            return {
              ...bootstrapState,
              settings: {
                ...bootstrapState.settings,
                autoSave: true,
              },
              collections: cloneCollections(collections),
              environments: cloneEnvironments(environments),
            };
          case "save_environment": {
            const input = (payload as {
              input: { name: string; filePath: string; vars: Array<{ key: string; value: string }> };
            }).input;
            const environment = findEnvironment(environments, input.filePath);
            environment.name = input.name;
            environment.vars = input.vars;
            return {
              name: environment.name,
              filePath: environment.filePath,
              vars: environment.vars,
            };
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

    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Workspace Explorer")).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole("button", { name: "Environments" })[0]!);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Production" })).toBeInTheDocument();
    });

    const environmentPanel = screen
      .getByRole("heading", { name: "Production" })
      .closest("section");
    if (!environmentPanel) {
      throw new Error("environment panel not found");
    }

    const baseUrlRow = screen.getByDisplayValue("base_url").closest(".workspace-panel__table-row");
    if (!(baseUrlRow instanceof HTMLElement)) {
      throw new Error("base_url row not found");
    }

    const baseUrlValueInput = within(baseUrlRow).getByDisplayValue(
      "https://api.example.com",
    ) as HTMLInputElement;
    await user.clear(baseUrlValueInput);
    await user.type(baseUrlValueInput, "https://api.example.com/v2");

    await waitFor(
      () => {
        const saveCalls = calls.filter((call) => call.cmd === "save_environment");
        expect(saveCalls).toHaveLength(1);
        expect(saveCalls[0]!.payload).toMatchObject({
          input: {
            name: "Production",
            filePath: "environments/production.json",
            vars: expect.arrayContaining([
              { key: "base_url", value: "https://api.example.com/v2" },
            ]),
          },
        });
      },
      { timeout: 3000 },
    );

    await user.click(
      within(environmentPanel).getByRole("button", { name: /Remove environment var proxy/i }),
    );

    await waitFor(
      () => {
        const saveCalls = calls.filter((call) => call.cmd === "save_environment");
        expect(saveCalls).toHaveLength(2);
        const lastPayload = saveCalls[1]!.payload as {
          input: { vars: Array<{ key: string; value: string }> };
        };
        expect(lastPayload.input.vars).toEqual(
          expect.arrayContaining([
            { key: "base_url", value: "https://api.example.com/v2" },
            { key: "cookie_jar", value: "workspace_default" },
          ]),
        );
        expect(lastPayload.input.vars).not.toEqual(
          expect.arrayContaining([{ key: "proxy", value: "system" }]),
        );
      },
      { timeout: 3000 },
    );
  });

  it("disables Save Env while a save is already in flight", async () => {
    const calls: Array<{ cmd: string; payload: unknown }> = [];
    const collections = initialCollections();
    const environments = initialEnvironments();
    const pendingSave: { resolve: null | (() => void) } = { resolve: null };

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
            };
          case "save_environment": {
            const input = (payload as {
              input: { name: string; filePath: string; vars: Array<{ key: string; value: string }> };
            }).input;
            return new Promise((resolve) => {
              pendingSave.resolve = () => {
                const environment = findEnvironment(environments, input.filePath);
                environment.name = input.name;
                environment.vars = input.vars;
                resolve({
                  name: environment.name,
                  filePath: environment.filePath,
                  vars: environment.vars,
                });
              };
            });
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

    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Workspace Explorer")).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole("button", { name: "Environments" })[0]!);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Production" })).toBeInTheDocument();
    });

    const environmentPanel = screen
      .getByRole("heading", { name: "Production" })
      .closest("section");
    if (!environmentPanel) {
      throw new Error("environment panel not found");
    }

    const baseUrlRow = screen.getByDisplayValue("base_url").closest(".workspace-panel__table-row");
    if (!(baseUrlRow instanceof HTMLElement)) {
      throw new Error("base_url row not found");
    }

    const baseUrlValueInput = within(baseUrlRow).getByDisplayValue(
      "https://api.example.com",
    ) as HTMLInputElement;
    await user.type(baseUrlValueInput, "/manual");

    await waitFor(() => {
      expect(screen.getByText("Unsaved environment changes")).toBeInTheDocument();
    });

    const saveButton = within(environmentPanel).getByRole("button", { name: "Save Env" });
    await user.click(saveButton);

    await waitFor(() => {
      expect(saveButton).toHaveTextContent("Saving...");
      expect(saveButton).toBeDisabled();
    });

    expect(calls.filter((call) => call.cmd === "save_environment")).toHaveLength(1);

    const finalizeSave = pendingSave.resolve;
    if (finalizeSave) {
      finalizeSave();
    }

    await waitFor(() => {
      expect(screen.getByText("Environment saved to local storage")).toBeInTheDocument();
    });
  });
});
