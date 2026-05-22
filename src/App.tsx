import { useEffect, useRef, useState } from "react";
import {
  createCollection,
  deleteCollection,
  deleteEnvironment,
  deleteRequest,
  downloadFile,
  exportCurl,
  importCurl,
  importPostmanCollection,
  listenBridgeEvents,
  loadBootstrapState,
  moveCollection,
  moveRequest,
  renameCollection,
  renameEnvironment,
  reorderRequest,
  saveEnvironment,
  saveRequest,
  saveSecret,
  uploadFile,
  type BridgeEvent,
  type StoredRequest as PersistedRequest,
} from "./lib/tauri";
import {
  makeScratchEnvironment,
  useRequestStore,
  type RequestBodyFieldType,
  type EnvironmentRecord,
  type KeyValueRow,
  type RequestBodyRow,
  type RequestMethod,
  type RequestRecord,
} from "./store/requestStore";
import { useUiStore } from "./store/uiStore";

const requestTabs = [
  { key: "params", label: "Params" },
  { key: "headers", label: "Headers" },
  { key: "body", label: "Body" },
  { key: "auth", label: "Auth" },
] as const;

const responseTabs = [
  { key: "body", label: "Body" },
  { key: "headers", label: "Headers" },
  { key: "timeline", label: "Timeline" },
] as const;

const sidebarPanels = [
  { key: "collections", short: "CO", label: "Collections", caption: "Workspace Explorer" },
  { key: "history", short: "HI", label: "History", caption: "Recent Requests" },
  { key: "environments", short: "EN", label: "Environments", caption: "Variables and Secrets" },
  { key: "settings", short: "ST", label: "Settings", caption: "Local Runtime" },
] as const;

const requestMethods: RequestMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

type CollectionDescriptor = {
  name: string;
  filePath: string;
};

type CollectionActionMode =
  | null
  | "create-collection"
  | "rename-collection"
  | "delete-collection"
  | "rename-request"
  | "delete-request"
  | "move-request";

type EnvironmentActionMode =
  | null
  | "create-environment"
  | "rename-environment"
  | "delete-environment";

function commandErrorMessage(error: unknown, action: string) {
  if (error instanceof Error) {
    if (error.message.includes("reading 'invoke'")) {
      return `${action} requires the Tauri desktop runtime.`;
    }

    return error.message;
  }

  return `Failed to ${action.toLowerCase()}.`;
}

function safePathname(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function formatBytes(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 B";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRuntimeTimestamp(timestamp: string) {
  if (!timestamp) {
    return "Not written yet";
  }

  const parsed = Number(timestamp);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return timestamp;
  }

  return new Date(parsed).toLocaleString();
}

function resolveHistoryRequestId(
  historyItem: {
    requestId: string;
    method: string;
    url: string;
  },
  requests: RequestRecord[],
) {
  if (historyItem.requestId && requests.some((request) => request.id === historyItem.requestId)) {
    return historyItem.requestId;
  }

  const pathname = safePathname(historyItem.url);
  const matched = requests.find(
    (request) =>
      request.method === historyItem.method && safePathname(request.url) === pathname,
  );

  return matched?.id ?? requests[0]?.id ?? "";
}

function normalizeRows(
  rows: Array<{ key: string; value: string; enabled: boolean }>,
  prefix: string,
) {
  return rows.map((row, index) => ({
    id: `${prefix}-${index + 1}-${row.key || "row"}`,
    key: row.key,
    value: row.value,
    enabled: row.enabled,
  }));
}

function sanitizeEditableRows(rows: KeyValueRow[]) {
  return rows.filter((row) => row.key.trim() !== "" || row.value.trim() !== "");
}

function normalizeRequestBodyRows(
  rows: Array<{ key: string; value: string; enabled: boolean; fieldType: string }>,
  prefix: string,
): RequestBodyRow[] {
  return rows.map((row, index) => ({
    id: `${prefix}-body-${index + 1}-${row.key || "row"}`,
    key: row.key,
    value: row.value,
    enabled: row.enabled,
    fieldType: row.fieldType === "file" ? "file" : "text",
  }));
}

function sanitizeBodyRows(rows: RequestBodyRow[]) {
  return rows
    .filter((row) => row.key.trim() !== "" || row.value.trim() !== "")
    .map((row) => ({
      key: row.key,
      value: row.value,
      enabled: row.enabled,
      fieldType: row.fieldType,
    }));
}

function isStructuredBodyMode(mode: RequestRecord["bodyMode"]) {
  return mode === "urlencoded" || mode === "multipart";
}

function defaultBodyContentType(mode: RequestRecord["bodyMode"]) {
  switch (mode) {
    case "json":
      return "application/json";
    case "urlencoded":
      return "application/x-www-form-urlencoded";
    case "multipart":
      return "multipart/form-data";
    default:
      return "";
  }
}

function bodyModeHeading(request: Pick<RequestRecord, "bodyMode" | "bodyContentType">) {
  if (request.bodyMode === "raw") {
    return request.bodyContentType.trim() || "Raw body";
  }

  return defaultBodyContentType(request.bodyMode);
}

function bodyModeLabel(mode: RequestRecord["bodyMode"]) {
  switch (mode) {
    case "json":
      return "JSON";
    case "raw":
      return "Raw";
    case "urlencoded":
      return "Form URL Encoded";
    case "multipart":
      return "Multipart Form";
  }
}

function findBlankBodyRow(rows: RequestBodyRow[]) {
  return rows.find((row) => row.key.trim() === "" && row.value.trim() === "");
}

