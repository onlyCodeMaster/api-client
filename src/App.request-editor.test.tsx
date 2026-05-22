import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import App from "./App";
import { queryClient } from "./lib/queryClient";
import { useRequestStore } from "./store/requestStore";
import { useUiStore } from "./store/uiStore";

type MockKeyValue = {
  key: string;
  value: string;
  enabled: boolean;
  description: string;
};

type MockRequest = {
  id: string;
  name: string;
  collection: string;
  collectionFile: string;
  method: string;
  url: string;
  params: MockKeyValue[];
  headers: MockKeyValue[];
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
  requests: MockRequest[];
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
  environments: [
    {
      name: "Production",
      filePath: "environments/production.json",
      vars: [
        { key: "base_url", value: "https://api.example.com" },
        { key: "proxy", value: "system" },
        { key: "cookie_jar", value: "workspace_default" },
      ],
    },
  ],
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

function findCollection(collections: MockCollection[], filePath: string) {
  const collection = collections.find((item) => item.filePath === filePath);
  if (!collection) {
    throw new Error(`collection not found: ${filePath}`);
  }
  return collection;
}

function initialCollections(): MockCollection[] {
  return [
    {
      name: "Core API",
      filePath: "collections/core-api.json",
      requests: [
        {
          id: "req-editor",
          name: "GET /editor",
          collection: "Core API",
          collectionFile: "collections/core-api.json",
          method: "GET",
          url: "https://api.example.com/v1/editor",
          params: [
            {
              key: "page",
              value: "1",
              enabled: true,
              description: "Current page",
            },
            {
              key: "limit",
              value: "20",
              enabled: true,
              description: "Page size",
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
        },
      ],
    },
  ];
}

describe("App P0-4 request editor", () => {
  beforeEach(() => {
    mockWindows("main");
    resetClientState();
  });

  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("focuses the next editable row and autosaves param/header deletions", async () => {
    const calls: Array<{ cmd: string; payload: unknown }> = [];
    const collections = initialCollections();

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
            };
          case "save_request": {
            const input = (payload as { input: MockRequest }).input;
            const collection = findCollection(collections, input.collectionFile);
            const currentIndex = collection.requests.findIndex((request) => request.id === input.id);
            const stored = JSON.parse(JSON.stringify(input)) as MockRequest;
            collection.requests[currentIndex] = stored;
            return cloneCollections([collection])[0];
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
      expect(screen.getByDisplayValue("https://api.example.com/v1/editor")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Request Params tab" }));
    const paramsPanel = document.querySelector(".request-content .editor-panel");
    if (!(paramsPanel instanceof HTMLElement)) {
      throw new Error("params panel not found");
    }

    await user.click(
      within(paramsPanel).getByRole("button", { name: /Remove param row page/i }),
    );

    await waitFor(() => {
      const remainingParamKey = screen.getByDisplayValue("limit");
      expect(remainingParamKey).toHaveFocus();
    });

    await waitFor(
      () => {
        const saveCalls = calls.filter((call) => call.cmd === "save_request");
        expect(saveCalls.length).toBeGreaterThan(0);
        expect(saveCalls[0]).toMatchObject({
          payload: {
            input: {
              params: [
                {
                  key: "limit",
                  value: "20",
                  enabled: true,
                  description: "Page size",
                },
              ],
            },
          },
        });
      },
      { timeout: 3000 },
    );

    await user.click(screen.getByRole("button", { name: "Request Headers tab" }));
    const headersPanel = document.querySelector(".request-content .editor-panel");
    if (!(headersPanel instanceof HTMLElement)) {
      throw new Error("headers panel not found");
    }

    await user.click(
      within(headersPanel).getByRole("button", { name: /Remove header row Accept/i }),
    );

    await waitFor(() => {
      const blankHeaderKey = within(headersPanel).getByPlaceholderText("key");
      expect(blankHeaderKey).toHaveFocus();
    });

    await waitFor(
      () => {
        const saveCalls = calls.filter((call) => call.cmd === "save_request");
        expect(saveCalls.length).toBeGreaterThan(1);
        const lastSaveCall = saveCalls[saveCalls.length - 1];
        expect(lastSaveCall).toMatchObject({
          payload: {
            input: {
              headers: [],
            },
          },
        });
      },
      { timeout: 3000 },
    );

    expect(screen.getByText("Request saved to collection")).toBeInTheDocument();
  });

  it("shows dirty, error, and success request save states", async () => {
    const calls: Array<{ cmd: string; payload: unknown }> = [];
    const collections = initialCollections();
    let saveAttempts = 0;

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
            };
          case "save_request": {
            saveAttempts += 1;
            if (saveAttempts === 1) {
              throw new Error("Disk full");
            }

            const input = (payload as { input: MockRequest }).input;
            const collection = findCollection(collections, input.collectionFile);
            const currentIndex = collection.requests.findIndex((request) => request.id === input.id);
            const stored = JSON.parse(JSON.stringify(input)) as MockRequest;
            collection.requests[currentIndex] = stored;
            return cloneCollections([collection])[0];
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
      expect(screen.getByDisplayValue("https://api.example.com/v1/editor")).toBeInTheDocument();
    });

    expect(screen.getByText("All changes saved")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox"), "POST");

    await waitFor(() => {
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Disk full")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

    const urlInput = screen.getByDisplayValue("https://api.example.com/v1/editor");
    await user.type(urlInput, "?retry=1");

    await waitFor(() => {
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
      expect(screen.queryByText("Disk full")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Request saved to collection")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
    expect(calls.filter((call) => call.cmd === "save_request")).toHaveLength(2);
  });

  it("keeps blank body rows local until edited and autosaves body row removals", async () => {
    const calls: Array<{ cmd: string; payload: unknown }> = [];
    const collections = initialCollections();
    collections[0]!.requests[0] = {
      ...collections[0]!.requests[0]!,
      bodyMode: "urlencoded",
      bodyRows: [
        {
          key: "mode",
          value: "full",
          enabled: true,
          fieldType: "text",
        },
      ],
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
              settings: {
                ...bootstrapState.settings,
                autoSave: true,
              },
              collections: cloneCollections(collections),
            };
          case "save_request": {
            const input = (payload as { input: MockRequest }).input;
            const collection = findCollection(collections, input.collectionFile);
            const currentIndex = collection.requests.findIndex((request) => request.id === input.id);
            const stored = JSON.parse(JSON.stringify(input)) as MockRequest;
            collection.requests[currentIndex] = stored;
            return cloneCollections([collection])[0];
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
      expect(screen.getByDisplayValue("https://api.example.com/v1/editor")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Request Body tab" }));
    const bodyPanel = document.querySelector(".request-content .editor-panel");
    if (!(bodyPanel instanceof HTMLElement)) {
      throw new Error("body panel not found");
    }

    await user.click(within(bodyPanel).getByRole("button", { name: "Add row" }));

    await waitFor(() => {
      const removeButtons = within(bodyPanel).getAllByRole("button", {
        name: /Remove body row/i,
      });
      expect(removeButtons).toHaveLength(2);
    });

    await new Promise((resolve) => {
      window.setTimeout(resolve, 700);
    });

    expect(calls.filter((call) => call.cmd === "save_request")).toHaveLength(0);

    const removeButtons = within(bodyPanel).getAllByRole("button", {
      name: /Remove body row/i,
    });
    await user.click(removeButtons[removeButtons.length - 1]!);

    await waitFor(() => {
      const saveCalls = calls.filter((call) => call.cmd === "save_request");
      expect(saveCalls).toHaveLength(1);
      const latestPayload = saveCalls[0]!.payload as { input: MockRequest };
      expect(latestPayload.input.bodyRows).toEqual([
        {
          key: "mode",
          value: "full",
          enabled: true,
          fieldType: "text",
        },
      ]);
    });
  });
});
