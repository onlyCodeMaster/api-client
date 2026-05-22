import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type RequestBodyMode = "json" | "raw" | "urlencoded" | "multipart";
export type RequestBodyFieldType = "text" | "file";
export type RequestBodyRow = {
  key: string;
  value: string;
  enabled: boolean;
  fieldType: RequestBodyFieldType;
};

export type BootstrapState = {
  paths: {
    appDataDir: string;
    databasePath: string;
    workspacesDir: string;
    collectionsDir: string;
    environmentsDir: string;
    cacheDir: string;
    logsDir: string;
  };
  settings: {
    theme: string;
    recentWorkspace: string;
    autoSave: boolean;
  };
  runtime: {
    cache: {
      directory: string;
      indexFile: string;
      entries: number;
      sizeBytes: number;
      updatedAt: string;
    };
    logs: {
      directory: string;
      activeFile: string;
      sizeBytes: number;
      lastLine: string;
      updatedAt: string;
    };
  };
  history: Array<{
    id: number;
    requestId: string;
    method: string;
    url: string;
    status: string;
    durationMs: number;
    createdAt: string;
    requestName: string;
    collection: string;
    params: Array<{ key: string; value: string; enabled: boolean }>;
    headers: Array<{ key: string; value: string; enabled: boolean }>;
    body: string;
    bodyMode: RequestBodyMode;
    bodyContentType: string;
    bodyRows: RequestBodyRow[];
    authType: string;
    authToken: string;
    environmentName: string;
    environmentSource: string;
    environmentVars: Array<{
      key: string;
      value: string;
    }>;
  }>;
  collections: Array<{
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
      bodyMode: RequestBodyMode;
      bodyContentType: string;
      bodyRows: RequestBodyRow[];
      authType: string;
      authToken: string;
    }>;
  }>;
  environments: Array<{
    name: string;
    filePath: string;
    vars: Array<{
      key: string;
      value: string;
    }>;
  }>;
  secrets: Array<{
    name: string;
    exists: boolean;
  }>;
};

export type RecordHistoryInput = {
  requestId: string;
  method: string;
  url: string;
  status: string;
  durationMs: number;
  requestName: string;
  collection: string;
  params: Array<{ key: string; value: string; enabled: boolean }>;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  body: string;
  bodyMode: RequestBodyMode;
  bodyContentType: string;
  bodyRows: RequestBodyRow[];
  authType: string;
  authToken: string;
  environment: BootstrapState["environments"][number];
};

export type SendRequestInput = {
  requestId: string;
  requestName: string;
  collection: string;
  method: string;
  url: string;
  params: Array<{ key: string; value: string; enabled: boolean }>;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  body: string;
  bodyMode: RequestBodyMode;
  bodyContentType: string;
  bodyRows: RequestBodyRow[];
  authType: string;
  authToken: string;
  environment: BootstrapState["environments"][number];
};

export type StoredRequest = BootstrapState["collections"][number]["requests"][number];

export type SendRequestResult = {
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

export type FileUploadResult = {
  status: string;
  durationMs: number;
  sizeBytes: number;
  fileName: string;
  responseBody: string;
};

export type FileDownloadResult = {
  status: string;
  durationMs: number;
  sizeBytes: number;
  destinationPath: string;
};

export type BridgeEvent = {
  id: string;
  command: string;
  phase: "started" | "completed" | "failed" | string;
  message: string;
  timestamp: string;
  detail?: string | null;
};

export function listenBridgeEvents(handler: (event: BridgeEvent) => void) {
  return listen<BridgeEvent>("api-client://bridge-event", (event) => {
    handler(event.payload);
  });
}

export async function loadBootstrapState(): Promise<BootstrapState> {
  return invoke<BootstrapState>("load_bootstrap_state");
}

export async function recordHistoryEntry(input: RecordHistoryInput) {
  return invoke("record_history_entry", { input });
}

export async function saveSecret(input: { name: string; value: string }) {
  return invoke<BootstrapState["secrets"][number]>("save_secret", { input });
}

export async function saveEnvironment(input: {
  name: string;
  filePath: string;
  vars: Array<{ key: string; value: string }>;
}) {
  return invoke<BootstrapState["environments"][number]>("save_environment", { input });
}

export async function renameEnvironment(input: {
  currentFilePath: string;
  newName: string;
  newFilePath: string;
}) {
  return invoke<BootstrapState["environments"][number]>("rename_environment", { input });
}

export async function deleteEnvironment(input: {
  filePath: string;
}) {
  return invoke<void>("delete_environment", { input });
}

export async function saveRequest(
  input: StoredRequest,
) {
  return invoke<BootstrapState["collections"][number]>("save_request", { input });
}

export async function createCollection(input: {
  name: string;
  filePath: string;
}) {
  return invoke<BootstrapState["collections"][number]>("create_collection", { input });
}

export async function renameCollection(input: {
  currentFilePath: string;
  newName: string;
  newFilePath: string;
}) {
  return invoke<BootstrapState["collections"][number]>("rename_collection", { input });
}

export async function deleteCollection(input: {
  filePath: string;
}) {
  return invoke<void>("delete_collection", { input });
}

export async function deleteRequest(input: {
  requestId: string;
  collectionFile: string;
}) {
  return invoke<BootstrapState["collections"][number]>("delete_request", { input });
}

export async function moveCollection(input: {
  filePath: string;
  targetIndex: number;
}) {
  return invoke<BootstrapState["collections"]>("move_collection", { input });
}

export async function reorderRequest(input: {
  collectionFile: string;
  requestId: string;
  targetIndex: number;
}) {
  return invoke<BootstrapState["collections"][number]>("reorder_request", { input });
}

export async function moveRequest(input: {
  requestId: string;
  sourceCollectionFile: string;
  targetCollectionFile: string;
  targetIndex: number;
}) {
  return invoke<{
    sourceCollection: BootstrapState["collections"][number];
    targetCollection: BootstrapState["collections"][number];
    movedRequest: StoredRequest;
  }>("move_request", { input });
}

export async function importCurl(input: {
  command: string;
  requestId: string;
  collection: string;
  collectionFile: string;
}) {
  return invoke<StoredRequest>("import_curl", { input });
}

export async function exportCurl(input: {
  method: string;
  url: string;
  params: Array<{ key: string; value: string; enabled: boolean }>;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  body: string;
  bodyMode: RequestBodyMode;
  bodyContentType: string;
  bodyRows: RequestBodyRow[];
  authType: string;
  authToken: string;
}) {
  return invoke<string>("export_curl", { input });
}

export async function importPostmanCollection(input: {
  collection: string;
  collectionFile: string;
  collectionJson: string;
}) {
  return invoke<StoredRequest[]>("import_postman_collection", { input });
}

export async function uploadFile(input: {
  url: string;
  filePath: string;
  fieldName: string;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  environment: BootstrapState["environments"][number];
}) {
  return invoke<FileUploadResult>("upload_file", { input });
}

export async function downloadFile(input: {
  url: string;
  destinationPath: string;
  overwrite: boolean;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  environment: BootstrapState["environments"][number];
}) {
  return invoke<FileDownloadResult>("download_file", { input });
}

export async function sendRequest(input: SendRequestInput) {
  return invoke<SendRequestResult>("send_request", { input });
}
