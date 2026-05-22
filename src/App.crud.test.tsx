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
    params: Array<{ key: string; value: string; enabled: boolean }>;
    headers: Array<{ key: string; value: string; enabled: boolean }>;
    body: string;
    authType: string;
    authToken: string;
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

const initialCollections = (): MockCollection[] => [
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
        authType: "none",
        authToken: "",
      },
      {
        id: "req-search",
        name: "POST /workspaces/search",
        collection: "Core API",
        collectionFile: "collections/core-api.json",
        method: "POST",
        url: "https://api.example.com/v1/workspaces/search",
        params: [],
        headers: [],
        body: "{}",
        authType: "none",
        authToken: "",
      },
    ],
  },
  {
    name: "Auth",
    filePath: "collections/auth.json",
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
        body: "{}",
        authType: "none",
        authToken: "",
      },
    ],
  },
];

const initialEnvironments = (): MockEnvironment[] => [
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectionTogglePattern(name: string, fileName: string, count: number) {
  return new RegExp(
    `${escapeRegex(name)}.*${escapeRegex(fileName)}.*${escapeRegex(String(count))}`,
    "i",
  );
}

function getActionCard(title: string) {
  const card = screen.getByText(title).closest(".collection-action-card");
  if (!card) {
    throw new Error(`action card not found: ${title}`);
  }
  return card as HTMLElement;
}

describe("App P0-1 CRUD flows", () => {
  beforeEach(() => {
    mockWindows("main");
    useRequestStore.setState(useRequestStore.getInitialState());
    useUiStore.setState(useUiStore.getInitialState());
    queryClient.clear();
  });

  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("sends create, move, reorder and delete collection/request commands with persisted state updates", async () => {
    const calls: Array<{ cmd: string; payload: unknown }> = [];
    const collections = initialCollections();
    const environments = initialEnvironments();

    mockIPC((cmd, payload) => {
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
        case "create_collection": {
          const input = (payload as { input: { name: string; filePath: string } }).input;
          const created = {
            name: input.name,
            filePath: input.filePath,
            requests: [],
          };
          collections.push(created);
          return created;
        }
        case "rename_collection": {
          const input = (payload as {
            input: { currentFilePath: string; newName: string; newFilePath: string };
          }).input;
          const collection = findCollection(collections, input.currentFilePath);
          collection.name = input.newName;
          collection.filePath = input.newFilePath;
          collection.requests = collection.requests.map((request) => ({
            ...request,
            collection: input.newName,
            collectionFile: input.newFilePath,
          }));
          return cloneCollections([collection])[0];
        }
        case "move_collection": {
          const input = (payload as { input: { filePath: string; targetIndex: number } }).input;
          const currentIndex = collections.findIndex((item) => item.filePath === input.filePath);
          const [moved] = collections.splice(currentIndex, 1);
          collections.splice(input.targetIndex, 0, moved);
          return cloneCollections(collections);
        }
        case "save_request": {
          const input = (payload as { input: MockCollection["requests"][number] }).input;
          const collection = findCollection(collections, input.collectionFile);
          const existingIndex = collection.requests.findIndex((request) => request.id === input.id);
          const stored = {
            ...input,
            params: input.params,
            headers: input.headers,
          };
          if (existingIndex >= 0) {
            collection.requests[existingIndex] = stored;
          } else {
            collection.requests.push(stored);
          }
          return cloneCollections([collection])[0];
        }
        case "reorder_request": {
          const input = (payload as {
            input: { collectionFile: string; requestId: string; targetIndex: number };
          }).input;
          const collection = findCollection(collections, input.collectionFile);
          const currentIndex = collection.requests.findIndex((request) => request.id === input.requestId);
          const [moved] = collection.requests.splice(currentIndex, 1);
          collection.requests.splice(input.targetIndex, 0, moved);
          return cloneCollections([collection])[0];
        }
        case "move_request": {
          const input = (payload as {
            input: {
              requestId: string;
              sourceCollectionFile: string;
              targetCollectionFile: string;
              targetIndex: number;
            };
          }).input;
          const source = findCollection(collections, input.sourceCollectionFile);
          const target = findCollection(collections, input.targetCollectionFile);
          const currentIndex = source.requests.findIndex((request) => request.id === input.requestId);
          const [moved] = source.requests.splice(currentIndex, 1);
          moved.collection = target.name;
          moved.collectionFile = target.filePath;
          target.requests.splice(Math.min(input.targetIndex, target.requests.length), 0, moved);
          return {
            sourceCollection: cloneCollections([source])[0],
            targetCollection: cloneCollections([target])[0],
            movedRequest: { ...moved },
          };
        }
        case "delete_request": {
          const input = (payload as { input: { requestId: string; collectionFile: string } }).input;
          const collection = findCollection(collections, input.collectionFile);
          collection.requests = collection.requests.filter((request) => request.id !== input.requestId);
          return cloneCollections([collection])[0];
        }
        case "delete_collection": {
          const input = (payload as { input: { filePath: string } }).input;
          const currentIndex = collections.findIndex((item) => item.filePath === input.filePath);
          collections.splice(currentIndex, 1);
          return null;
        }
        default:
          return null;
      }
    }, { shouldMockEvents: true });

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Local Data Ready")).toBeInTheDocument();
    });

    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "New Collection" }));
    const createCollectionCard = getActionCard("Create Collection");
    const nameInput = within(createCollectionCard).getByPlaceholderText(
      "Enter a name",
    ) as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, "Payments");
    await user.click(within(createCollectionCard).getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Payments" })).toBeInTheDocument();
    });

    const createCall = calls.find((call) => call.cmd === "create_collection");
    expect(createCall).toBeTruthy();
    expect(createCall?.payload).toMatchObject({
      input: {
        name: "Payments",
        filePath: "collections/payments.json",
      },
    });

    const emptyCollectionState = screen
      .getByText(
        "This collection is ready, but it does not contain any requests yet. Create a new request or import one into this collection.",
      )
      .closest("section") as HTMLElement | null;
    if (!emptyCollectionState) {
      throw new Error("empty collection state not found");
    }
    await user.click(within(emptyCollectionState).getByRole("button", { name: "New Request" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Untitled Request" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Untitled Request copy" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Rename Req" }));
    const renameRequestCard = getActionCard("Rename Request");
    const renameInput = within(renameRequestCard).getByPlaceholderText(
      "Enter a name",
    ) as HTMLInputElement;
    await user.clear(renameInput);
    await user.type(renameInput, "Create Payment");
    await user.click(within(renameRequestCard).getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Create Payment" })).toBeInTheDocument();
    });

    const saveRequestCalls = calls.filter((call) => call.cmd === "save_request");
    const saveCall = saveRequestCalls[saveRequestCalls.length - 1];
    expect(saveCall?.payload).toMatchObject({
      input: {
        name: "Create Payment",
        collection: "Payments",
        collectionFile: "collections/payments.json",
      },
    });

    await user.click(screen.getByRole("button", { name: "Move Req" }));
    const moveRequestCard = getActionCard("Move Request");
    await user.selectOptions(
      within(moveRequestCard).getByRole("combobox") as HTMLSelectElement,
      "collections/core-api.json",
    );
    await user.click(within(moveRequestCard).getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: collectionTogglePattern("Core API", "core-api.json", 3),
        }),
      ).toBeInTheDocument();
    });

    const moveRequestCall = calls.find((call) => call.cmd === "move_request");
    expect(moveRequestCall?.payload).toMatchObject({
      input: {
        sourceCollectionFile: "collections/payments.json",
        targetCollectionFile: "collections/core-api.json",
      },
    });

    await user.click(screen.getByRole("button", { name: "Req Up" }));
    await user.click(screen.getByRole("button", { name: "Col Down" }));

    await user.click(screen.getByRole("button", { name: "Rename Col" }));
    const renameCollectionCard = getActionCard("Rename Collection");
    const renameCollectionInput = within(renameCollectionCard).getByPlaceholderText(
      "Enter a name",
    ) as HTMLInputElement;
    await user.clear(renameCollectionInput);
    await user.type(renameCollectionInput, "Core Platform");
    await user.click(within(renameCollectionCard).getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: collectionTogglePattern("Core Platform", "core-platform.json", 3),
        }),
      ).toBeInTheDocument();
    });

    const renameCollectionCall = calls.find((call) => call.cmd === "rename_collection");
    expect(renameCollectionCall?.payload).toMatchObject({
      input: {
        currentFilePath: "collections/core-api.json",
        newName: "Core Platform",
        newFilePath: "collections/core-platform.json",
      },
    });

    await user.click(screen.getByRole("button", { name: "Delete Req" }));
    const deleteRequestCard = getActionCard("Delete Request");
    await user.click(within(deleteRequestCard).getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(calls.some((call) => call.cmd === "delete_request")).toBe(true);
    });

    await user.click(
      screen.getByRole("button", {
        name: collectionTogglePattern("Payments", "payments.json", 0),
      }),
    );
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Payments" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Delete Col" }));
    const deleteCollectionCard = getActionCard("Delete Collection");
    await user.click(within(deleteCollectionCard).getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", {
          name: collectionTogglePattern("Payments", "payments.json", 0),
        }),
      ).not.toBeInTheDocument();
    });

    expect(calls.some((call) => call.cmd === "move_collection")).toBe(true);
    expect(calls.some((call) => call.cmd === "reorder_request")).toBe(true);
    expect(calls.some((call) => call.cmd === "delete_request")).toBe(true);
    expect(calls.some((call) => call.cmd === "delete_collection")).toBe(true);
  });

  it("supports environment create, rename, variable edits, save and delete flows", async () => {
    const calls: Array<{ cmd: string; payload: unknown }> = [];
    const collections = initialCollections();
    const environments = initialEnvironments();

    mockIPC((cmd, payload) => {
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
          const existingIndex = environments.findIndex(
            (environment) => environment.filePath === input.filePath,
          );
          const stored = {
            name: input.name,
            filePath: input.filePath,
            vars: input.vars,
          };
          if (existingIndex >= 0) {
            environments[existingIndex] = stored;
          } else {
            environments.push(stored);
          }
          return { ...stored };
        }
        case "rename_environment": {
          const input = (payload as {
            input: { currentFilePath: string; newName: string; newFilePath: string };
          }).input;
          const environment = findEnvironment(environments, input.currentFilePath);
          environment.name = input.newName;
          environment.filePath = input.newFilePath;
          return { ...environment };
        }
        case "delete_environment": {
          const input = (payload as { input: { filePath: string } }).input;
          const currentIndex = environments.findIndex(
            (environment) => environment.filePath === input.filePath,
          );
          environments.splice(currentIndex, 1);
          return null;
        }
        default:
          return null;
      }
    }, { shouldMockEvents: true });

    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Local Data Ready")).toBeInTheDocument();
    });

    const user = userEvent.setup();

    await user.click(screen.getAllByRole("button", { name: "Environments" })[0]);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Production" })).toBeInTheDocument();
    });

    const environmentPanel = screen
      .getByRole("heading", { name: "Production" })
      .closest("section");
    if (!environmentPanel) {
      throw new Error("environment panel not found");
    }

    await user.click(within(environmentPanel).getByRole("button", { name: "New Env" }));
    const createEnvironmentCard = getActionCard("Create Environment");
    const createEnvironmentInput = within(createEnvironmentCard).getByPlaceholderText(
      "Enter a name",
    ) as HTMLInputElement;
    await user.clear(createEnvironmentInput);
    await user.type(createEnvironmentInput, "QA");
    await user.click(within(createEnvironmentCard).getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "QA" })).toBeInTheDocument();
    });

    const createEnvironmentCall = calls.find((call) => call.cmd === "save_environment");
    expect(createEnvironmentCall?.payload).toMatchObject({
      input: {
        name: "QA",
        filePath: "environments/qa.json",
      },
    });

    const qaEnvironmentPanel = screen
      .getByRole("heading", { name: "QA" })
      .closest("section");
    if (!qaEnvironmentPanel) {
      throw new Error("qa environment panel not found");
    }

    await user.click(within(qaEnvironmentPanel).getByRole("button", { name: "Rename Env" }));
    const renameEnvironmentCard = getActionCard("Rename Environment");
    const renameEnvironmentInput = within(renameEnvironmentCard).getByPlaceholderText(
      "Enter a name",
    ) as HTMLInputElement;
    await user.clear(renameEnvironmentInput);
    await user.type(renameEnvironmentInput, "QA Stable");
    await user.click(within(renameEnvironmentCard).getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "QA Stable" })).toBeInTheDocument();
    });

    const renameEnvironmentCall = calls.find((call) => call.cmd === "rename_environment");
    expect(renameEnvironmentCall?.payload).toMatchObject({
      input: {
        currentFilePath: "environments/qa.json",
        newName: "QA Stable",
        newFilePath: "environments/qa-stable.json",
      },
    });

    const qaStableEnvironmentPanel = screen
      .getByRole("heading", { name: "QA Stable" })
      .closest("section");
    if (!qaStableEnvironmentPanel) {
      throw new Error("qa stable environment panel not found");
    }

    await user.click(within(qaStableEnvironmentPanel).getByRole("button", { name: "Add Variable" }));
    const keyInputs = screen.getAllByPlaceholderText("base_url") as HTMLInputElement[];
    const valueInputs = screen.getAllByPlaceholderText(
      "https://api.example.com",
    ) as HTMLInputElement[];
    const newKeyInput = keyInputs[keyInputs.length - 1];
    const newValueInput = valueInputs[valueInputs.length - 1];
    await user.type(newKeyInput, "timeout_ms");
    await user.type(newValueInput, "5000");

    await user.click(within(qaStableEnvironmentPanel).getByRole("button", { name: "Save Env" }));

    await waitFor(() => {
      expect(screen.getByText("Environment saved to local storage")).toBeInTheDocument();
    });

    const saveEnvironmentCalls = calls.filter((call) => call.cmd === "save_environment");
    const lastSaveEnvironmentCall = saveEnvironmentCalls[saveEnvironmentCalls.length - 1];
    expect(lastSaveEnvironmentCall?.payload).toMatchObject({
      input: {
        name: "QA Stable",
        filePath: "environments/qa-stable.json",
        vars: expect.arrayContaining([
          { key: "timeout_ms", value: "5000" },
        ]),
      },
    });

    await user.click(within(qaStableEnvironmentPanel).getByRole("button", { name: /Remove environment var timeout_ms/i }));
    await user.click(within(qaStableEnvironmentPanel).getByRole("button", { name: "Save Env" }));

    await waitFor(() => {
      const nextSaveCalls = calls.filter((call) => call.cmd === "save_environment");
      expect(nextSaveCalls.length).toBeGreaterThan(saveEnvironmentCalls.length);
    });

    const afterRemoveSaveCalls = calls.filter((call) => call.cmd === "save_environment");
    const afterRemoveSaveCall = afterRemoveSaveCalls[afterRemoveSaveCalls.length - 1];
    expect(afterRemoveSaveCall?.payload).toMatchObject({
      input: {
        name: "QA Stable",
        filePath: "environments/qa-stable.json",
      },
    });
    expect((afterRemoveSaveCall?.payload as { input: { vars: Array<{ key: string; value: string }> } }).input.vars)
      .not.toEqual(expect.arrayContaining([{ key: "timeout_ms", value: "5000" }]));

    await user.click(within(qaStableEnvironmentPanel).getByRole("button", { name: "Delete Env" }));
    const deleteEnvironmentCard = getActionCard("Delete Environment");
    await user.click(within(deleteEnvironmentCard).getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "QA Stable" })).not.toBeInTheDocument();
    });

    expect(calls.some((call) => call.cmd === "rename_environment")).toBe(true);
    expect(calls.some((call) => call.cmd === "delete_environment")).toBe(true);
  });
});
