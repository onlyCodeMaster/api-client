import type {
  AuthConfig,
  Collection,
  CollectionFolder,
  CollectionRequest,
  KeyValue,
} from "../types";

function genId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function emptyKV(): KeyValue {
  return { id: genId(), key: "", value: "", enabled: true };
}

/**
 * Parse an Insomnia v4 export (`_type: "export"`) and convert each workspace
 * into a Collection. Folders (request_group) preserve their nesting.
 */
export function insomniaToCollections(data: unknown): Collection[] {
  const root = data as InsomniaExport;
  if (!root || !Array.isArray(root.resources)) return [];

  const now = Date.now();
  const byId = new Map<string, InsomniaResource>();
  for (const r of root.resources) byId.set(r._id, r);

  const workspaces = root.resources.filter((r) => r._type === "workspace");
  if (workspaces.length === 0) return [];

  return workspaces.map((ws) => {
    const folders: CollectionFolder[] = [];
    const requests: CollectionRequest[] = [];
    walk(ws._id, byId, folders, requests, now);
    return {
      id: genId(),
      name: ws.name || "Imported (Insomnia)",
      description: ws.description || "",
      requests,
      folders,
      created_at: now,
      updated_at: now,
    };
  });
}

function walk(
  parentId: string,
  byId: Map<string, InsomniaResource>,
  folders: CollectionFolder[],
  requests: CollectionRequest[],
  now: number
) {
  for (const r of byId.values()) {
    if (r.parentId !== parentId) continue;
    if (r._type === "request") {
      requests.push(convertRequest(r, now));
    } else if (r._type === "request_group") {
      const sub: CollectionFolder = {
        id: genId(),
        name: r.name || "Folder",
        requests: [],
        folders: [],
      };
      walk(r._id, byId, sub.folders, sub.requests, now);
      folders.push(sub);
    }
  }
}

function convertRequest(r: InsomniaResource, now: number): CollectionRequest {
  const headers: KeyValue[] = (r.headers || []).map((h) => ({
    id: genId(),
    key: h.name,
    value: h.value,
    enabled: !h.disabled,
  }));
  if (headers.length === 0) headers.push(emptyKV());

  const params: KeyValue[] = (r.parameters || []).map((p) => ({
    id: genId(),
    key: p.name,
    value: p.value,
    enabled: !p.disabled,
  }));
  if (params.length === 0) params.push(emptyKV());

  let body = "";
  let bodyType: CollectionRequest["body_type"] = "none";
  if (r.body) {
    if (r.body.text) {
      body = r.body.text;
      const mime = (r.body.mimeType || "").toLowerCase();
      if (mime.includes("json")) bodyType = "json";
      else if (mime.includes("xml")) bodyType = "xml";
      else if (mime.includes("text")) bodyType = "text";
      else bodyType = "text";
    }
  }

  return {
    id: genId(),
    name: r.name || `${r.method || "GET"} ${r.url || ""}`,
    method: (r.method || "GET").toUpperCase(),
    url: r.url || "",
    headers,
    params,
    body,
    body_type: bodyType,
    auth: insomniaAuth(r.authentication),
    created_at: now,
    updated_at: now,
  };
}

function insomniaAuth(a: InsomniaAuth | undefined): AuthConfig | undefined {
  if (!a || !a.type) return { auth_type: "inherit" };
  switch (a.type) {
    case "bearer":
      return { auth_type: "bearer", bearer_token: a.token || "" };
    case "basic":
      return {
        auth_type: "basic",
        basic_username: a.username || "",
        basic_password: a.password || "",
      };
    case "apikey":
      return {
        auth_type: "api_key",
        api_key_key: a.key || "",
        api_key_value: a.value || "",
        api_key_in: a.addTo === "queryParams" ? "query" : "header",
      };
    default:
      return { auth_type: "inherit" };
  }
}

interface InsomniaExport {
  _type?: "export";
  resources: InsomniaResource[];
}

interface InsomniaResource {
  _id: string;
  _type: "workspace" | "request" | "request_group" | string;
  parentId: string;
  name?: string;
  description?: string;
  url?: string;
  method?: string;
  headers?: { name: string; value: string; disabled?: boolean }[];
  parameters?: { name: string; value: string; disabled?: boolean }[];
  body?: { mimeType?: string; text?: string };
  authentication?: InsomniaAuth;
}

interface InsomniaAuth {
  type?: string;
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  addTo?: string;
}
