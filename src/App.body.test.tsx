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
  params: Array<{ key: string; value: string; enabled: boolean }>;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
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
};

type MockCollection = {
  name: string;
  filePath: string;
  requests: MockRequest[];
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

function initialCollections(): MockCollection[] {
  return [
    {
      name: "Core API",
      filePath: "collections/core-api.json",
      requests: [
        {
          id: "req-body",
          name: "POST /body",
          collection: "Core API",
          collectionFile: "collections/core-api.json",
          method: "POST",
          url: "https://api.example.com/v1/body",
          params: [],
          headers: [
            {
              key: "Accept",
              value: "application/json",
              enabled: true,
            },
          ],
          body: '{\n  "message": "hello"\n}',
          bodyMode: "json",
          bodyContentType: "application/json",
          bodyRows: [],
          authType: "none",
          authToken: "",
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
  ];
}

function cloneCollections(collections: MockCollection[]) {
  return JSON.parse(JSON.stringify(collections)) as MockCollection[];
}

function cloneEnvironments(environments: MockEnvironment[]) {
  return JSON.parse(JSON.stringify(environments)) as MockEnvironment[];
}

function findCollection(collections: MockCollection[], filePath: string) {
  const collection = collections.find((item) => item.filePath === filePath);
  if (!collection) {
    throw new Error(`collection not found: ${filePath}`);
  }
  return collection;
}

function resetClientState() {
  useRequestStore.setState(useRequestStore.getInitialState());
  useUiStore.setState(useUiStore.getInitialState());
  queryClient.clear();
}

function getBodyEditor(container: HTMLElement) {
  const editor = container.querySelector(".editor-panel--full");
  if (!editor) {
    throw new Error("body editor not found");
  }
  return editor as HTMLElement;
}

describe("App P1-1 body modes", () => {
  beforeEach(() => {
    mockWindows("main");
    resetClientState();
  });

  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("switches request body modes and preserves saved state across reloads", async () => {
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
              collections: cloneCollections(collections),
              environments: cloneEnvironments(environments),
            };
          case "save_request": {
            const input = (payload as { input: MockRequest }).input;
            const collection = findCollection(collections, input.collectionFile);
            const currentIndex = collection.requests.findIndex((request) => request.id === input.id);
            const stored = JSON.parse(JSON.stringify(input)) as MockRequest;

            if (currentIndex >= 0) {
              collection.requests[currentIndex] = stored;
            } else {
              collection.requests.push(stored);
            }

            return cloneCollections([collection])[0];
          }
          case "send_request":
            return {
              status: "200 OK",
              durationMs: 12,
              sizeBytes: 32,
              protocol: "HTTP/1.1",
              body: "{}",
              headers: [],
              timeline: [],
              summary: {
                cookieJar: "SQLite / workspace_default / 0 updated",
                secretSource: "No auth",
                collectionFile: "Core API.json / POST /body",
              },
            };
          default:
            return null;
        }
      },
      { shouldMockEvents: true },
    );

    const renderApp = () =>
      render(
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>,
      );

    const waitForReady = async () => {
      await waitFor(() => {
        expect(
          screen.getByDisplayValue("https://api.example.com/v1/body"),
        ).toBeInTheDocument();
      });
    };

    const openBodyTab = async () => {
      await user.click(screen.getByRole("button", { name: "Request Body tab" }));
    };

    const user = userEvent.setup();

    let view = renderApp();
    await waitForReady();
    await openBodyTab();

    let bodyEditor = getBodyEditor(view.container);
    expect(within(bodyEditor).getByRole("button", { name: "JSON" })).toHaveClass("is-active");
    let textarea = bodyEditor.querySelector("textarea") as HTMLTextAreaElement | null;
    if (!textarea) {
      throw new Error("json textarea not found");
    }
    expect(textarea.value).toContain('"message": "hello"');
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      const sendRequestCalls = calls.filter((call) => call.cmd === "send_request");
      expect(sendRequestCalls.length).toBe(1);
    });

    let sendRequestCalls = calls.filter((call) => call.cmd === "send_request");
    expect(sendRequestCalls[sendRequestCalls.length - 1]?.payload).toMatchObject({
      input: {
        requestId: "req-body",
        body: '{\n  "message": "hello"\n}',
        bodyMode: "json",
        bodyContentType: "application/json",
        bodyRows: [],
      },
    });

    await user.click(within(bodyEditor).getByRole("button", { name: "Raw" }));
    bodyEditor = getBodyEditor(view.container);
    textarea = bodyEditor.querySelector("textarea") as HTMLTextAreaElement | null;
    if (!textarea) {
      throw new Error("raw textarea not found");
    }
    const rawContentType = within(bodyEditor).getByPlaceholderText(
      "Optional, e.g. text/plain",
    ) as HTMLInputElement;
    await user.clear(textarea);
    await user.type(textarea, "plain text body");
    await user.clear(rawContentType);
    await user.type(rawContentType, "text/plain");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Request saved to collection")).toBeInTheDocument();
    });

    let saveRequestCalls = calls.filter((call) => call.cmd === "save_request");
    expect(saveRequestCalls[saveRequestCalls.length - 1]?.payload).toMatchObject({
      input: {
        id: "req-body",
        body: "plain text body",
        bodyMode: "raw",
        bodyContentType: "text/plain",
        bodyRows: [],
      },
    });

    view.unmount();
    resetClientState();
    view = renderApp();
    await waitForReady();
    await openBodyTab();

    bodyEditor = getBodyEditor(view.container);
    expect(within(bodyEditor).getByRole("button", { name: "Raw" })).toHaveClass("is-active");
    textarea = bodyEditor.querySelector("textarea") as HTMLTextAreaElement | null;
    if (!textarea) {
      throw new Error("reloaded raw textarea not found");
    }
    expect(textarea.value).toBe("plain text body");
    expect(
      within(bodyEditor).getByDisplayValue("text/plain"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      const nextSendCalls = calls.filter((call) => call.cmd === "send_request");
      expect(nextSendCalls.length).toBeGreaterThan(sendRequestCalls.length);
    });

    sendRequestCalls = calls.filter((call) => call.cmd === "send_request");
    expect(sendRequestCalls[sendRequestCalls.length - 1]?.payload).toMatchObject({
      input: {
        requestId: "req-body",
        body: "plain text body",
        bodyMode: "raw",
        bodyContentType: "text/plain",
      },
    });

    await user.click(within(bodyEditor).getByRole("button", { name: "Form URL" }));
    await waitFor(() => {
      expect(
        within(getBodyEditor(view.container)).getByText(
          "application/x-www-form-urlencoded",
        ),
      ).toBeInTheDocument();
    });

    bodyEditor = getBodyEditor(view.container);
    const urlencodedKeyInput = within(bodyEditor).getByPlaceholderText("key") as HTMLInputElement;
    const urlencodedValueInput = within(bodyEditor).getByPlaceholderText(
      "value",
    ) as HTMLInputElement;
    await user.clear(urlencodedKeyInput);
    await user.type(urlencodedKeyInput, "q");
    await user.clear(urlencodedValueInput);
    await user.type(urlencodedValueInput, "workspace");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const nextSaveCalls = calls.filter((call) => call.cmd === "save_request");
      expect(nextSaveCalls.length).toBeGreaterThan(saveRequestCalls.length);
    });

    saveRequestCalls = calls.filter((call) => call.cmd === "save_request");
    expect(saveRequestCalls[saveRequestCalls.length - 1]?.payload).toMatchObject({
      input: {
        id: "req-body",
        bodyMode: "urlencoded",
        bodyRows: expect.arrayContaining([
          {
            key: "q",
            value: "workspace",
            enabled: true,
            fieldType: "text",
          },
        ]),
      },
    });

    view.unmount();
    resetClientState();
    view = renderApp();
    await waitForReady();
    await openBodyTab();

    bodyEditor = getBodyEditor(view.container);
    expect(within(bodyEditor).getByRole("button", { name: "Form URL" })).toHaveClass("is-active");
    expect(within(bodyEditor).getByDisplayValue("q")).toBeInTheDocument();
    expect(within(bodyEditor).getByDisplayValue("workspace")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      const nextSendCalls = calls.filter((call) => call.cmd === "send_request");
      expect(nextSendCalls.length).toBeGreaterThan(sendRequestCalls.length);
    });

    sendRequestCalls = calls.filter((call) => call.cmd === "send_request");
    expect(sendRequestCalls[sendRequestCalls.length - 1]?.payload).toMatchObject({
      input: {
        requestId: "req-body",
        bodyMode: "urlencoded",
        bodyRows: expect.arrayContaining([
          {
            key: "q",
            value: "workspace",
            enabled: true,
            fieldType: "text",
          },
        ]),
      },
    });

    await user.click(within(bodyEditor).getByRole("button", { name: "Multipart" }));
    bodyEditor = getBodyEditor(view.container);
    const fieldTypeSelect = within(bodyEditor).getByDisplayValue("Text") as HTMLSelectElement;
    await user.selectOptions(fieldTypeSelect, "file");

    const multipartKeyInput = within(bodyEditor).getByDisplayValue("q") as HTMLInputElement;
    const multipartValueInput = within(bodyEditor).getByDisplayValue(
      "workspace",
    ) as HTMLInputElement;
    await user.clear(multipartKeyInput);
    await user.type(multipartKeyInput, "attachment");
    await user.clear(multipartValueInput);
    await user.type(multipartValueInput, "/tmp/report.csv");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const nextSaveCalls = calls.filter((call) => call.cmd === "save_request");
      expect(nextSaveCalls.length).toBeGreaterThan(saveRequestCalls.length);
    });

    saveRequestCalls = calls.filter((call) => call.cmd === "save_request");
    expect(saveRequestCalls[saveRequestCalls.length - 1]?.payload).toMatchObject({
      input: {
        id: "req-body",
        bodyMode: "multipart",
        bodyRows: expect.arrayContaining([
          {
            key: "attachment",
            value: "/tmp/report.csv",
            enabled: true,
            fieldType: "file",
          },
        ]),
      },
    });

    view.unmount();
    resetClientState();
    view = renderApp();
    await waitForReady();
    await openBodyTab();

    bodyEditor = getBodyEditor(view.container);
    expect(within(bodyEditor).getByRole("button", { name: "Multipart" })).toHaveClass("is-active");
    expect(within(bodyEditor).getByDisplayValue("File")).toBeInTheDocument();
    expect(within(bodyEditor).getByDisplayValue("attachment")).toBeInTheDocument();
    expect(within(bodyEditor).getByDisplayValue("/tmp/report.csv")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      const nextSendCalls = calls.filter((call) => call.cmd === "send_request");
      expect(nextSendCalls.length).toBeGreaterThan(sendRequestCalls.length);
    });

    sendRequestCalls = calls.filter((call) => call.cmd === "send_request");
    expect(sendRequestCalls[sendRequestCalls.length - 1]?.payload).toMatchObject({
      input: {
        requestId: "req-body",
        bodyMode: "multipart",
        bodyRows: expect.arrayContaining([
          {
            key: "attachment",
            value: "/tmp/report.csv",
            enabled: true,
            fieldType: "file",
          },
        ]),
      },
    });
  });
});