function makeRequestBodyRow(
  requestId: string,
  fieldType: RequestBodyFieldType = "text",
): RequestBodyRow {
  return {
    id: `${requestId}-body-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    key: "",
    value: "",
    enabled: true,
    fieldType,
  };
}

function appendRequestBodyRow(
  requestId: string,
  rows: RequestBodyRow[],
  fieldType: RequestBodyFieldType = "text",
) {
  const nextRow = makeRequestBodyRow(requestId, fieldType);

  return {
    rows: [...rows, nextRow],
    focusRowId: nextRow.id,
  };
}

function removeRequestBodyRow(requestId: string, rows: RequestBodyRow[], id: string) {
  const removedIndex = rows.findIndex((row) => row.id === id);
  const remainingRows = rows.filter((row) => row.id !== id);

  if (remainingRows.length === 0) {
    const fallbackRow = makeRequestBodyRow(requestId);
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

function serializeEditableRequest(request: RequestRecord) {
  return JSON.stringify({
    name: request.name,
    collection: request.collection,
    collectionFile: request.collectionFile,
    method: request.method,
    url: request.url,
    params: sanitizeEditableRows(request.params),
    headers: sanitizeEditableRows(request.headers),
    body: request.body,
    bodyMode: request.bodyMode,
    bodyContentType: request.bodyContentType,
    bodyRows: sanitizeBodyRows(request.bodyRows),
    authType: request.authType,
    authToken: request.authToken,
  });
}

function findBlankRow(rows: KeyValueRow[]) {
  return rows.find((row) => row.key.trim() === "" && row.value.trim() === "");
}

function slugifyCollectionName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "collection";
}

function slugifyEnvironmentName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "environment";
}

function deriveEnvironmentRenamePath(currentSource: string, nextName: string) {
  const trimmedSource = currentSource.trim();
  const fallbackPath = `environments/${slugifyEnvironmentName(nextName)}.json`;
  if (!trimmedSource) {
    return fallbackPath;
  }

  const lastSeparator = Math.max(
    trimmedSource.lastIndexOf("/"),
    trimmedSource.lastIndexOf("\\"),
  );
  const directory =
    lastSeparator >= 0 ? trimmedSource.slice(0, lastSeparator + 1) : "environments/";
  const currentFileName =
    lastSeparator >= 0 ? trimmedSource.slice(lastSeparator + 1) : trimmedSource;
  const extensionMatch = currentFileName.match(/(\.[^.]+)$/);
  const extension = extensionMatch?.[1]?.toLowerCase();
  const safeExtension =
    extension === ".json" || extension === ".yaml" || extension === ".yml"
      ? extension
      : ".json";

  return `${directory}${slugifyEnvironmentName(nextName)}${safeExtension}`;
}

function normalizeStoredRequest(request: PersistedRequest): RequestRecord {
  return {
    id: request.id,
    name: request.name,
    collection: request.collection,
    collectionFile: request.collectionFile,
    method: request.method as RequestMethod,
    url: request.url,
    params: normalizeRows(request.params, `${request.id}-param`),
    headers: normalizeRows(request.headers, `${request.id}-header`),
    body: request.body,
    bodyMode: request.bodyMode,
    bodyContentType: request.bodyContentType,
    bodyRows: normalizeRequestBodyRows(request.bodyRows, request.id),
    authType: request.authType as "none" | "bearer",
    authToken: request.authToken,
  };
}

function makeScratchRequest(): RequestRecord {
  return {
    id: "scratch-request",
    name: "Untitled Request",
    collection: "Unfiled",
    collectionFile: "collections/unfiled.json",
    method: "GET",
    url: "",
    params: [],
    headers: [],
    body: "",
    bodyMode: "raw",
    bodyContentType: "",
    bodyRows: [],
    authType: "none",
    authToken: "",
  };
}

function makeUniqueEnvironmentName(baseName: string, environments: Array<{ name: string }>) {
  const existingNames = new Set(environments.map((environment) => environment.name));
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let index = 2;
  let nextName = `${baseName} ${index}`;
  while (existingNames.has(nextName)) {
    index += 1;
    nextName = `${baseName} ${index}`;
  }

  return nextName;
}

function serializeEnvironment(environment: {
  name: string;
  source: string;
  vars: Array<{ key: string; value: string }>;
}) {
  return JSON.stringify({
    name: environment.name,
    source: environment.source,
    vars: environment.vars
      .filter((row) => row.key.trim() !== "" || row.value.trim() !== "")
      .map((row) => ({
        key: row.key,
        value: row.value,
      })),
  });
}

function normalizeEnvironmentVars(
  rows: Array<{ key: string; value: string }>,
  prefix: string,
) {
  return rows.map((row, index) => ({
    id: `${prefix}-env-${index + 1}-${row.key || "var"}`,
    key: row.key,
    value: row.value,
  }));
}

function normalizeEnvironmentRecord(
  environment: {
    name: string;
    source: string;
    vars: Array<{ key: string; value: string }>;
  },
  environmentId: string,
): EnvironmentRecord {
  return {
    id: environmentId,
    name: environment.name,
    source: environment.source,
    vars: normalizeEnvironmentVars(environment.vars, environmentId),
  };
}

function mergeCollectionDescriptors(
  persistedCollections: CollectionDescriptor[],
  requests: RequestRecord[],
) {
  const merged = new Map<string, CollectionDescriptor>();

  for (const collection of persistedCollections) {
    merged.set(collection.filePath, collection);
  }

  for (const request of requests) {
    if (request.id === "scratch-request") {
      continue;
    }

    if (!merged.has(request.collectionFile)) {
      merged.set(request.collectionFile, {
        name: request.collection,
        filePath: request.collectionFile,
      });
    }
  }

  return Array.from(merged.values());
}

function makeUniqueRequestName(baseName: string, requests: RequestRecord[]) {
  const existingNames = new Set(requests.map((request) => request.name));
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let index = 2;
  let nextName = `${baseName} ${index}`;
  while (existingNames.has(nextName)) {
    index += 1;
    nextName = `${baseName} ${index}`;
  }

  return nextName;
}

function buildDraftRequest(
  requests: RequestRecord[],
  input: {
    collection: string;
    collectionFile: string;
    name?: string;
    source?: RequestRecord;
  },
): RequestRecord {
  const nextId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const defaultName = input.name?.trim() || "Untitled Request";
  const source = input.source;

  return {
    id: nextId,
    name: makeUniqueRequestName(defaultName, requests),
    collection: input.collection,
    collectionFile: input.collectionFile,
    method: source?.method ?? "GET",
    url: source?.url ?? "",
    params: (source?.params ?? []).map((row, index) => ({
      ...row,
      id: `${nextId}-param-${index + 1}`,
    })),
    headers: (source?.headers ?? []).map((row, index) => ({
      ...row,
      id: `${nextId}-header-${index + 1}`,
    })),
    body: source?.body ?? "",
    bodyMode: source?.bodyMode ?? "raw",
    bodyContentType: source?.bodyContentType ?? "",
    bodyRows: (source?.bodyRows ?? []).map((row, index) => ({
      ...row,
      id: `${nextId}-body-${index + 1}`,
    })),
    authType: source?.authType ?? "none",
    authToken: source?.authToken ?? "",
  };
}

function replaceCollectionRequests(
  allRequests: RequestRecord[],
  collectionFile: string,
  nextCollectionRequests: RequestRecord[],
) {
  return [
    ...allRequests.filter((request) => request.collectionFile !== collectionFile),
    ...nextCollectionRequests,
  ];
}

export default function App() {
  const {
    activeSidebarPanel,
    requestTab,
    responseTab,
    setActiveSidebarPanel,
    setRequestTab,
    setResponseTab,
  } = useUiStore();
  const {
    requests,
    environments,
    history,
    activeRequestId,
    activeEnvironmentId,
    activeHistoryId,
    response,
    bootstrap,
    isSending,
    lastError,
    setActiveRequest,
    setActiveEnvironment,
    setActiveHistory,
    updateEnvironmentVar,
    addEnvironmentVar,
    removeEnvironmentVar,
    upsertEnvironment,
    replaceEnvironment,
    replaceRequest,
    upsertRequestFromHistory,
    upsertRequests,
    upsertSecretStatus,
    applyBootstrap,
    updateRequestMethod,
    updateRequestUrl,
    updateRequestBody,
    updateAuthType,
    updateAuthToken,
    updateParamRow,
    updateHeaderRow,
    toggleParamRow,
    toggleHeaderRow,
    addParamRow,
    addHeaderRow,
    removeParamRow,
    removeHeaderRow,
    sendActiveRequest,
  } = useRequestStore();
  const [isSavingRequest, setIsSavingRequest] = useState(false);
  const [isSavingEnvironment, setIsSavingEnvironment] = useState(false);
  const [isSavingSecret, setIsSavingSecret] = useState<string | null>(null);
  const [environmentSaveFeedback, setEnvironmentSaveFeedback] = useState<{
    tone: "success" | "error";
    message: string;
    signature: string;
  } | null>(null);
  const [savedEnvironmentSignatures, setSavedEnvironmentSignatures] = useState<
    Record<string, string>
  >(() =>
    Object.fromEntries(
      environments.map((environment) => [environment.id, serializeEnvironment(environment)]),
    ),
  );
  const [environmentActionMode, setEnvironmentActionMode] = useState<EnvironmentActionMode>(null);
  const [environmentActionValue, setEnvironmentActionValue] = useState("");
  const [environmentActionMessage, setEnvironmentActionMessage] = useState("");
  const [pendingEnvironmentFocus, setPendingEnvironmentFocus] = useState("");
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [expandedCollections, setExpandedCollections] = useState<Record<string, boolean>>({});
  const [bridgeEvents, setBridgeEvents] = useState<BridgeEvent[]>([]);
  const [isBridgeListenerReady, setIsBridgeListenerReady] = useState(false);
  const [isCurlPanelOpen, setIsCurlPanelOpen] = useState(false);
  const [curlInput, setCurlInput] = useState(
    "curl -X GET 'https://api.example.com/v1/workspaces?page=1' -H 'Accept: application/json'",
  );
  const [curlOutput, setCurlOutput] = useState("");
  const [curlMessage, setCurlMessage] = useState("");
  const [isPostmanPanelOpen, setIsPostmanPanelOpen] = useState(false);
  const [postmanInput, setPostmanInput] = useState(`{
  "info": { "name": "Imported API" },
  "item": [
    {
      "name": "GET /health",
      "request": {
        "method": "GET",
        "url": "https://api.example.com/v1/health",
        "header": [
          { "key": "Accept", "value": "application/json" }
        ]
      }
    }
  ]
}`);
  const [postmanMessage, setPostmanMessage] = useState("");
  const [isTransferPanelOpen, setIsTransferPanelOpen] = useState(false);
  const [uploadPath, setUploadPath] = useState("/tmp/api-client-upload.txt");
  const [uploadFieldName, setUploadFieldName] = useState("file");
  const [downloadUrl, setDownloadUrl] = useState("{{base_url}}/v1/files/report.json");
  const [downloadPath, setDownloadPath] = useState("/tmp/api-client-download.json");
  const [allowDownloadOverwrite, setAllowDownloadOverwrite] = useState(false);
  const [transferMessage, setTransferMessage] = useState("");
  const [explorerSearch, setExplorerSearch] = useState("");
  const [collectionsCatalog, setCollectionsCatalog] = useState<CollectionDescriptor[]>(() =>
    mergeCollectionDescriptors([], requests),
  );
  const [activeCollectionFile, setActiveCollectionFile] = useState<string>("");
  const [collectionActionMode, setCollectionActionMode] = useState<CollectionActionMode>(null);
  const [collectionActionValue, setCollectionActionValue] = useState("");
  const [collectionActionMessage, setCollectionActionMessage] = useState("");
  const [isMutatingCollections, setIsMutatingCollections] = useState(false);
  const [savedRequestSignatures, setSavedRequestSignatures] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      requests.map((request) => [request.id, serializeEditableRequest(request)]),
    ),
  );
  const [requestSaveFeedback, setRequestSaveFeedback] = useState<{
    tone: "success" | "error";
    message: string;
    requestId: string;
    signature: string;
  } | null>(null);
  const [pendingEditorFocus, setPendingEditorFocus] = useState<{
    tab: "params" | "headers" | "body";
    rowId: string;
  } | null>(null);
  const environmentAutosaveTimerRef = useRef<number | null>(null);
  const rowInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const environmentInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const displayRequests = requests.filter((request) => request.id !== "scratch-request");
  const displayEnvironments = environments.filter(
    (environment) => environment.id !== "scratch-environment",
  );
  const hasCollections = collectionsCatalog.length > 0;
  const hasEnvironments = displayEnvironments.length > 0;
  const hasHistory = history.length > 0;

  const activeRequest =
    requests.find((request) => request.id === activeRequestId) ?? requests[0] ?? makeScratchRequest();
  const activeCollection =
    collectionsCatalog.find((collection) => collection.filePath === activeCollectionFile) ??
    collectionsCatalog.find((collection) => collection.filePath === activeRequest.collectionFile) ??
    collectionsCatalog[0] ??
    null;
  const activeCollectionRequests = activeCollection
    ? displayRequests.filter((request) => request.collectionFile === activeCollection.filePath)
    : [];
  const hasActiveCollectionRequests = activeCollectionRequests.length > 0;
  const activeCollectionRequest =
    activeCollectionRequests.find((request) => request.id === activeRequestId) ??
    activeCollectionRequests[0] ??
    null;
  const activeEnvironment =
    environments.find((environment) => environment.id === activeEnvironmentId) ??
    environments[0];
  const activePanelMeta =
    sidebarPanels.find((panel) => panel.key === activeSidebarPanel) ?? sidebarPanels[0];
  const activeBaseUrl =
    activeEnvironment.vars.find((item) => item.key === "base_url")?.value ?? "n/a";
  const activeCookieJar =
    activeEnvironment.vars.find((item) => item.key === "cookie_jar")?.value ?? "default";
  const activeProxy =
    activeEnvironment.vars.find((item) => item.key === "proxy")?.value ?? "system";
  const activeEnvironmentSignature = serializeEnvironment(activeEnvironment);
  const environmentBaselineSignature = savedEnvironmentSignatures[activeEnvironment.id] ?? "";
  const environmentDirty = hasEnvironments
    ? activeEnvironmentSignature !== environmentBaselineSignature
    : false;
  const collectionSections = Array.from(
    collectionsCatalog
      .map((collection) => {
        const pathParts = collection.filePath.split("/");
        const subtitle = pathParts[pathParts.length - 1] ?? collection.filePath;

        return {
          title: collection.name,
          subtitle,
          filePath: collection.filePath,
          requests: displayRequests.filter((request) => request.collectionFile === collection.filePath),
        };
      })
      .values(),
  );
  const explorerContext =
    activeSidebarPanel === "collections"
        ? {
            eyebrow: "Workspace",
          title: bootstrap.recentWorkspace || "default-workspace",
          subtitle: activeCollection?.name ?? "No collections yet",
          metrics: [
            { label: "Groups", value: String(collectionSections.length) },
            { label: "Method", value: activeCollectionRequest?.method ?? "n/a" },
          ],
        }
      : activeSidebarPanel === "history"
        ? {
            eyebrow: "Recent",
            title: history[0]?.title || "No recent requests",
            subtitle: history[0]?.meta || "No recent sessions captured yet.",
            metrics: [
              {
                label: "Selected",
                value: hasActiveCollectionRequests ? activeCollectionRequest?.method ?? "n/a" : "n/a",
              },
              { label: "Sessions", value: String(history.length) },
            ],
          }
        : activeSidebarPanel === "environments"
          ? {
              eyebrow: "Environment",
              title: hasEnvironments ? activeEnvironment.name : "No environments yet",
              subtitle: hasEnvironments
                ? activeEnvironment.source
                : "Create your first local environment to start templating requests.",
              metrics: [
                { label: "Vars", value: String(hasEnvironments ? activeEnvironment.vars.length : 0) },
                { label: "Proxy", value: activeProxy },
              ],
            }
          : {
              eyebrow: "Runtime",
              title: bootstrap.loaded ? "Desktop runtime connected" : "Browser preview runtime",
              subtitle:
                bootstrap.appDataDir ||
                "Runtime-specific directories and bridge activity appear here once Tauri is active.",
              metrics: [
                { label: "Bridge", value: isBridgeListenerReady ? "Ready" : "Booting" },
                { label: "Secrets", value: String(bootstrap.secrets.length) },
              ],
            };
  const normalizedExplorerSearch = explorerSearch.trim().toLowerCase();
  const isExplorerFiltering = normalizedExplorerSearch.length > 0;
  const filteredCollectionSections =
    !isExplorerFiltering
      ? collectionSections
      : collectionSections
          .map((section) => {
            const collectionSearchTarget = [
              section.title,
              section.subtitle,
              section.group,
              section.filePath,
            ]
              .join(" ")
              .toLowerCase();
            if (collectionSearchTarget.includes(normalizedExplorerSearch)) {
              return section;
            }

            return {
              ...section,
              requests: section.requests.filter((request) => {
                const searchTarget = [
                  section.title,
                  section.subtitle,
                  section.group,
                  section.filePath,
                  request.name,
                  request.method,
                  request.url,
                  safePathname(request.url),
                ]
                  .join(" ")
                  .toLowerCase();
                return searchTarget.includes(normalizedExplorerSearch);
              }),
            };
          })
          .filter(
            (section) =>
              section.requests.length > 0 ||
              [section.title, section.subtitle, section.group, section.filePath]
                .join(" ")
                .toLowerCase()
                .includes(normalizedExplorerSearch),
          );
  const filteredHistory =
    !isExplorerFiltering
      ? history
      : history.filter((item) =>
          [
            item.title,
            item.meta,
            item.method,
            item.url,
            safePathname(item.url),
            item.status,
            item.requestName,
            item.collection,
            item.environment.name,
            item.environment.source,
            item.createdAt,
            ...item.params.flatMap((row) => [row.key, row.value, row.description]),
            ...item.headers.flatMap((row) => [row.key, row.value, row.description]),
            ...item.environment.vars.flatMap((row) => [row.key, row.value]),
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedExplorerSearch),
        );
  const filteredEnvironments =
    !isExplorerFiltering
      ? displayEnvironments
      : displayEnvironments.filter((environment) =>
          [
            environment.name,
            environment.source,
            ...environment.vars.flatMap((row) => [row.key, row.value]),
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedExplorerSearch),
        );
  const explorerListEmpty =
    activeSidebarPanel === "collections"
      ? filteredCollectionSections.length === 0
      : activeSidebarPanel === "history"
        ? filteredHistory.length === 0
        : activeSidebarPanel === "environments"
          ? filteredEnvironments.length === 0
          : false;
  const explorerEmptyMessage =
    activeSidebarPanel === "collections"
      ? "No matching requests or collections."
      : activeSidebarPanel === "history"
        ? "No matching history entries."
        : "No matching environments or variables.";
  const visibleHistory = activeSidebarPanel === "history" ? filteredHistory : history;
  const historyPanelEmptyMessage = isExplorerFiltering
    ? "No matching history entries."
    : "Send a request to start building a replayable request history.";
  const visibleCollectionItemCount = filteredCollectionSections.reduce(
    (count, section) => count + section.requests.length,
    0,
  );
  const sidebarItemCount =
    activeSidebarPanel === "collections"
      ? visibleCollectionItemCount
      : activeSidebarPanel === "history"
        ? filteredHistory.length
        : activeSidebarPanel === "environments"
          ? filteredEnvironments.length
          : 3;
  const explorerSummaryLabel =
    activeSidebarPanel === "collections"
      ? "requests"
      : activeSidebarPanel === "history"
        ? "sessions"
        : activeSidebarPanel === "environments"
          ? "environments"
          : "runtime";
  const explorerSummaryValue =
    activeSidebarPanel === "collections"
      ? String(visibleCollectionItemCount)
      : activeSidebarPanel === "history"
        ? String(filteredHistory.length)
        : activeSidebarPanel === "environments"
          ? String(filteredEnvironments.length)
          : bootstrap.loaded
            ? "Live"
            : "Seed";
  const activeRequestSignature = serializeEditableRequest(activeRequest);
  const requestBaselineSignature = savedRequestSignatures[activeRequest.id] ?? "";
  const requestDirty = activeRequestSignature !== requestBaselineSignature;
  const visibleParamRows = sanitizeEditableRows(activeRequest.params).length;
  const visibleHeaderRows = sanitizeEditableRows(activeRequest.headers).length;
  const visibleBodyRows = sanitizeBodyRows(activeRequest.bodyRows).length;
  const isStructuredBody = isStructuredBodyMode(activeRequest.bodyMode);
  const requestStatus =
    isSavingRequest
      ? { tone: "pending" as const, message: "Saving changes" }
      : requestSaveFeedback
        ? { tone: requestSaveFeedback.tone, message: requestSaveFeedback.message }
        : requestDirty
          ? { tone: "dirty" as const, message: "Unsaved changes" }
          : { tone: "saved" as const, message: "All changes saved" };
  const environmentStatus =
    isSavingEnvironment
      ? { tone: "pending" as const, message: "Saving environment" }
      : environmentSaveFeedback
        ? { tone: environmentSaveFeedback.tone, message: environmentSaveFeedback.message }
        : environmentDirty
          ? { tone: "dirty" as const, message: "Unsaved environment changes" }
          : { tone: "saved" as const, message: "Environment saved" };

  const collectionActionTitle =
    collectionActionMode === "create-collection"
      ? "Create Collection"
      : collectionActionMode === "rename-collection"
        ? "Rename Collection"
        : collectionActionMode === "delete-collection"
          ? "Delete Collection"
          : collectionActionMode === "rename-request"
            ? "Rename Request"
            : collectionActionMode === "delete-request"
              ? "Delete Request"
              : collectionActionMode === "move-request"
                ? "Move Request"
              : "";
  const environmentActionTitle =
    environmentActionMode === "create-environment"
      ? "Create Environment"
      : environmentActionMode === "rename-environment"
        ? "Rename Environment"
        : environmentActionMode === "delete-environment"
          ? "Delete Environment"
          : "";

  useEffect(() => {
    const missingTitles = collectionsCatalog
      .map((collection) => collection.name)
      .filter((title) => !(title in expandedCollections));

    if (missingTitles.length === 0) {
      return;
    }

    setExpandedCollections((current) => {
      const next = { ...current };
      for (const title of missingTitles) {
        next[title] = true;
      }
      return next;
    });
  }, [collectionsCatalog, expandedCollections]);

  useEffect(() => {
    if (!bootstrap.loaded) {
      return;
    }

    setSavedRequestSignatures(
      Object.fromEntries(
        requests.map((request) => [request.id, serializeEditableRequest(request)]),
      ),
    );
    setSavedEnvironmentSignatures(
      Object.fromEntries(
        environments.map((environment) => [environment.id, serializeEnvironment(environment)]),
      ),
    );
  }, [bootstrap.loaded]);

  useEffect(() => {
    setCollectionsCatalog((current) => mergeCollectionDescriptors(current, requests));
  }, [requests]);

  useEffect(() => {
    if (!activeCollectionFile && collectionsCatalog[0]) {
      const preferredCollectionFile = collectionsCatalog.some(
        (collection) => collection.filePath === activeRequest.collectionFile,
      )
        ? activeRequest.collectionFile
        : collectionsCatalog[0].filePath;
      setActiveCollectionFile(preferredCollectionFile);
      return;
    }

    if (
      activeCollectionFile &&
      !collectionsCatalog.some((collection) => collection.filePath === activeCollectionFile)
    ) {
      setActiveCollectionFile(collectionsCatalog[0]?.filePath ?? "");
    }
  }, [activeCollectionFile, collectionsCatalog]);

  useEffect(() => {
    if (activeSidebarPanel === "collections") {
      return;
    }

    if (
      activeRequest.collectionFile &&
      activeRequest.id !== "scratch-request" &&
      collectionsCatalog.some((collection) => collection.filePath === activeRequest.collectionFile) &&
      activeCollectionFile !== activeRequest.collectionFile
    ) {
      setActiveCollectionFile(activeRequest.collectionFile);
    }
  }, [
    activeSidebarPanel,
    activeCollectionFile,
    activeRequest.collectionFile,
    activeRequest.id,
    collectionsCatalog,
  ]);

  useEffect(() => {
    if (activeSidebarPanel !== "collections") {
      return;
    }

    if (activeCollectionRequest && activeCollectionRequest.id !== activeRequestId) {
      setActiveRequest(activeCollectionRequest.id);
    }
  }, [activeCollectionRequest, activeRequestId, activeSidebarPanel, setActiveRequest]);

  useEffect(() => {
    if (
      requestSaveFeedback &&
      (requestSaveFeedback.requestId !== activeRequest.id ||
        requestSaveFeedback.signature !== activeRequestSignature)
    ) {
      setRequestSaveFeedback(null);
    }
  }, [activeRequest.id, activeRequestSignature, requestSaveFeedback]);

  useEffect(() => {
    if (
      environmentSaveFeedback &&
      activeEnvironment.id &&
      environmentSaveFeedback.signature !== activeEnvironmentSignature
    ) {
      setEnvironmentSaveFeedback(null);
    }
  }, [
    activeEnvironment.id,
    activeEnvironmentSignature,
    environmentSaveFeedback,
  ]);

  useEffect(() => {
    if (!pendingEnvironmentFocus) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const input = environmentInputRefs.current[pendingEnvironmentFocus];
      input?.focus();
      input?.select();
      setPendingEnvironmentFocus("");
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [pendingEnvironmentFocus, activeEnvironment.vars]);

  useEffect(() => {
    if (!pendingEditorFocus || requestTab !== pendingEditorFocus.tab) {
      return;
    }

    const focusKey = `${pendingEditorFocus.tab}:${pendingEditorFocus.rowId}`;
    const frame = window.requestAnimationFrame(() => {
      const input = rowInputRefs.current[focusKey];
      input?.focus();
      input?.select();
      setPendingEditorFocus(null);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    activeRequest.bodyRows,
    activeRequest.headers,
    activeRequest.id,
    activeRequest.params,
    pendingEditorFocus,
    requestTab,
  ]);

  useEffect(() => {
    if (requestTab === "params" && activeRequest.params.length === 0) {
      focusEditorRow("params", addParamRow());
      return;
    }

    if (requestTab === "headers" && activeRequest.headers.length === 0) {
      focusEditorRow("headers", addHeaderRow());
      return;
    }

    if (
      requestTab === "body" &&
      isStructuredBodyMode(activeRequest.bodyMode) &&
      activeRequest.bodyRows.length === 0
    ) {
      const next = appendRequestBodyRow(activeRequest.id, []);
      replaceRequest({
        ...activeRequest,
        bodyRows: next.rows,
      });
      focusEditorRow("body", next.focusRowId);
    }
  }, [
    activeRequest.bodyMode,
    activeRequest.bodyRows.length,
    activeRequest.headers.length,
    activeRequest.id,
    activeRequest.params.length,
    addHeaderRow,
    addParamRow,
    replaceRequest,
    requestTab,
  ]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listenBridgeEvents((event) => {
      if (cancelled) {
        return;
      }

      setBridgeEvents((current) => [event, ...current].slice(0, 8));
    })
      .then((unsubscribe) => {
        if (cancelled) {
          unsubscribe();
          return;
        }

        unlisten = unsubscribe;
        setIsBridgeListenerReady(true);
      })
      .catch(() => {
        // Event listening is only available inside the Tauri runtime.
        if (!cancelled) {
          setIsBridgeListenerReady(true);
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isBridgeListenerReady) {
      return;
    }

    let cancelled = false;

    void loadBootstrapState()
      .then((state) => {
        if (cancelled) {
          return;
        }

        const requestCatalog = useRequestStore.getState().requests;
        const environmentCatalog = useRequestStore.getState().environments;

        applyBootstrap({
          appDataDir: state.paths.appDataDir,
          databasePath: state.paths.databasePath,
          environmentsDir: state.paths.environmentsDir,
          cacheDir: state.paths.cacheDir,
          logsDir: state.paths.logsDir,
          recentWorkspace: state.settings.recentWorkspace,
          runtime: state.runtime,
          history: state.history.map((item) => ({
            id: `history-db-${item.id}`,
            title: `${item.method} ${safePathname(item.url)}`,
            meta: `${item.status} / ${item.durationMs}ms / ${item.createdAt}`,
            requestId: resolveHistoryRequestId(item, requestCatalog),
            method: item.method.toUpperCase() as RequestMethod,
            url: item.url,
            status: item.status,
            durationMs: item.durationMs,
            createdAt: item.createdAt,
            requestName: item.requestName || `${item.method} ${safePathname(item.url)}`,
            collection: item.collection || "History",
            params: normalizeRows(item.params, `history-${item.id}-param`),
            headers: normalizeRows(item.headers, `history-${item.id}-header`),
            body: item.body,
            bodyMode: item.bodyMode,
            bodyContentType: item.bodyContentType,
            bodyRows: normalizeRequestBodyRows(item.bodyRows, `history-${item.id}`),
            authType: (item.authType === "bearer" ? "bearer" : "none") as "none" | "bearer",
            authToken: item.authToken,
            environment: (() => {
              const fallbackEnvironment = environmentCatalog.find(
                (environment) =>
                  environment.name === item.environmentName ||
                  environment.source === item.environmentSource,
              );

              return {
                id: `history-env-${item.id}`,
                name: item.environmentName || fallbackEnvironment?.name || "Recovered Environment",
                source:
                  item.environmentSource ||
                  fallbackEnvironment?.source ||
                  "history/environment.json",
                vars: normalizeEnvironmentVars(
                  item.environmentVars.length > 0
                    ? item.environmentVars
                    : (fallbackEnvironment?.vars ?? []).map((row) => ({
                        key: row.key,
                        value: row.value,
                      })),
                  `history-env-${item.id}`,
                ),
              };
            })(),
          })),
          collections: state.collections.flatMap((collection) =>
            collection.requests.map((request) => ({
              id: request.id,
              name: request.name,
              collection: request.collection,
              collectionFile: request.collectionFile,
              method: request.method as RequestMethod,
              url: request.url,
              params: normalizeRows(request.params, `${request.id}-param`),
              headers: normalizeRows(request.headers, `${request.id}-header`),
              body: request.body,
              bodyMode: request.bodyMode,
              bodyContentType: request.bodyContentType,
              bodyRows: normalizeRequestBodyRows(request.bodyRows, request.id),
              authType: request.authType as "none" | "bearer",
              authToken: request.authToken,
            })),
          ),
          environments: state.environments.map((item, index) => ({
            id: `env-db-${index}`,
            name: item.name,
            source: item.filePath,
            vars: normalizeEnvironmentVars(item.vars, `env-db-${index}`),
          })),
          secrets: state.secrets,
        });
        setCollectionsCatalog(
          state.collections.map((collection) => ({
            name: collection.name,
            filePath: collection.filePath,
          })),
        );
      })
      .catch(() => {
        // Seeded frontend state remains available outside Tauri runtime.
      });

    return () => {
      cancelled = true;
    };
  }, [applyBootstrap, isBridgeListenerReady]);

  const toggleCollection = (title: string) => {
    setExpandedCollections((current) => ({
      ...current,
      [title]: !current[title],
    }));
  };
  const workspaceMode = activeSidebarPanel;
  const handleSidebarPanelChange = (panel: (typeof sidebarPanels)[number]["key"]) => {
    setActiveSidebarPanel(panel);
    setExplorerSearch("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSaveEnvironment = async (environmentOverride?: EnvironmentRecord) => {
    const environmentToSave = environmentOverride ?? activeEnvironment;
    if (
      environmentToSave.id === "scratch-environment" ||
      environmentToSave.source.trim() === ""
    ) {
      return;
    }

    setIsSavingEnvironment(true);
    setEnvironmentSaveFeedback(null);
    try {
      const saved = await saveEnvironment({
        name: environmentToSave.name,
        filePath: environmentToSave.source,
        vars: environmentToSave.vars
          .filter((row) => row.key.trim() !== "" || row.value.trim() !== "")
          .map((row) => ({
            key: row.key,
            value: row.value,
          })),
      });

      const normalizedEnvironment = normalizeEnvironmentRecord(
        {
          name: saved.name,
          source: saved.filePath,
          vars: saved.vars,
        },
        environmentToSave.id,
      );
      replaceEnvironment(normalizedEnvironment);
      const signature = serializeEnvironment(normalizedEnvironment);
      setSavedEnvironmentSignatures((current) => ({
        ...current,
        [normalizedEnvironment.id]: signature,
      }));
      setEnvironmentSaveFeedback({
        tone: "success",
        message: "Environment saved to local storage",
        signature,
      });
    } catch (error) {
      setEnvironmentSaveFeedback({
        tone: "error",
        message: commandErrorMessage(error, "Save environment"),
        signature: serializeEnvironment(environmentToSave),
      });
    } finally {
      setIsSavingEnvironment(false);
    }
  };

  const scheduleEnvironmentAutosave = () => {
    if (!bootstrap.settings.autoSave || !hasEnvironments) {
      return;
    }

    const environmentId = activeEnvironment.id;

    if (environmentAutosaveTimerRef.current !== null) {
      window.clearTimeout(environmentAutosaveTimerRef.current);
    }

    environmentAutosaveTimerRef.current = window.setTimeout(() => {
      environmentAutosaveTimerRef.current = null;
      const latestEnvironment = useRequestStore
        .getState()
        .environments.find((environment) => environment.id === environmentId);
      if (
        !latestEnvironment ||
        latestEnvironment.id === "scratch-environment" ||
        latestEnvironment.source.trim() === ""
      ) {
        return;
      }

      const latestSignature = serializeEnvironment(latestEnvironment);
      if (
        environmentSaveFeedback?.tone === "error" &&
        environmentSaveFeedback.signature === latestSignature
      ) {
        return;
      }

      void handleSaveEnvironment(latestEnvironment);
    }, 500);
  };

  const handleCreateFirstEnvironment = async () => {
    openEnvironmentAction("create-environment");
  };

  const buildEnvironmentDraft = (nameOverride?: string) => {
    const existingNames = new Set(displayEnvironments.map((environment) => environment.name));
    const existingSources = new Set(displayEnvironments.map((environment) => environment.source));
    const requestedName = nameOverride?.trim() || "Local Environment";
    const environmentName = makeUniqueEnvironmentName(requestedName, displayEnvironments);

    let fileIndex = 1;
    let fileName = `${slugifyEnvironmentName(environmentName)}.json`;
    let filePath = `environments/${fileName}`;
    while (existingSources.has(filePath)) {
      fileIndex += 1;
      fileName = `${slugifyEnvironmentName(environmentName)}-${fileIndex}.json`;
      filePath = `environments/${fileName}`;
    }

    const draftId = `env-draft-${Date.now()}`;

    return {
      id: draftId,
      name: environmentName,
      source: filePath,
      vars: [
        { id: `${draftId}-env-1-base_url`, key: "base_url", value: "http://localhost:3000" },
        { id: `${draftId}-env-2-proxy`, key: "proxy", value: "system" },
        { id: `${draftId}-env-3-cookie_jar`, key: "cookie_jar", value: "default" },
      ],
    };
  };

  const openEnvironmentAction = (mode: EnvironmentActionMode) => {
    setEnvironmentActionMode(mode);
    setEnvironmentActionMessage("");
    setEnvironmentActionValue(
      mode === "create-environment"
        ? makeUniqueEnvironmentName("Local Environment", displayEnvironments)
        : mode === "rename-environment"
          ? activeEnvironment.name
          : "",
    );
  };

  const handleCreateEnvironment = async () => {
    const draftEnvironment = buildEnvironmentDraft(environmentActionValue);

    setIsSavingEnvironment(true);
    setEnvironmentSaveFeedback(null);
    try {
      const saved = await saveEnvironment({
        name: draftEnvironment.name,
        filePath: draftEnvironment.source,
        vars: draftEnvironment.vars.map((row) => ({
          key: row.key,
          value: row.value,
        })),
      });

      const normalizedEnvironment = normalizeEnvironmentRecord(
        {
          name: saved.name,
          source: saved.filePath,
          vars: saved.vars,
        },
        draftEnvironment.id,
      );

      upsertEnvironment(normalizedEnvironment);
      setSavedEnvironmentSignatures((current) => ({
        ...current,
        [normalizedEnvironment.id]: serializeEnvironment(normalizedEnvironment),
      }));
      setActiveEnvironment(draftEnvironment.id);
      setActiveSidebarPanel("environments");
      setExplorerSearch("");
      setEnvironmentActionMode(null);
      setEnvironmentActionValue("");
      setEnvironmentActionMessage("");
      setEnvironmentSaveFeedback({
        tone: "success",
        message: hasEnvironments ? "Environment created" : "Created your first local environment",
      });
    } catch (error) {
      setEnvironmentActionMessage(commandErrorMessage(error, "Create environment"));
    } finally {
      setIsSavingEnvironment(false);
    }
  };

  const handleRenameEnvironment = async () => {
    if (!hasEnvironments) {
      return;
    }

    setIsSavingEnvironment(true);
    setEnvironmentSaveFeedback(null);
    try {
      const saved = await renameEnvironment({
        currentFilePath: activeEnvironment.source,
        newName: environmentActionValue.trim(),
        newFilePath: deriveEnvironmentRenamePath(
          activeEnvironment.source,
          environmentActionValue,
        ),
      });

      const normalizedEnvironment = normalizeEnvironmentRecord(
        {
          name: saved.name,
          source: saved.filePath,
          vars: saved.vars,
        },
        activeEnvironment.id,
      );

      replaceEnvironment(normalizedEnvironment);
      setSavedEnvironmentSignatures((current) => ({
        ...current,
        [normalizedEnvironment.id]: serializeEnvironment(normalizedEnvironment),
      }));
      setEnvironmentActionMode(null);
      setEnvironmentActionValue("");
      setEnvironmentActionMessage("");
      setEnvironmentSaveFeedback({
        tone: "success",
        message: "Environment renamed",
      });
    } catch (error) {
      setEnvironmentActionMessage(commandErrorMessage(error, "Rename environment"));
    } finally {
      setIsSavingEnvironment(false);
    }
  };

  const handleDeleteEnvironment = async () => {
    if (!hasEnvironments) {
      return;
    }

    const targetEnvironmentId = activeEnvironment.id;
    const targetSource = activeEnvironment.source;

    setIsSavingEnvironment(true);
    setEnvironmentSaveFeedback(null);
    try {
      await deleteEnvironment({
        filePath: targetSource,
      });

      useRequestStore.setState((state) => {
        const nextEnvironments = state.environments.filter(
          (environment) => environment.id !== targetEnvironmentId,
        );
        const fallbackEnvironment = makeScratchEnvironment();

        return {
          environments: nextEnvironments.length > 0 ? nextEnvironments : [fallbackEnvironment],
          activeEnvironmentId: nextEnvironments[0]?.id ?? fallbackEnvironment.id,
        };
      });
      setSavedEnvironmentSignatures((current) => {
        const next = { ...current };
        delete next[targetEnvironmentId];
        return next;
      });

      setEnvironmentActionMode(null);
      setEnvironmentActionValue("");
      setEnvironmentActionMessage("");
      setEnvironmentSaveFeedback({
        tone: "success",
        message: "Environment deleted",
      });
    } catch (error) {
      setEnvironmentActionMessage(commandErrorMessage(error, "Delete environment"));
    } finally {
      setIsSavingEnvironment(false);
    }
  };

  const handleEnvironmentActionSubmit = async () => {
    if (environmentActionMode === "create-environment") {
      if (!environmentActionValue.trim()) {
        setEnvironmentActionMessage("Environment name is required.");
        return;
      }
      await handleCreateEnvironment();
      return;
    }

    if (environmentActionMode === "rename-environment") {
      if (!environmentActionValue.trim()) {
        setEnvironmentActionMessage("Environment name is required.");
        return;
      }
      await handleRenameEnvironment();
      return;
    }

    if (environmentActionMode === "delete-environment") {
      await handleDeleteEnvironment();
    }
  };

  const handleAddEnvironmentVar = () => {
    if (!hasEnvironments) {
      return;
    }

    const nextRowId = addEnvironmentVar(activeEnvironment.id);
    if (nextRowId) {
      setPendingEnvironmentFocus(`${activeEnvironment.id}:${nextRowId}:key`);
    }
  };

  const handleRemoveEnvironmentVar = (rowId: string) => {
    if (!hasEnvironments) {
      return;
    }

    const nextRowId = removeEnvironmentVar(activeEnvironment.id, rowId);
    if (nextRowId) {
      setPendingEnvironmentFocus(`${activeEnvironment.id}:${nextRowId}:key`);
    }
    scheduleEnvironmentAutosave();
  };

  const focusEditorRow = (tab: "params" | "headers" | "body", rowId: string) => {
    if (!rowId) {
      return;
    }

    setPendingEditorFocus({ tab, rowId });
  };

  const handleUpdateBodyContentType = (value: string) => {
    if (!hasCollections) {
      return;
    }

    replaceRequest({
      ...activeRequest,
      bodyContentType: value,
    });
    scheduleRequestAutosave();
  };

  const handleRequestBodyModeChange = (bodyMode: RequestRecord["bodyMode"]) => {
    if (!hasCollections || activeRequest.bodyMode === bodyMode) {
      return;
    }

    const shouldSeedRows = isStructuredBodyMode(bodyMode) && activeRequest.bodyRows.length === 0;
    const seededRows = shouldSeedRows ? [makeRequestBodyRow(activeRequest.id)] : activeRequest.bodyRows;

    replaceRequest({
      ...activeRequest,
      bodyMode,
      bodyRows: seededRows,
    });

    if (shouldSeedRows) {
      focusEditorRow("body", seededRows[0]?.id ?? "");
    }
    scheduleRequestAutosave();
  };

  const handleUpdateBodyRow = (
    rowId: string,
    field: "key" | "value",
    value: string,
  ) => {
    if (!hasCollections) {
      return;
    }

    replaceRequest({
      ...activeRequest,
      bodyRows: activeRequest.bodyRows.map((row) =>
        row.id === rowId ? { ...row, [field]: value } : row,
      ),
    });
    scheduleRequestAutosave();
  };

  const handleUpdateBodyRowFieldType = (
    rowId: string,
    fieldType: RequestBodyFieldType,
  ) => {
    if (!hasCollections) {
      return;
    }

    replaceRequest({
      ...activeRequest,
      bodyRows: activeRequest.bodyRows.map((row) =>
        row.id === rowId ? { ...row, fieldType } : row,
      ),
    });
    scheduleRequestAutosave();
  };

  const handleToggleBodyRow = (rowId: string) => {
    if (!hasCollections) {
      return;
    }

    replaceRequest({
      ...activeRequest,
      bodyRows: activeRequest.bodyRows.map((row) =>
        row.id === rowId ? { ...row, enabled: !row.enabled } : row,
      ),
    });
    scheduleRequestAutosave();
  };

  const handleAddBodyRow = () => {
    if (!hasCollections) {
      return;
    }

    const existingBlankRow = findBlankBodyRow(activeRequest.bodyRows);
    if (existingBlankRow) {
      focusEditorRow("body", existingBlankRow.id);
      return;
    }

    const next = appendRequestBodyRow(activeRequest.id, activeRequest.bodyRows);
    replaceRequest({
      ...activeRequest,
      bodyRows: next.rows,
    });
    focusEditorRow("body", next.focusRowId);
  };

  const handleRemoveBodyRow = (rowId: string) => {
    if (!hasCollections) {
      return;
    }

    const next = removeRequestBodyRow(activeRequest.id, activeRequest.bodyRows, rowId);
    replaceRequest({
      ...activeRequest,
      bodyRows: next.rows,
    });
    focusEditorRow("body", next.focusRowId);
    scheduleRequestAutosave();
  };

  const handleAddParamRow = () => {
    if (!hasCollections) {
      return;
    }

    const existingBlankRow = findBlankRow(activeRequest.params);
    if (existingBlankRow) {
      focusEditorRow("params", existingBlankRow.id);
      return;
    }

    focusEditorRow("params", addParamRow());
  };

  const handleAddHeaderRow = () => {
    if (!hasCollections) {
      return;
    }

    const existingBlankRow = findBlankRow(activeRequest.headers);
    if (existingBlankRow) {
      focusEditorRow("headers", existingBlankRow.id);
      return;
    }

    focusEditorRow("headers", addHeaderRow());
  };

  const handleRemoveParamRow = (rowId: string) => {
    if (!hasCollections) {
      return;
    }

    focusEditorRow("params", removeParamRow(rowId));
    scheduleRequestAutosave();
  };

  const handleRemoveHeaderRow = (rowId: string) => {
    if (!hasCollections) {
      return;
    }

    focusEditorRow("headers", removeHeaderRow(rowId));
    scheduleRequestAutosave();
  };

  const handleRestoreHistory = (historyItem: (typeof history)[number]) => {
    setActiveHistory(historyItem.id);
    const replayRequestId = upsertRequestFromHistory(historyItem);
    setRequestTab("params");
    return replayRequestId;
  };

  const handleResendHistory = async (historyItem: (typeof history)[number]) => {
    handleRestoreHistory(historyItem);
    await Promise.resolve();
    await useRequestStore.getState().sendActiveRequest();
  };

  const handleSaveRequest = async () => {
    if (!hasActiveCollectionRequests) {
      return;
    }

    setIsSavingRequest(true);
    try {
      const params = sanitizeEditableRows(activeRequest.params);
      const headers = sanitizeEditableRows(activeRequest.headers);
      const saved = await saveRequest({
        id: activeRequest.id,
        name: activeRequest.name,
        collection: activeRequest.collection,
        collectionFile: activeRequest.collectionFile,
        method: activeRequest.method,
        url: activeRequest.url,
        params,
        headers,
        body: activeRequest.body,
        bodyMode: activeRequest.bodyMode,
        bodyContentType: activeRequest.bodyContentType,
        bodyRows: sanitizeBodyRows(activeRequest.bodyRows),
        authType: activeRequest.authType,
        authToken: activeRequest.authToken,
      });

      const savedRequest = saved.requests.find((request) => request.id === activeRequest.id);
      if (savedRequest) {
        const normalizedSavedRequest = {
          id: savedRequest.id,
          name: savedRequest.name,
          collection: savedRequest.collection,
          collectionFile: savedRequest.collectionFile,
          method: savedRequest.method as RequestMethod,
          url: savedRequest.url,
          params: normalizeRows(savedRequest.params, `${savedRequest.id}-param`),
          headers: normalizeRows(savedRequest.headers, `${savedRequest.id}-header`),
          body: savedRequest.body,
          bodyMode: savedRequest.bodyMode,
          bodyContentType: savedRequest.bodyContentType,
          bodyRows: normalizeRequestBodyRows(savedRequest.bodyRows, savedRequest.id),
          authType: savedRequest.authType as "none" | "bearer",
          authToken: savedRequest.authToken,
        };

        replaceRequest(normalizedSavedRequest);
        const savedSignature = serializeEditableRequest(normalizedSavedRequest);
        setSavedRequestSignatures((current) => ({
          ...current,
          [normalizedSavedRequest.id]: savedSignature,
        }));
        setRequestSaveFeedback({
          tone: "success",
          message: "Request saved to collection",
          requestId: normalizedSavedRequest.id,
          signature: savedSignature,
        });
      }
    } catch (error) {
      setRequestSaveFeedback({
        tone: "error",
        message: commandErrorMessage(error, "Save request"),
        requestId: activeRequest.id,
        signature: activeRequestSignature,
      });
    } finally {
      setIsSavingRequest(false);
    }
  };

  const persistDraftRequest = async (draft: RequestRecord) => {
    upsertRequests([draft]);
    setSavedRequestSignatures((current) => ({
      ...current,
      [draft.id]: "",
    }));
    setRequestSaveFeedback(null);
    await handleSaveRequest(draft);
  };

  const handleCreateRequest = async () => {
    const draft = buildDraftRequest(requests, {
      collection: activeCollection?.name ?? "Unfiled",
      collectionFile: activeCollection?.filePath ?? "collections/unfiled.json",
    });

    setRequestTab("body");
    await persistDraftRequest(draft);
  };

  const handleCreateCollection = async () => {
    try {
      const collection = await createCollection({
        name: collectionActionValue.trim(),
        filePath: `collections/${slugifyCollectionName(collectionActionValue)}.json`,
      });

      setCollectionsCatalog((current) =>
        mergeCollectionDescriptors(
          [...current, { name: collection.name, filePath: collection.filePath }],
          [
          ...requests,
          ...collection.requests.map((request) => normalizeStoredRequest(request)),
          ],
        ),
      );
      setActiveCollectionFile(collection.filePath);
      setExpandedCollections((current) => ({
        ...current,
        [collection.name]: true,
      }));
      setCollectionActionMessage("Collection created");
      setCollectionActionMode(null);
      setCollectionActionValue("");
    } catch (error) {
      setCollectionActionMessage(commandErrorMessage(error, "Create collection"));
    }
  };

  const handleDuplicateRequest = async () => {
    if (!hasActiveCollectionRequests) {
      return;
    }

    const duplicate = buildDraftRequest(requests, {
      collection: activeRequest.collection,
      collectionFile: activeRequest.collectionFile,
      name: `${activeRequest.name} copy`,
      source: activeRequest,
    });

    await persistDraftRequest(duplicate);
  };

  const handleRenameRequest = async () => {
    if (!hasActiveCollectionRequests) {
      return;
    }

    const renamedRequest = {
      ...activeRequest,
      name: collectionActionValue.trim(),
    };
    replaceRequest(renamedRequest);
    setRequestSaveFeedback(null);

    try {
      const saved = await saveRequest({
        id: renamedRequest.id,
        name: renamedRequest.name,
        collection: renamedRequest.collection,
        collectionFile: renamedRequest.collectionFile,
        method: renamedRequest.method,
        url: renamedRequest.url,
        params: sanitizeEditableRows(renamedRequest.params),
        headers: sanitizeEditableRows(renamedRequest.headers),
        body: renamedRequest.body,
        bodyMode: renamedRequest.bodyMode,
        bodyContentType: renamedRequest.bodyContentType,
        bodyRows: sanitizeBodyRows(renamedRequest.bodyRows),
        authType: renamedRequest.authType,
        authToken: renamedRequest.authToken,
      });

      const persisted = saved.requests.find((request) => request.id === renamedRequest.id);
      if (!persisted) {
        return;
      }

      const normalized = normalizeStoredRequest(persisted);
      replaceRequest(normalized);
      const savedSignature = serializeEditableRequest(normalized);
      setSavedRequestSignatures((current) => ({
        ...current,
        [normalized.id]: savedSignature,
      }));
      setRequestSaveFeedback({
        tone: "success",
        message: "Request renamed",
        requestId: normalized.id,
        signature: savedSignature,
      });
      setCollectionActionMode(null);
      setCollectionActionValue("");
      setCollectionActionMessage("");
    } catch (error) {
      setCollectionActionMessage(commandErrorMessage(error, "Rename request"));
    }
  };

  const handleDeleteRequest = async () => {
    if (!hasActiveCollectionRequests) {
      return;
    }

    const targetRequestId = activeRequest.id;
    const targetCollectionFile = activeRequest.collectionFile;

    try {
      const collection = await deleteRequest({
        requestId: targetRequestId,
        collectionFile: targetCollectionFile,
      });

      const remainingRequests = collection.requests.map((request) => normalizeStoredRequest(request));
      useRequestStore.setState((state) => {
        const nextRequests = [
          ...state.requests.filter((request) => request.collectionFile !== targetCollectionFile),
          ...remainingRequests,
        ];
        const fallbackRequest = makeScratchRequest();

        return {
          requests: nextRequests.length > 0 ? nextRequests : [fallbackRequest],
          activeRequestId: nextRequests[0]?.id ?? fallbackRequest.id,
        };
      });

      setSavedRequestSignatures((current) => {
        const next = { ...current };
        delete next[targetRequestId];
        for (const request of remainingRequests) {
          next[request.id] = serializeEditableRequest(request);
        }
        return next;
      });
      setActiveCollectionFile(targetCollectionFile);
      setRequestSaveFeedback(null);
      setCollectionActionMode(null);
      setCollectionActionValue("");
      setCollectionActionMessage("");
    } catch (error) {
      setCollectionActionMessage(commandErrorMessage(error, "Delete request"));
    }
  };

  const handleRenameCollection = async () => {
    if (!activeCollection) {
      return;
    }

    try {
      const collection = await renameCollection({
        currentFilePath: activeCollection.filePath,
        newName: collectionActionValue.trim(),
        newFilePath: `collections/${slugifyCollectionName(collectionActionValue)}.json`,
      });

      const normalizedRequests = collection.requests.map((request) => normalizeStoredRequest(request));
      useRequestStore.setState((state) => ({
        requests: [
          ...state.requests.filter((request) => request.collectionFile !== activeCollection.filePath),
          ...normalizedRequests,
        ],
      }));
      setCollectionsCatalog((current) =>
        current.map((item) =>
          item.filePath === activeCollection.filePath
            ? { name: collection.name, filePath: collection.filePath }
            : item,
        ),
      );
      setActiveCollectionFile(collection.filePath);
      setSavedRequestSignatures((current) => {
        const next = { ...current };
        for (const request of normalizedRequests) {
          next[request.id] = serializeEditableRequest(request);
        }
        return next;
      });
      setRequestSaveFeedback(null);
      setCollectionActionMode(null);
      setCollectionActionValue("");
      setCollectionActionMessage("");
    } catch (error) {
      setCollectionActionMessage(commandErrorMessage(error, "Rename collection"));
    }
  };

  const handleDeleteCollection = async () => {
    if (!activeCollection) {
      return;
    }

    const targetCollectionFile = activeCollection.filePath;

    try {
      await deleteCollection({
        filePath: targetCollectionFile,
      });

      setCollectionsCatalog((current) =>
        current.filter((collection) => collection.filePath !== targetCollectionFile),
      );
      useRequestStore.setState((state) => {
        const nextRequests = state.requests.filter(
          (request) => request.collectionFile !== targetCollectionFile,
        );
        const fallbackRequest = makeScratchRequest();

        return {
          requests: nextRequests.length > 0 ? nextRequests : [fallbackRequest],
          activeRequestId: nextRequests[0]?.id ?? fallbackRequest.id,
        };
      });

      setSavedRequestSignatures((current) => {
        const next = { ...current };
        for (const request of requests) {
          if (request.collectionFile === targetCollectionFile) {
            delete next[request.id];
          }
        }
        return next;
      });
      setRequestSaveFeedback(null);
      setCollectionActionMode(null);
      setCollectionActionValue("");
      setCollectionActionMessage("");
    } catch (error) {
      setCollectionActionMessage(commandErrorMessage(error, "Delete collection"));
    }
  };

  const handleMoveCollection = async (direction: "up" | "down") => {
    if (!activeCollection) {
      return;
    }

    const currentIndex = collectionsCatalog.findIndex(
      (collection) => collection.filePath === activeCollection.filePath,
    );
    if (currentIndex < 0) {
      return;
    }

    const offset = direction === "up" ? -1 : 1;
    const targetIndex = currentIndex + offset;
    if (targetIndex < 0 || targetIndex >= collectionsCatalog.length) {
      return;
    }

    setIsMutatingCollections(true);
    try {
      const movedCollections = await moveCollection({
        filePath: activeCollection.filePath,
        targetIndex,
      });
      setCollectionsCatalog(
        movedCollections.map((collection) => ({
          name: collection.name,
          filePath: collection.filePath,
        })),
      );
      setActiveCollectionFile(activeCollection.filePath);
    } catch (error) {
      setCollectionActionMessage(commandErrorMessage(error, "Move collection"));
    } finally {
      setIsMutatingCollections(false);
    }
  };

  const handleReorderRequest = async (direction: "up" | "down") => {
    if (!activeCollection || !activeCollectionRequest) {
      return;
    }

    const currentIndex = activeCollectionRequests.findIndex(
      (request) => request.id === activeCollectionRequest.id,
    );
    if (currentIndex < 0) {
      return;
    }

    const offset = direction === "up" ? -1 : 1;
    const targetIndex = currentIndex + offset;
    if (targetIndex < 0 || targetIndex >= activeCollectionRequests.length) {
      return;
    }

    setIsMutatingCollections(true);
    try {
      const reordered = await reorderRequest({
        collectionFile: activeCollection.filePath,
        requestId: activeCollectionRequest.id,
        targetIndex,
      });
      const normalizedRequests = reordered.requests.map((request) => normalizeStoredRequest(request));
      useRequestStore.setState((state) => ({
        requests: replaceCollectionRequests(state.requests, activeCollection.filePath, normalizedRequests),
        activeRequestId: activeCollectionRequest.id,
      }));
      setSavedRequestSignatures((current) => {
        const next = { ...current };
        for (const request of normalizedRequests) {
          next[request.id] = serializeEditableRequest(request);
        }
        return next;
      });
    } catch (error) {
      setCollectionActionMessage(commandErrorMessage(error, "Reorder request"));
    } finally {
      setIsMutatingCollections(false);
    }
  };

  const handleMoveRequest = async () => {
    if (!activeCollection || !activeCollectionRequest) {
      return;
    }

    const targetCollection = collectionsCatalog.find(
      (collection) => collection.filePath === collectionActionValue,
    );
    if (!targetCollection) {
      setCollectionActionMessage("Choose a target collection.");
      return;
    }

    setIsMutatingCollections(true);
    try {
      const moved = await moveRequest({
        requestId: activeCollectionRequest.id,
        sourceCollectionFile: activeCollection.filePath,
        targetCollectionFile: targetCollection.filePath,
        targetIndex: displayRequests.filter(
          (request) => request.collectionFile === targetCollection.filePath,
        ).length,
      });

      const normalizedSource = moved.sourceCollection.requests.map((request) =>
        normalizeStoredRequest(request),
      );
      const normalizedTarget = moved.targetCollection.requests.map((request) =>
        normalizeStoredRequest(request),
      );

      useRequestStore.setState((state) => {
        const withoutSource = replaceCollectionRequests(
          state.requests,
          moved.sourceCollection.filePath,
          normalizedSource,
        );
        const withTarget = replaceCollectionRequests(
          withoutSource,
          moved.targetCollection.filePath,
          normalizedTarget,
        );

        return {
          requests: withTarget.length > 0 ? withTarget : [makeScratchRequest()],
          activeRequestId: moved.movedRequest.id,
        };
      });

      setSavedRequestSignatures((current) => {
        const next = { ...current };
        for (const request of [...normalizedSource, ...normalizedTarget]) {
          next[request.id] = serializeEditableRequest(request);
        }
        return next;
      });
      setActiveCollectionFile(targetCollection.filePath);
      setCollectionActionMode(null);
      setCollectionActionValue("");
      setCollectionActionMessage("");
    } catch (error) {
      setCollectionActionMessage(commandErrorMessage(error, "Move request"));
    } finally {
      setIsMutatingCollections(false);
    }
  };

  const openCollectionAction = (mode: CollectionActionMode) => {
    setCollectionActionMode(mode);
    setCollectionActionMessage("");
    setCollectionActionValue(
      mode === "create-collection"
        ? "New Collection"
        : mode === "rename-collection"
          ? activeCollection?.name ?? ""
          : mode === "rename-request"
            ? activeCollectionRequest?.name ?? activeRequest.name
            : mode === "move-request"
              ? collectionsCatalog.find((collection) => collection.filePath !== activeCollection?.filePath)
                  ?.filePath ?? ""
            : "",
    );
  };

  const handleCollectionActionSubmit = async () => {
    if (collectionActionMode === "create-collection") {
      if (!collectionActionValue.trim()) {
        setCollectionActionMessage("Collection name is required.");
        return;
      }
      await handleCreateCollection();
      return;
    }

    if (collectionActionMode === "rename-collection") {
      if (!collectionActionValue.trim()) {
        setCollectionActionMessage("Collection name is required.");
        return;
      }
      await handleRenameCollection();
      return;
    }

    if (collectionActionMode === "delete-collection") {
      await handleDeleteCollection();
      return;
    }

    if (collectionActionMode === "rename-request") {
      if (!collectionActionValue.trim()) {
        setCollectionActionMessage("Request name is required.");
        return;
      }
      await handleRenameRequest();
      return;
    }

    if (collectionActionMode === "delete-request") {
      await handleDeleteRequest();
      return;
    }

    if (collectionActionMode === "move-request") {
      await handleMoveRequest();
    }
  };

  const handleSecretDraftChange = (name: string, value: string) => {
    setSecretDrafts((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleSaveSecret = async (name: string) => {
    const value = secretDrafts[name]?.trim() ?? "";
    if (!value) {
      return;
    }

    setIsSavingSecret(name);
    try {
      const saved = await saveSecret({ name, value });
      upsertSecretStatus(saved);
      setSecretDrafts((current) => ({
        ...current,
        [name]: "",
      }));
    } finally {
      setIsSavingSecret(null);
    }
  };

  const handleImportCurl = async () => {
    setCurlMessage("Importing cURL...");
    try {
      const targetRequestId = hasActiveCollectionRequests
        ? activeRequest.id
        : `curl-import-${Date.now()}`;
      const targetCollection = activeCollection?.name ?? "cURL Imports";
      const targetCollectionFile =
        activeCollection?.filePath ?? "collections/curl-imports.json";
      const imported = await importCurl({
        command: curlInput,
        requestId: targetRequestId,
        collection: targetCollection,
        collectionFile: targetCollectionFile,
      });
      const method = imported.method.toUpperCase();
      if (!requestMethods.includes(method as RequestMethod)) {
        setCurlMessage(`Imported method ${method} is not supported by the editor yet.`);
        return;
      }

      const importedRequest = {
        id: imported.id,
        name: imported.name,
        collection: imported.collection,
        collectionFile: imported.collectionFile,
        method: method as RequestMethod,
        url: imported.url,
        params: normalizeRows(imported.params, `${imported.id}-param`),
        headers: normalizeRows(imported.headers, `${imported.id}-header`),
        body: imported.body,
        bodyMode: imported.bodyMode,
        bodyContentType: imported.bodyContentType,
        bodyRows: normalizeRequestBodyRows(imported.bodyRows, imported.id),
        authType: imported.authType as "none" | "bearer",
        authToken: imported.authToken,
      };

      if (hasActiveCollectionRequests) {
        replaceRequest(importedRequest);
      } else {
        upsertRequests([importedRequest]);
        setActiveCollectionFile(importedRequest.collectionFile);
      }
      setCurlMessage("Imported into the request editor. Use Save to persist it.");
      setIsCurlPanelOpen(true);
    } catch (error) {
      setCurlMessage(commandErrorMessage(error, "Import cURL"));
    }
  };

  const handleExportCurl = async () => {
    if (!hasActiveCollectionRequests) {
      return;
    }

    setCurlMessage("Exporting active request...");
    try {
      const command = await exportCurl({
        method: activeRequest.method,
        url: activeRequest.url,
        params: activeRequest.params,
        headers: activeRequest.headers,
        body: activeRequest.body,
        bodyMode: activeRequest.bodyMode,
        bodyContentType: activeRequest.bodyContentType,
        bodyRows: sanitizeBodyRows(activeRequest.bodyRows),
        authType: activeRequest.authType,
        authToken: activeRequest.authToken,
      });
      setCurlOutput(command);
      setCurlMessage("Exported cURL command from the active request.");
      setIsCurlPanelOpen(true);
    } catch (error) {
      setCurlMessage(commandErrorMessage(error, "Export cURL"));
    }
  };

  const handleImportPostman = async () => {
    setPostmanMessage("Importing Postman collection...");
    try {
      const importedRequests = await importPostmanCollection({
        collection: activeCollection?.name ?? "Imported API",
        collectionFile: activeCollection?.filePath ?? `collections/postman-${Date.now()}.json`,
        collectionJson: postmanInput,
      });
      const supportedRequests = importedRequests.filter((request) =>
        requestMethods.includes(request.method.toUpperCase() as RequestMethod),
      );

      if (supportedRequests.length === 0) {
        setPostmanMessage("No supported requests found in the Postman collection.");
        return;
      }

      upsertRequests(
        supportedRequests.map((request) => ({
          id: request.id,
          name: request.name,
          collection: request.collection,
          collectionFile: request.collectionFile,
          method: request.method.toUpperCase() as RequestMethod,
          url: request.url,
          params: normalizeRows(request.params, `${request.id}-param`),
          headers: normalizeRows(request.headers, `${request.id}-header`),
          body: request.body,
          bodyMode: request.bodyMode,
          bodyContentType: request.bodyContentType,
          bodyRows: normalizeRequestBodyRows(request.bodyRows, request.id),
          authType: request.authType as "none" | "bearer",
          authToken: request.authToken,
        })),
      );
      setPostmanMessage(
        `Imported ${supportedRequests.length} requests. Use Save on each request to persist edits.`,
      );
    } catch (error) {
      setPostmanMessage(commandErrorMessage(error, "Import Postman"));
    }
  };

  const handleUploadFile = async () => {
    if (!hasCollections || !hasEnvironments) {
      return;
    }

    setTransferMessage("Uploading file...");
    try {
      const result = await uploadFile({
        url: activeRequest.url,
        filePath: uploadPath,
        fieldName: uploadFieldName,
        headers: activeRequest.headers,
        environment: {
          name: activeEnvironment.name,
          filePath: activeEnvironment.source,
          vars: activeEnvironment.vars,
        },
      });
      setTransferMessage(
        `Uploaded ${result.fileName} (${result.sizeBytes} bytes): ${result.status}`,
      );
    } catch (error) {
      setTransferMessage(commandErrorMessage(error, "Upload file"));
    }
  };

  const handleDownloadFile = async () => {
    if (!hasEnvironments) {
      return;
    }

    setTransferMessage("Downloading file...");
    try {
      const result = await downloadFile({
        url: downloadUrl,
        destinationPath: downloadPath,
        overwrite: allowDownloadOverwrite,
        headers: activeRequest.headers,
        environment: {
          name: activeEnvironment.name,
          filePath: activeEnvironment.source,
          vars: activeEnvironment.vars,
        },
      });
      setTransferMessage(
        `Downloaded ${result.sizeBytes} bytes to ${result.destinationPath}: ${result.status}`,
      );
    } catch (error) {
      setTransferMessage(commandErrorMessage(error, "Download file"));
    }
  };

  return (
    <main className="postman-shell">
      <header className="postman-topbar">
        <div className="postman-topbar__brand">
          <div className="postman-logo">AC</div>
          <div>
            <strong>API Client</strong>
            <span>Workspace: {bootstrap.recentWorkspace || "default-workspace"}</span>
          </div>
        </div>

        <div className="postman-topbar__center">
          {hasActiveCollectionRequests ? (
            activeCollectionRequests.map((request) => (
              <button
                key={request.id}
                type="button"
                className={`top-tab ${request.id === activeRequestId ? "is-active" : ""}`}
                onClick={() => setActiveRequest(request.id)}
              >
                {request.name}
              </button>
            ))
          ) : (
            <span className="topbar-empty-state">
              {hasCollections
                ? "No requests in this collection yet. Create or import your first request."
                : "No requests yet. Import or save your first request."}
            </span>
          )}
        </div>

        <div className="postman-topbar__actions">
          <span className={`status-dot ${bootstrap.loaded ? "is-live" : ""}`}>
            {bootstrap.loaded ? "Local Data Ready" : "Browser Preview"}
          </span>
          <button
            type="button"
            className="ghost-button"
            onClick={handleCreateRequest}
          >
            New Request
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              openCollectionAction("create-collection");
            }}
          >
            New Collection
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setIsPostmanPanelOpen(true)}
          >
            Import Postman
          </button>
          <button type="button" className="ghost-button" onClick={() => setIsCurlPanelOpen(true)}>
            Import cURL
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={!hasActiveCollectionRequests}
            onClick={() => {
              void handleExportCurl();
            }}
          >
            Export cURL
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={!hasActiveCollectionRequests || !hasEnvironments}
            onClick={() => setIsTransferPanelOpen(true)}
          >
            Files
          </button>
        </div>
      </header>

      <section className="postman-body">
        <aside className="workspace-nav">
          <div className="workspace-nav__badge">AC</div>
          <div className="workspace-nav__items">
            {sidebarPanels.map((panel) => (
              <button
                key={panel.key}
                type="button"
                aria-label={panel.label}
                title={panel.label}
                className={`workspace-nav__item ${
                  activeSidebarPanel === panel.key ? "is-active" : ""
                }`}
                onClick={() => handleSidebarPanelChange(panel.key)}
              >
                <strong>{panel.short}</strong>
                <span>{panel.label}</span>
              </button>
            ))}
          </div>
          <div className="workspace-nav__footer">
            <span className={`workspace-nav__status ${bootstrap.loaded ? "is-live" : ""}`} />
            <small>{bootstrap.loaded ? "local" : "preview"}</small>
          </div>
        </aside>

        <aside className="explorer-panel">
          <div className="explorer-panel__header">
            <div className="explorer-panel__intro">
              <span>{activePanelMeta.caption}</span>
              <h2>{activePanelMeta.label}</h2>
            </div>
            <div
              className="explorer-panel__summary"
              aria-label={`${explorerSummaryValue} ${explorerSummaryLabel}`}
            >
              <span>{explorerSummaryLabel}</span>
              <strong>{explorerSummaryValue}</strong>
            </div>
          </div>

          <div className="mobile-panel-switcher" aria-label="Workspace sections">
            {sidebarPanels.map((panel) => (
              <button
                key={panel.key}
                type="button"
                aria-label={panel.label}
                className={`mobile-panel-switcher__item ${
                  activeSidebarPanel === panel.key ? "is-active" : ""
                }`}
                onClick={() => handleSidebarPanelChange(panel.key)}
              >
                <strong>{panel.short}</strong>
                <span>{panel.label}</span>
              </button>
            ))}
          </div>

          <div className="explorer-panel__context-bar">
            <div className="explorer-panel__context-main">
              <span>{explorerContext.eyebrow}</span>
              <strong>{explorerContext.title}</strong>
              <small>{explorerContext.subtitle}</small>
            </div>
            <div className="explorer-panel__context-metrics">
              {explorerContext.metrics.map((metric) => (
                <div key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="sidebar__search-shell">
            <input
              className="sidebar__search-input"
              placeholder={`Search ${activePanelMeta.label.toLowerCase()}`}
              value={explorerSearch}
              onChange={(event) => setExplorerSearch(event.target.value)}
            />
          </div>

          {activeSidebarPanel === "collections" ? (
            <div className="explorer-panel__path">
              <span>{bootstrap.recentWorkspace || "default-workspace"}</span>
              <strong>{activeCollection?.name ?? "No collections yet"}</strong>
            </div>
          ) : null}

          {collectionActionMode ? (
            <div className="collection-action-card">
              <div className="collection-action-card__header">
                <strong>{collectionActionTitle}</strong>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setCollectionActionMode(null);
                    setCollectionActionValue("");
                    setCollectionActionMessage("");
                  }}
                >
                  Close
                </button>
              </div>
              {collectionActionMode === "delete-collection" ? (
                <small>
                  Delete <strong>{activeCollection?.name ?? "this collection"}</strong> and all of
                  its requests.
                </small>
              ) : collectionActionMode === "delete-request" ? (
                <small>
                  Delete <strong>{activeCollectionRequest?.name ?? activeRequest.name}</strong> from{" "}
                  <strong>{activeCollection?.name ?? activeRequest.collection}</strong>.
                </small>
              ) : collectionActionMode === "move-request" ? (
                <label className="collection-action-card__field">
                  <span>Target collection</span>
                  <select
                    value={collectionActionValue}
                    onChange={(event) => setCollectionActionValue(event.target.value)}
                  >
                    {collectionsCatalog
                      .filter((collection) => collection.filePath !== activeCollection?.filePath)
                      .map((collection) => (
                        <option key={collection.filePath} value={collection.filePath}>
                          {collection.name}
                        </option>
                      ))}
                  </select>
                </label>
              ) : (
                <label className="collection-action-card__field">
                  <span>Name</span>
                  <input
                    value={collectionActionValue}
                    onChange={(event) => setCollectionActionValue(event.target.value)}
                    placeholder="Enter a name"
                  />
                </label>
              )}
              {collectionActionMessage ? (
                <div className="collection-action-card__message">{collectionActionMessage}</div>
              ) : null}
              <div className="collection-action-card__actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    void handleCollectionActionSubmit();
                  }}
                >
                  Confirm
                </button>
              </div>
            </div>
          ) : null}

          {activeSidebarPanel === "environments" && environmentActionMode ? (
            <div className="collection-action-card">
              <div className="collection-action-card__header">
                <strong>{environmentActionTitle}</strong>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setEnvironmentActionMode(null);
                    setEnvironmentActionValue("");
                    setEnvironmentActionMessage("");
                  }}
                >
                  Close
                </button>
              </div>
              {environmentActionMode === "delete-environment" ? (
                <small>
                  Delete <strong>{activeEnvironment.name}</strong> and remove its local file.
                </small>
              ) : (
                <label className="collection-action-card__field">
                  <span>Name</span>
                  <input
                    value={environmentActionValue}
                    onChange={(event) => setEnvironmentActionValue(event.target.value)}
                    placeholder="Enter a name"
                  />
                </label>
              )}
              {environmentActionMessage ? (
                <div className="collection-action-card__message">{environmentActionMessage}</div>
              ) : null}
              <div className="collection-action-card__actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    void handleEnvironmentActionSubmit();
                  }}
                >
                  Confirm
                </button>
              </div>
            </div>
          ) : null}

          <div className="sidebar__content">
            {activeSidebarPanel === "collections"
              ? filteredCollectionSections.map((section) => (
                  <section
                    key={section.title}
                    className={`tree-group ${expandedCollections[section.title] ? "is-open" : ""}`}
                  >
                        <button
                          type="button"
                          className="tree-group__toggle"
                          onClick={() => {
                            setActiveCollectionFile(section.filePath);
                            toggleCollection(section.title);
                          }}
                        >
                      <span className="tree-group__chevron">
                        {expandedCollections[section.title] ? "v" : ">"}
                      </span>
                      <div className="tree-group__title">
                        <strong>{section.title}</strong>
                        <small>{section.subtitle}</small>
                      </div>
                      <span className="tree-group__count">{section.requests.length}</span>
                    </button>
                    {section.filePath === activeCollection?.filePath ? (
                      <div className="tree-group__actions">
                        <button
                          type="button"
                          className="text-button"
                          disabled={isMutatingCollections}
                          onClick={() => {
                            void handleMoveCollection("up");
                          }}
                        >
                          Col Up
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          disabled={isMutatingCollections}
                          onClick={() => {
                            void handleMoveCollection("down");
                          }}
                        >
                          Col Down
                        </button>
                        {hasActiveCollectionRequests ? (
                          <>
                            <button
                              type="button"
                              className="text-button"
                              disabled={isMutatingCollections}
                              onClick={() => {
                                void handleReorderRequest("up");
                              }}
                            >
                              Req Up
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              disabled={isMutatingCollections}
                              onClick={() => {
                                void handleReorderRequest("down");
                              }}
                            >
                              Req Down
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              disabled={isMutatingCollections}
                              onClick={handleDuplicateRequest}
                            >
                              Duplicate
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              disabled={isMutatingCollections || collectionsCatalog.length < 2}
                              onClick={() => openCollectionAction("move-request")}
                            >
                              Move Req
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              disabled={isMutatingCollections}
                              onClick={() => openCollectionAction("rename-request")}
                            >
                              Rename Req
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => openCollectionAction("delete-request")}
                            >
                              Delete Req
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="text-button"
                          disabled={isMutatingCollections}
                          onClick={() => openCollectionAction("rename-collection")}
                        >
                          Rename Col
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          disabled={isMutatingCollections}
                          onClick={() => openCollectionAction("delete-collection")}
                        >
                          Delete Col
                        </button>
                      </div>
                    ) : null}

                    {expandedCollections[section.title] ? (
                      <div className="tree-group__body">
                        {section.requests.map((request) => (
                            <button
                              key={request.id}
                              type="button"
                              className={`tree-request ${
                                request.id === activeRequestId ? "is-active" : ""
                              }`}
                              onClick={() => {
                                setActiveCollectionFile(section.filePath);
                                setActiveRequest(request.id);
                              }}
                            >
                              <span
                                className={`method-pill method-pill--${request.method.toLowerCase()}`}
                              >
                                {request.method}
                              </span>
                              <div className="tree-request__meta">
                                <strong>{request.name}</strong>
                                <small>{safePathname(request.url)}</small>
                              </div>
                            </button>
                          ))}
                      </div>
                    ) : null}
                  </section>
                ))
              : null}

            {activeSidebarPanel === "collections" && !hasCollections ? (
              <div className="sidebar-empty-state">
                <strong>No collections yet</strong>
                <small>Import a Postman collection or save a request to create your first local collection.</small>
                <button
                  type="button"
                  className="text-button sidebar-empty-state__action"
                  onClick={() => {
                    openCollectionAction("create-collection");
                  }}
                >
                  Create collection
                </button>
              </div>
            ) : null}

            {activeSidebarPanel === "history"
              ? filteredHistory.map((item) => {
                  const historyMethod = item.method;
                  const historyPath = safePathname(item.url);
                  const historyMethodTone =
                    historyMethod === "GET"
                      ? "get"
                      : historyMethod === "POST"
                        ? "post"
                        : historyMethod === "PUT" || historyMethod === "PATCH"
                          ? "put"
                          : historyMethod === "DELETE"
                            ? "delete"
                            : "post";

                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`sidebar-row sidebar-row--history ${
                        activeHistoryId === item.id ? "is-active" : ""
                      }`}
                      onClick={() => handleRestoreHistory(item)}
                    >
                      <span className={`method-pill method-pill--${historyMethodTone}`}>
                        {historyMethod}
                      </span>
                      <div className="sidebar-row__meta">
                        <strong>{historyPath}</strong>
                        <small>{item.meta}</small>
                      </div>
                      <span className="sidebar-row__status">{item.status}</span>
                    </button>
                  );
                })
              : null}

            {activeSidebarPanel === "environments"
              ? filteredEnvironments.map((environment) => (
                  <article
                    key={environment.id}
                    className={`environment-card ${
                      environment.id === activeEnvironmentId ? "is-active" : ""
                    }`}
                  >
                    <button
                      type="button"
                      className="environment-card__header"
                      onClick={() => setActiveEnvironment(environment.id)}
                    >
                      <div>
                        <strong>{environment.name}</strong>
                        <small>{environment.source}</small>
                      </div>
                      <span>{environment.vars.length} vars</span>
                    </button>
                    {environment.id === activeEnvironmentId ? (
                      <div className="tree-group__actions">
                        <button
                          type="button"
                          className="text-button"
                          disabled={isSavingEnvironment}
                          onClick={() => openEnvironmentAction("rename-environment")}
                        >
                          Rename Env
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          disabled={isSavingEnvironment}
                          onClick={() => openEnvironmentAction("delete-environment")}
                        >
                          Delete Env
                        </button>
                      </div>
                    ) : null}
                    <div className="environment-card__vars">
                      {environment.vars.map((row) => (
                        <div key={row.id} className="environment-var">
                          <span>{row.key}</span>
                          <strong>{row.value}</strong>
                        </div>
                      ))}
                    </div>
                  </article>
                ))
              : null}

            {activeSidebarPanel === "environments" && !hasEnvironments ? (
              <div className="sidebar-empty-state">
                <strong>No environments yet</strong>
                <small>Create your first local environment to start using variables, proxy, and cookie settings.</small>
                <button
                  type="button"
                  className="text-button sidebar-empty-state__action"
                  onClick={() => {
                    void handleCreateFirstEnvironment();
                  }}
                >
                  Create local environment
                </button>
              </div>
            ) : null}

            {explorerListEmpty ? (
              <div className="sidebar-empty-state">
                <strong>No results</strong>
                <small>{explorerEmptyMessage}</small>
              </div>
            ) : null}

            {activeSidebarPanel === "settings" ? (
              <>
                <article className="runtime-card">
                  <div className="runtime-card__header">
                    <strong>SQLite</strong>
                    <span>History / Cookie / Recent</span>
                  </div>
                  <small>{bootstrap.databasePath || "pending..."}</small>
                </article>
                <article className="runtime-card">
                  <div className="runtime-card__header">
                    <strong>Filesystem</strong>
                    <span>Collections / Envs / Workspace</span>
                  </div>
                  <small>{bootstrap.appDataDir || "pending..."}</small>
                </article>
                <article className="runtime-card">
                  <div className="runtime-card__header">
                    <strong>Keychain</strong>
                    <span>Secrets / Tokens</span>
                  </div>
                  <small>
                    {bootstrap.secrets.length > 0
                      ? bootstrap.secrets
                          .map((item) => `${item.name}:${item.exists ? "ready" : "missing"}`)
                        .join(" / ")
                      : "pending..."}
                  </small>
                </article>
                <article className="runtime-card">
                  <div className="runtime-card__header">
                    <strong>Tauri Bridge</strong>
                    <span>invoke / event / validation</span>
                  </div>
                  <small>Command expose / type conversion / error wrapping / event channel</small>
                </article>
                <article className="runtime-card">
                  <div className="runtime-card__header">
                    <strong>Rust Core</strong>
                    <span>request engine / auth / proxy / import</span>
                  </div>
                  <small>
                    Env keys: proxy=system|disabled|custom, proxy_url, tls_verify,
                    tls_hostname_verify, https_only
                  </small>
                </article>
              </>
            ) : null}
          </div>

          <div className="sidebar__footer">
            <strong>{sidebarItemCount}</strong>
            <span>items</span>
          </div>
        </aside>

        <section
          className={`workspace ${workspaceMode !== "collections" ? "workspace--with-inspector" : ""}`}
        >
          <div className="workbench">
          {hasCollections && hasActiveCollectionRequests ? (
          <>
          <div className="request-editor">
            <div className="request-editor__header">
              <div className="request-editor__identity">
                <div className="request-context">
                  <span className="request-context__eyebrow">
                    {bootstrap.recentWorkspace || "default-workspace"} / {activeRequest.collection}
                  </span>
                  <h1>{activeRequest.name}</h1>
                </div>
                <div className="environment-pills">
                  {displayEnvironments.map((environment) => (
                    <button
                      key={environment.id}
                      type="button"
                      className={`env-pill ${
                        environment.id === activeEnvironmentId ? "is-active" : ""
                      }`}
                      onClick={() => setActiveEnvironment(environment.id)}
                    >
                      {environment.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="request-context__stats">
                <span
                  className={`request-save-indicator request-save-indicator--${requestStatus.tone}`}
                >
                  {requestStatus.message}
                </span>
                <span>{activeEnvironment.name}</span>
                <span>{activeProxy}</span>
                <span>{activeCookieJar}</span>
              </div>
            </div>

            <div className="request-editor__bar">
              <div className="request-address-bar">
                <label className="request-method-shell">
                  <select
                    className="method-select"
                    value={activeRequest.method}
                    onChange={(event) => {
                      updateRequestMethod(event.target.value as RequestMethod);
                      scheduleRequestAutosave();
                    }}
                  >
                    {requestMethods.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                  <span className="request-method-shell__chevron" aria-hidden="true">
                    v
                  </span>
                </label>
                <div className="request-url-shell">
                  <input
                    className="request-url-input"
                    value={activeRequest.url}
                    onChange={(event) => updateRequestUrl(event.target.value)}
                  />
                </div>
              </div>
              <button
                type="button"
                className="secondary-button"
                disabled={isSavingRequest || (!requestDirty && requestSaveFeedback?.tone !== "error")}
                onClick={() => {
                  void handleSaveRequest();
                }}
              >
                {isSavingRequest ? "Saving..." : requestDirty ? "Save" : "Saved"}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!hasCollections}
                onClick={() => {
                  void sendActiveRequest();
                }}
              >
                {isSending ? "Sending..." : "Send"}
              </button>
            </div>

            <div className="request-editor__nav">
              <div className="request-tabs">
                {requestTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    aria-label={`Request ${tab.label} tab`}
                    className={`request-tab ${requestTab === tab.key ? "is-active" : ""}`}
                    onClick={() => setRequestTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="request-utility-bar">
                <div className="request-utility-bar__group">
                  <span className={`utility-pill ${requestTab === "params" ? "utility-pill--active" : ""}`}>
                    {visibleParamRows} params
                  </span>
                  <span className={`utility-pill ${requestTab === "headers" ? "utility-pill--active" : ""}`}>
                    {visibleHeaderRows} headers
                  </span>
                  <span className={`utility-pill ${requestTab === "auth" ? "utility-pill--active" : ""}`}>
                    auth {activeRequest.authType === "none" ? "off" : "on"}
                  </span>
                  <span className={`utility-pill ${requestTab === "body" ? "utility-pill--active" : ""}`}>
                    body {isStructuredBody ? `${visibleBodyRows} rows` : activeRequest.body.length}
                  </span>
                </div>
                <div className="request-utility-bar__group">
                  <span className="utility-note">{safePathname(activeRequest.url)}</span>
                </div>
              </div>
            </div>

            {lastError ? <div className="request-error-banner">{lastError}</div> : null}

            <div className="request-content">
              {requestTab === "params" ? (
                <section className="editor-panel">
                  <div className="editor-panel__header">
                    <div>
                      <span>Params</span>
                      <h2>Query</h2>
                    </div>
                    <div className="editor-panel__actions">
                      <span className="editor-panel__hint">{visibleParamRows} rows</span>
                      <button type="button" className="text-button" onClick={handleAddParamRow}>
                        Add row
                      </button>
                    </div>
                  </div>
                  <div className="form-table">
                    <div className="form-table__head">
                      <span>On</span>
                      <span>Key</span>
                      <span>Value</span>
                      <span>Act</span>
                    </div>
                    <div className="form-grid">
                      {activeRequest.params.map((row) => (
                        <div key={row.id} className="form-row">
                          <label className="toggle-cell">
                            <input
                              type="checkbox"
                              checked={row.enabled}
                              onChange={() => {
                                toggleParamRow(row.id);
                                scheduleRequestAutosave();
                              }}
                            />
                          </label>
                          <input
                            ref={(element) => {
                              rowInputRefs.current[`params:${row.id}`] = element;
                            }}
                            className={!row.enabled ? "is-disabled" : ""}
                            value={row.key}
                            placeholder="key"
                            onChange={(event) =>
                              updateParamRow(row.id, "key", event.target.value)
                            }
                          />
                          <input
                            className={!row.enabled ? "is-disabled" : ""}
                            value={row.value}
                            placeholder="value"
                            onChange={(event) =>
                              updateParamRow(row.id, "value", event.target.value)
                            }
                          />
                          <button
                            type="button"
                            className="row-action-button"
                            aria-label={`Remove param row ${row.key || row.value || row.id}`}
                            onClick={() => handleRemoveParamRow(row.id)}
                          >
                            x
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              {requestTab === "headers" ? (
                <section className="editor-panel">
                  <div className="editor-panel__header">
                    <div>
                      <span>Headers</span>
                      <h2>Headers</h2>
                    </div>
                    <div className="editor-panel__actions">
                      <span className="editor-panel__hint">{visibleHeaderRows} rows</span>
                      <button type="button" className="text-button" onClick={handleAddHeaderRow}>
                        Add row
                      </button>
                    </div>
                  </div>
                  <div className="form-table">
                    <div className="form-table__head">
                      <span>On</span>
                      <span>Header</span>
                      <span>Value</span>
                      <span>Act</span>
                    </div>
                    <div className="form-grid">
                      {activeRequest.headers.map((row) => (
                        <div key={row.id} className="form-row">
                          <label className="toggle-cell">
                            <input
                              type="checkbox"
                              checked={row.enabled}
                              onChange={() => {
                                toggleHeaderRow(row.id);
                                scheduleRequestAutosave();
                              }}
                            />
                          </label>
                          <input
                            ref={(element) => {
                              rowInputRefs.current[`headers:${row.id}`] = element;
                            }}
                            className={!row.enabled ? "is-disabled" : ""}
                            value={row.key}
                            placeholder="key"
                            onChange={(event) =>
                              updateHeaderRow(row.id, "key", event.target.value)
                            }
                          />
                          <input
                            className={!row.enabled ? "is-disabled" : ""}
                            value={row.value}
                            placeholder="value"
                            onChange={(event) =>
                              updateHeaderRow(row.id, "value", event.target.value)
                            }
                          />
                          <button
                            type="button"
                            className="row-action-button"
                            aria-label={`Remove header row ${row.key || row.value || row.id}`}
                            onClick={() => handleRemoveHeaderRow(row.id)}
                          >
                            x
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              {requestTab === "body" ? (
                <section className="editor-panel editor-panel--full">
                  <div className="editor-panel__header editor-panel__header--body">
                    <div>
                      <span>Body</span>
                      <h2>{bodyModeHeading(activeRequest)}</h2>
                    </div>
                    <div className="body-mode-switcher" aria-label="Request body modes">
                      {([
                        ["json", "JSON"],
                        ["raw", "Raw"],
                        ["urlencoded", "Form URL"],
                        ["multipart", "Multipart"],
                      ] as const).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          className={`body-mode-button ${activeRequest.bodyMode === mode ? "is-active" : ""}`}
                          onClick={() => handleRequestBodyModeChange(mode)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="editor-toolbar editor-toolbar--body">
                    <span>{bodyModeLabel(activeRequest.bodyMode)}</span>
                    {activeRequest.bodyMode === "json" || activeRequest.bodyMode === "raw" ? (
                      <label className="body-inline-field">
                        <span>Content-Type</span>
                        <input
                          value={activeRequest.bodyContentType}
                          placeholder={
                            activeRequest.bodyMode === "json"
                              ? "application/json"
                              : "Optional, e.g. text/plain"
                          }
                          onChange={(event) => handleUpdateBodyContentType(event.target.value)}
                        />
                      </label>
                    ) : (
                      <span>{defaultBodyContentType(activeRequest.bodyMode)} auto</span>
                    )}
                    <span>
                      {isStructuredBody
                        ? `${visibleBodyRows} rows`
                        : `${activeRequest.body.length} chars`}
                    </span>
                    {isStructuredBody ? (
                      <button
                        type="button"
                        className="text-button"
                        onClick={handleAddBodyRow}
                      >
                        Add row
                      </button>
                    ) : null}
                  </div>
                  {activeRequest.bodyMode === "json" || activeRequest.bodyMode === "raw" ? (
                    <textarea
                      className="editor-textarea"
                      value={activeRequest.body}
                      onChange={(event) => updateRequestBody(event.target.value)}
                    />
                  ) : (
                    <div className={`form-table form-table--body ${activeRequest.bodyMode === "multipart" ? "form-table--multipart" : "form-table--urlencoded"}`}>
                      <div
                        className={`form-table__head ${activeRequest.bodyMode === "multipart" ? "form-table__head--multipart" : "form-table__head--body"}`}
                      >
                        <span>On</span>
                        {activeRequest.bodyMode === "multipart" ? <span>Type</span> : null}
                        <span>Key</span>
                        <span>
                          {activeRequest.bodyMode === "multipart" ? "Value / Path" : "Value"}
                        </span>
                        <span>Act</span>
                      </div>
                      <div className="form-grid">
                        {activeRequest.bodyRows.map((row) => (
                          <div
                            key={row.id}
                            className={`form-row ${activeRequest.bodyMode === "multipart" ? "form-row--multipart" : "form-row--body"}`}
                          >
                            <label className="toggle-cell">
                              <input
                                type="checkbox"
                                checked={row.enabled}
                                onChange={() => handleToggleBodyRow(row.id)}
                              />
                            </label>
                            {activeRequest.bodyMode === "multipart" ? (
                              <select
                                className={`body-row-select ${!row.enabled ? "is-disabled" : ""}`}
                                value={row.fieldType}
                                onChange={(event) =>
                                  handleUpdateBodyRowFieldType(
                                    row.id,
                                    event.target.value as RequestBodyFieldType,
                                  )
                                }
                              >
                                <option value="text">Text</option>
                                <option value="file">File</option>
                              </select>
                            ) : null}
                            <input
                              ref={(element) => {
                                rowInputRefs.current[`body:${row.id}`] = element;
                              }}
                              className={!row.enabled ? "is-disabled" : ""}
                              value={row.key}
                              placeholder="key"
                              onChange={(event) =>
                                handleUpdateBodyRow(row.id, "key", event.target.value)
                              }
                            />
                            <input
                              className={!row.enabled ? "is-disabled" : ""}
                              value={row.value}
                              placeholder={
                                activeRequest.bodyMode === "multipart" && row.fieldType === "file"
                                  ? "/absolute/path/to/file"
                                  : "value"
                              }
                              onChange={(event) =>
                                handleUpdateBodyRow(row.id, "value", event.target.value)
                              }
                            />
                            <button
                              type="button"
                              className="row-action-button"
                              aria-label={`Remove body row ${row.key || row.value || row.id}`}
                              onClick={() => handleRemoveBodyRow(row.id)}
                            >
                              x
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="body-table-note">
                        {activeRequest.bodyMode === "multipart"
                          ? "Use absolute file paths for file rows. Multipart boundaries are generated automatically."
                          : "Keys and values are encoded automatically when the request is sent."}
                      </div>
                    </div>
                  )}
                </section>
              ) : null}

              {requestTab === "auth" ? (
                <section className="editor-panel">
                  <div className="editor-panel__header">
                    <div>
                      <span>Authorization</span>
                      <h2>Auth</h2>
                    </div>
                    <div className="editor-panel__actions">
                      <span className="editor-panel__hint">
                        {activeRequest.authType === "none" ? "disabled" : "bearer"}
                      </span>
                    </div>
                  </div>
                  <div className="auth-grid">
                    <label className="field-block">
                      <span>Type</span>
                      <select
                        value={activeRequest.authType}
                        onChange={(event) =>
                          updateAuthType(event.target.value as "none" | "bearer")
                        }
                      >
                        <option value="none">No Auth</option>
                        <option value="bearer">Bearer Token</option>
                      </select>
                    </label>
                    <label className="field-block">
                      <span>Token</span>
                      <input
                        value={activeRequest.authToken}
                        onChange={(event) => updateAuthToken(event.target.value)}
                        placeholder="{{secret.prod_token}}"
                      />
                    </label>
                  </div>
                </section>
              ) : null}
            </div>
          </div>

          <div className="response-panel">
            <div className="response-panel__header">
              <div className="response-tabs">
                {responseTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    aria-label={`Response ${tab.label} tab`}
                    className={`response-tab ${responseTab === tab.key ? "is-active" : ""}`}
                    onClick={() => setResponseTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="response-summary">
                <span className="response-status">{response.status}</span>
                <span>{response.duration}</span>
                <span>{response.size}</span>
                <span>{response.protocol}</span>
              </div>
            </div>

            <div className="response-panel__body">
              <div className="response-info-bar">
                <span>Cookie Jar: {response.summary.cookieJar}</span>
                <span>Secret: {response.summary.secretSource}</span>
                <span>Collection: {response.summary.collectionFile}</span>
              </div>

              {responseTab === "body" ? (
                <pre className="response-viewer">{response.body}</pre>
              ) : null}

              {responseTab === "headers" ? (
                <div className="response-list">
                  {response.headers.map((header) => (
                    <div key={header.key} className="response-row">
                      <span>{header.key}</span>
                      <strong>{header.value}</strong>
                    </div>
                  ))}
                </div>
              ) : null}

              {responseTab === "timeline" ? (
                <div className="response-list">
                  {response.timeline.map((item) => (
                    <div key={item.step} className="response-row">
                      <span>{item.step}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {isPostmanPanelOpen || isCurlPanelOpen || isTransferPanelOpen ? (
            <section className="tool-drawer" aria-label="Request tools">
              <div className="tool-drawer__rail">
                <strong>Tools</strong>
                <span>
                  {[
                    isPostmanPanelOpen ? "Postman" : "",
                    isCurlPanelOpen ? "cURL" : "",
                    isTransferPanelOpen ? "Files" : "",
                  ]
                    .filter(Boolean)
                    .join(" / ")}
                </span>
              </div>

              <div className="tool-drawer__content">
                {isPostmanPanelOpen ? (
                  <section className="import-panel">
                    <div className="import-panel__header">
                      <div>
                        <span>Postman Collection Import</span>
                        <h2>Collection Interop</h2>
                      </div>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setIsPostmanPanelOpen(false)}
                      >
                        Close
                      </button>
                    </div>
                    <label className="import-field">
                      <span>Collection JSON</span>
                      <textarea
                        value={postmanInput}
                        onChange={(event) => setPostmanInput(event.target.value)}
                      />
                    </label>
                    <div className="import-panel__actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          void handleImportPostman();
                        }}
                      >
                        Import Collection
                      </button>
                      {postmanMessage ? <span>{postmanMessage}</span> : null}
                    </div>
                  </section>
                ) : null}

                {isCurlPanelOpen ? (
                  <section className="curl-panel">
                    <div className="curl-panel__header">
                      <div>
                        <span>cURL Import / Export</span>
                        <h2>Command Interop</h2>
                      </div>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setIsCurlPanelOpen(false)}
                      >
                        Close
                      </button>
                    </div>
                    <div className="curl-panel__grid">
                      <label className="curl-field">
                        <span>Import cURL</span>
                        <textarea
                          value={curlInput}
                          onChange={(event) => setCurlInput(event.target.value)}
                        />
                      </label>
                      <label className="curl-field">
                        <span>Exported cURL</span>
                        <textarea
                          readOnly
                          value={curlOutput}
                          placeholder="Use Export cURL to generate a command from the active request."
                        />
                      </label>
                    </div>
                    <div className="curl-panel__actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          void handleImportCurl();
                        }}
                      >
                        Import into Request
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          void handleExportCurl();
                        }}
                      >
                        Export Active Request
                      </button>
                      {curlMessage ? <span>{curlMessage}</span> : null}
                    </div>
                  </section>
                ) : null}

                {isTransferPanelOpen ? (
                  <section className="transfer-panel">
                    <div className="transfer-panel__header">
                      <div>
                        <span>File Upload / Download</span>
                        <h2>Binary Transfer</h2>
                      </div>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setIsTransferPanelOpen(false)}
                      >
                        Close
                      </button>
                    </div>
                    <div className="transfer-panel__grid">
                      <div className="transfer-card">
                        <div>
                          <span>Upload</span>
                          <strong>multipart/form-data</strong>
                        </div>
                        <label className="transfer-field">
                          <span>File Path</span>
                          <input
                            value={uploadPath}
                            onChange={(event) => setUploadPath(event.target.value)}
                            placeholder="/absolute/path/to/file"
                          />
                        </label>
                        <label className="transfer-field">
                          <span>Field Name</span>
                          <input
                            value={uploadFieldName}
                            onChange={(event) => setUploadFieldName(event.target.value)}
                            placeholder="file"
                          />
                        </label>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            void handleUploadFile();
                          }}
                        >
                          Upload Active Request
                        </button>
                      </div>
                      <div className="transfer-card">
                        <div>
                          <span>Download</span>
                          <strong>Save response body</strong>
                        </div>
                        <label className="transfer-field">
                          <span>URL</span>
                          <input
                            value={downloadUrl}
                            onChange={(event) => setDownloadUrl(event.target.value)}
                            placeholder="{{base_url}}/file.json"
                          />
                        </label>
                        <label className="transfer-field">
                          <span>Destination Path</span>
                          <input
                            value={downloadPath}
                            onChange={(event) => setDownloadPath(event.target.value)}
                            placeholder="/absolute/path/to/download"
                          />
                        </label>
                        <label className="transfer-check">
                          <input
                            type="checkbox"
                            checked={allowDownloadOverwrite}
                            onChange={() =>
                              setAllowDownloadOverwrite((current) => !current)
                            }
                          />
                          <span>Allow overwrite</span>
                        </label>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            void handleDownloadFile();
                          }}
                        >
                          Download to Path
                        </button>
                      </div>
                    </div>
                    <div className="transfer-panel__footer">
                      <span>
                        Upload uses the active request URL, headers and environment. Download
                        defaults to no-overwrite for safer local files.
                      </span>
                      {transferMessage ? <strong>{transferMessage}</strong> : null}
                    </div>
                  </section>
                ) : null}
              </div>
            </section>
          ) : null}
          </>
          ) : hasCollections ? (
            <section className="request-empty-state">
              <div className="request-empty-state__eyebrow">Collection</div>
              <h1>{activeCollection?.name ?? "Empty collection"}</h1>
              <p>
                This collection is ready, but it does not contain any requests yet. Create a new
                request or import one into this collection.
              </p>
              <div className="request-empty-state__actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleCreateRequest}
                >
                  New Request
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setIsCurlPanelOpen(true)}
                >
                  Import cURL
                </button>
              </div>
            </section>
          ) : (
            <section className="request-empty-state">
              <div className="request-empty-state__eyebrow">Request Editor</div>
              <h1>Create your first request</h1>
              <p>
                This workspace is empty. Import a Postman collection, paste a cURL command, or
                import your first API request to start building a local collection.
              </p>
              <div className="request-empty-state__actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setIsPostmanPanelOpen(true)}
                >
                  Import Postman
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setIsCurlPanelOpen(true)}
                >
                  Import cURL
                </button>
              </div>
              <div className="request-empty-state__note">
                Collections are created automatically the first time you save an imported request.
              </div>
            </section>
          )}
          </div>

          {workspaceMode !== "collections" ? (
            <aside className="workspace-inspector">

          {workspaceMode === "history" ? (
            <section className="workspace-panel">
              <div className="workspace-panel__header">
                <div>
                  <span>History</span>
                  <h2>Recent Request Sessions</h2>
                </div>
                <span className="workspace-panel__meta">
                  {visibleHistory.length} session{visibleHistory.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="workspace-panel__grid">
                {visibleHistory.length > 0 ? (
                  visibleHistory.map((item) => (
                    <article
                      key={item.id}
                      className={`workspace-card workspace-card--interactive history-session-card ${
                        activeHistoryId === item.id ? "is-active" : ""
                      }`}
                    >
                      <div className="history-session-card__header">
                        <span
                          className={`method-pill method-pill--${
                            item.method === "GET"
                              ? "get"
                              : item.method === "POST"
                                ? "post"
                                : item.method === "DELETE"
                                  ? "delete"
                                  : "put"
                          }`}
                        >
                          {item.method}
                        </span>
                        <strong>{safePathname(item.url)}</strong>
                        <span className="history-session-card__status">{item.status}</span>
                      </div>
                      <small>{item.meta}</small>
                      <div className="history-session-card__details">
                        <span>{item.requestName}</span>
                        <span>{item.collection}</span>
                        <span>{item.environment.name}</span>
                      </div>
                      <div className="history-session-card__actions">
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => handleRestoreHistory(item)}
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => {
                            void handleResendHistory(item);
                          }}
                        >
                          Resend
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <article className="workspace-card workspace-card--empty">
                    <strong>{isExplorerFiltering ? "No matching history entries" : "No history yet"}</strong>
                    <small>{historyPanelEmptyMessage}</small>
                  </article>
                )}
              </div>
            </section>
          ) : null}

          {workspaceMode === "environments" ? (
            <section className="workspace-panel">
              <div className="workspace-panel__header">
                <div>
                  <span>Environment Variables</span>
                  <h2>{activeEnvironment.name}</h2>
                </div>
                <div className="workspace-panel__actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => openEnvironmentAction("create-environment")}
                  >
                    New Env
                  </button>
                  {hasEnvironments ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => openEnvironmentAction("rename-environment")}
                    >
                      Rename Env
                    </button>
                  ) : null}
                  {hasEnvironments ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => openEnvironmentAction("delete-environment")}
                    >
                      Delete Env
                    </button>
                  ) : null}
                  {environmentStatus ? (
                    <span
                      className={`request-save-indicator request-save-indicator--${environmentStatus.tone}`}
                    >
                      {environmentStatus.message}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={
                      !hasEnvironments ||
                      isSavingEnvironment ||
                      (!environmentDirty && environmentSaveFeedback?.tone !== "error")
                    }
                    onClick={() => {
                      void handleSaveEnvironment();
                    }}
                  >
                    {isSavingEnvironment ? "Saving..." : "Save Env"}
                  </button>
                </div>
              </div>
              {hasEnvironments ? (
                <div className="workspace-panel__table">
                  <div className="workspace-panel__table-head">
                    <span>Key</span>
                    <span>Value</span>
                  </div>
                  {activeEnvironment.vars.map((row) => (
                    <div
                      key={row.id}
                      className="workspace-panel__table-row"
                    >
                      <input
                        value={row.key}
                        onChange={(event) => {
                          updateEnvironmentVar(activeEnvironment.id, row.id, "key", event.target.value);
                          scheduleEnvironmentAutosave();
                        }}
                        ref={(input) => {
                          environmentInputRefs.current[`${activeEnvironment.id}:${row.id}:key`] = input;
                        }}
                        placeholder="base_url"
                      />
                      <div className="workspace-panel__table-row-value">
                        <input
                          value={row.value}
                          onChange={(event) => {
                            updateEnvironmentVar(activeEnvironment.id, row.id, "value", event.target.value);
                            scheduleEnvironmentAutosave();
                          }}
                          ref={(input) => {
                            environmentInputRefs.current[`${activeEnvironment.id}:${row.id}:value`] = input;
                          }}
                          placeholder="https://api.example.com"
                        />
                        <button
                          type="button"
                          className="text-button"
                          aria-label={`Remove environment var ${row.key || row.id}`}
                          onClick={() => handleRemoveEnvironmentVar(row.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="workspace-panel__table-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={handleAddEnvironmentVar}
                    >
                      Add Variable
                    </button>
                  </div>
                </div>
              ) : (
                <article className="workspace-card workspace-card--empty">
                  <strong>No environments yet</strong>
                  <small>Create a local environment to manage base URLs, proxy, and cookie settings before you send requests.</small>
                  <div className="request-empty-state__actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        void handleCreateFirstEnvironment();
                      }}
                    >
                      Create local environment
                    </button>
                  </div>
                </article>
              )}
            </section>
          ) : null}

          {workspaceMode === "settings" ? (
            <section className="workspace-panel">
              <div className="workspace-panel__header">
                <div>
                  <span>Architecture</span>
                  <h2>Local Runtime Overview</h2>
                </div>
              </div>
              <div className="architecture-grid">
                <article className="architecture-card">
                  <span>Frontend UI</span>
                  <h3>React + TypeScript</h3>
                  <p>
                    Request editor, header/query/body forms, response viewer, history,
                    environments, collections and settings.
                  </p>
                </article>
                <article className="architecture-card">
                  <span>Tauri Bridge</span>
                  <h3>invoke / event</h3>
                  <p>
                    Command exposure, parameter validation, type conversion, error wrapping
                    and frontend-backend event channels.
                  </p>
                </article>
                <article className="architecture-card">
                  <span>Rust Core</span>
                  <h3>HTTP / Auth / Proxy</h3>
                  <p>
                    HTTP engine, environment resolution, cookie handling, auth flow,
                    TLS/proxy setup and import/export pipelines.
                  </p>
                </article>
                <article className="architecture-card">
                  <span>Local Data</span>
                  <h3>SQLite / Files / Keychain</h3>
                  <p>
                    History, settings, cookies, collections, environment files, secrets,
                    local cache and logs.
                  </p>
                </article>
              </div>
              <div className="workspace-panel__header">
                <div>
                  <span>Runtime Storage</span>
                  <h2>Cache / Logs</h2>
                </div>
              </div>
              <div className="runtime-storage-grid">
                <article className="runtime-storage-card">
                  <div className="runtime-storage-card__header">
                    <span>Local Cache</span>
                    <strong>{bootstrap.runtime.cache.entries} entries</strong>
                  </div>
                  <dl>
                    <div>
                      <dt>Directory</dt>
                      <dd>{bootstrap.runtime.cache.directory || bootstrap.cacheDir || "Pending runtime"}</dd>
                    </div>
                    <div>
                      <dt>Index</dt>
                      <dd>{bootstrap.runtime.cache.indexFile || "cache/index.json"}</dd>
                    </div>
                    <div>
                      <dt>Size</dt>
                      <dd>{formatBytes(bootstrap.runtime.cache.sizeBytes)}</dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>{formatRuntimeTimestamp(bootstrap.runtime.cache.updatedAt)}</dd>
                    </div>
                  </dl>
                </article>
                <article className="runtime-storage-card">
                  <div className="runtime-storage-card__header">
                    <span>Application Logs</span>
                    <strong>{formatBytes(bootstrap.runtime.logs.sizeBytes)}</strong>
                  </div>
                  <dl>
                    <div>
                      <dt>Directory</dt>
                      <dd>{bootstrap.runtime.logs.directory || bootstrap.logsDir || "Pending runtime"}</dd>
                    </div>
                    <div>
                      <dt>Active File</dt>
                      <dd>{bootstrap.runtime.logs.activeFile || "logs/api-client.log"}</dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>{formatRuntimeTimestamp(bootstrap.runtime.logs.updatedAt)}</dd>
                    </div>
                    <div>
                      <dt>Last Entry</dt>
                      <dd>{bootstrap.runtime.logs.lastLine || "No log entries yet"}</dd>
                    </div>
                  </dl>
                </article>
              </div>
              <div className="workspace-panel__header">
                <div>
                  <span>Bridge Events</span>
                  <h2>Frontend / Backend Channel</h2>
                </div>
              </div>
              <div className="bridge-event-list">
                {bridgeEvents.length > 0 ? (
                  bridgeEvents.map((event) => (
                    <article key={event.id} className="bridge-event-card">
                      <div className="bridge-event-card__meta">
                        <span className={`bridge-event-phase bridge-event-phase--${event.phase}`}>
                          {event.phase}
                        </span>
                        <strong>{event.command}</strong>
                        <small>{new Date(Number(event.timestamp)).toLocaleTimeString()}</small>
                      </div>
                      <p>{event.message}</p>
                      {event.detail ? <small>{event.detail}</small> : null}
                    </article>
                  ))
                ) : (
                  <article className="bridge-event-card bridge-event-card--empty">
                    <div className="bridge-event-card__meta">
                      <span className="bridge-event-phase">idle</span>
                      <strong>Waiting for runtime events</strong>
                    </div>
                    <p>
                      Tauri will stream command lifecycle events here after the
                      desktop runtime is active.
                    </p>
                  </article>
                )}
              </div>
              <div className="workspace-panel__header">
                <div>
                  <span>Secrets</span>
                  <h2>Keychain Secrets</h2>
                </div>
              </div>
              <div className="workspace-panel__table">
                <div className="workspace-panel__table-head workspace-panel__table-head--secrets">
                  <span>Name</span>
                  <span>Status</span>
                  <span>Value</span>
                  <span>Action</span>
                </div>
                {bootstrap.secrets.map((secret) => (
                  <div
                    key={secret.name}
                    className="workspace-panel__table-row workspace-panel__table-row--secrets"
                  >
                    <strong>{secret.name}</strong>
                    <span className={secret.exists ? "secret-status is-ready" : "secret-status"}>
                      {secret.exists ? "Ready" : "Missing"}
                    </span>
                    <input
                      type="password"
                      value={secretDrafts[secret.name] ?? ""}
                      placeholder={
                        secret.exists ? "Update secret value" : "Enter secret value"
                      }
                      onChange={(event) =>
                        handleSecretDraftChange(secret.name, event.target.value)
                      }
                    />
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        void handleSaveSecret(secret.name);
                      }}
                      disabled={isSavingSecret === secret.name}
                    >
                      {isSavingSecret === secret.name ? "Saving..." : "Save Secret"}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

            </aside>
          ) : null}
        </section>
      </section>
    </main>
  );
}
