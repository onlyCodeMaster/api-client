import type { AuthConfig, Collection, CollectionRequest, KeyValue } from "../types";

function genId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function kv(key: string, value: string, enabled = true): KeyValue {
  return { id: genId(), key, value, enabled };
}

interface PostmanKV {
  key: string;
  value?: string;
  disabled?: boolean;
}

interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[] | string;
  path?: string[] | string;
  query?: PostmanKV[];
}

interface PostmanBody {
  mode?: string;
  raw?: string;
  formdata?: PostmanKV[];
  urlencoded?: PostmanKV[];
  options?: { raw?: { language?: string } };
}

interface PostmanAuth {
  type: string;
  bearer?: PostmanKV[];
  basic?: PostmanKV[];
  apikey?: PostmanKV[];
}

interface PostmanRequest {
  method?: string;
  header?: PostmanKV[];
  url?: PostmanUrl | string;
  body?: PostmanBody;
  auth?: PostmanAuth;
}

interface PostmanItem {
  name: string;
  request?: PostmanRequest;
  item?: PostmanItem[];
  auth?: PostmanAuth;
}

interface PostmanCollection {
  info?: { name?: string; description?: string };
  item?: PostmanItem[];
  auth?: PostmanAuth;
}

function postmanKvToKv(arr?: PostmanKV[]): KeyValue[] {
  if (!arr || arr.length === 0) return [kv("", "")];
  return arr.map((p) => ({
    id: genId(),
    key: p.key,
    value: p.value ?? "",
    enabled: !p.disabled,
  }));
}

function urlToString(u: PostmanUrl | string | undefined): string {
  if (!u) return "";
  if (typeof u === "string") return u;
  if (u.raw) return u.raw;
  const host = Array.isArray(u.host) ? u.host.join(".") : u.host || "";
  const path = Array.isArray(u.path) ? u.path.join("/") : u.path || "";
  const protocol = u.protocol ? `${u.protocol}://` : "";
  return `${protocol}${host}${path ? "/" + path : ""}`;
}

function authToConfig(a?: PostmanAuth): AuthConfig | undefined {
  if (!a) return undefined;
  switch (a.type) {
    case "bearer": {
      const t = a.bearer?.find((p) => p.key === "token")?.value || "";
      return { auth_type: "bearer", bearer_token: t };
    }
    case "basic": {
      const u = a.basic?.find((p) => p.key === "username")?.value || "";
      const pw = a.basic?.find((p) => p.key === "password")?.value || "";
      return { auth_type: "basic", basic_username: u, basic_password: pw };
    }
    case "apikey": {
      const key = a.apikey?.find((p) => p.key === "key")?.value || "";
      const value = a.apikey?.find((p) => p.key === "value")?.value || "";
      const inp = a.apikey?.find((p) => p.key === "in")?.value;
      return {
        auth_type: "api_key",
        api_key_key: key,
        api_key_value: value,
        api_key_in: inp === "query" ? "query" : "header",
      };
    }
    default:
      return { auth_type: "none" };
  }
}

function postmanItemToRequest(item: PostmanItem): CollectionRequest | null {
  const r = item.request;
  if (!r) return null;
  const url = urlToString(r.url);
  const headers = postmanKvToKv(r.header);
  const params = postmanKvToKv(typeof r.url === "object" ? r.url?.query : undefined);

  let body = "";
  let bodyType = "none";
  if (r.body) {
    if (r.body.mode === "raw") {
      body = r.body.raw || "";
      const lang = r.body.options?.raw?.language?.toLowerCase();
      if (lang === "json") bodyType = "json";
      else if (lang === "xml") bodyType = "xml";
      else if (lang === "text") bodyType = "text";
      else bodyType = "text";
    } else if (r.body.mode === "formdata") {
      bodyType = "form-data";
    } else if (r.body.mode === "urlencoded") {
      bodyType = "text";
      body = (r.body.urlencoded || [])
        .filter((p) => !p.disabled)
        .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value || "")}`)
        .join("&");
    }
  }

  const now = Date.now();
  return {
    id: genId(),
    name: item.name || "Untitled",
    method: (r.method || "GET").toUpperCase(),
    url,
    headers,
    params,
    body,
    body_type: bodyType,
    auth: authToConfig(r.auth),
    created_at: now,
    updated_at: now,
  };
}

function flattenItems(items: PostmanItem[]): CollectionRequest[] {
  const out: CollectionRequest[] = [];
  for (const it of items) {
    if (it.request) {
      const r = postmanItemToRequest(it);
      if (r) out.push(r);
    }
    if (it.item) out.push(...flattenItems(it.item));
  }
  return out;
}

/** Parse Postman v2.1 collection JSON (single object or array) into our Collection[]. */
export function postmanToCollection(data: unknown): Collection[] {
  const collections: PostmanCollection[] = Array.isArray(data)
    ? (data as PostmanCollection[])
    : [data as PostmanCollection];

  const now = Date.now();
  return collections.map((pc) => {
    const requests = pc.item ? flattenItems(pc.item) : [];
    return {
      id: genId(),
      name: pc.info?.name || "Imported Collection",
      description: pc.info?.description || "",
      auth: authToConfig(pc.auth),
      requests,
      folders: [],
      created_at: now,
      updated_at: now,
    };
  });
}

/** Export a Collection to Postman v2.1 JSON. */
export function collectionToPostman(col: Collection): unknown {
  const itemToPostman = (r: CollectionRequest): PostmanItem => {
    const item: PostmanItem = {
      name: r.name || "Untitled",
      request: {
        method: r.method,
        header: r.headers
          .filter((h) => h.key)
          .map((h) => ({ key: h.key, value: h.value, disabled: !h.enabled })),
        url: {
          raw: r.url,
          query: r.params
            .filter((p) => p.key)
            .map((p) => ({ key: p.key, value: p.value, disabled: !p.enabled })),
        },
      },
    };
    if (r.body_type !== "none" && r.body) {
      item.request!.body = {
        mode: "raw",
        raw: r.body,
        options:
          r.body_type === "json"
            ? { raw: { language: "json" } }
            : r.body_type === "xml"
            ? { raw: { language: "xml" } }
            : { raw: { language: "text" } },
      };
    }
    if (r.auth && r.auth.auth_type !== "none") {
      const t = r.auth.auth_type;
      if (t === "bearer") {
        item.request!.auth = {
          type: "bearer",
          bearer: [{ key: "token", value: r.auth.bearer_token || "" }],
        };
      } else if (t === "basic") {
        item.request!.auth = {
          type: "basic",
          basic: [
            { key: "username", value: r.auth.basic_username || "" },
            { key: "password", value: r.auth.basic_password || "" },
          ],
        };
      } else if (t === "api_key") {
        item.request!.auth = {
          type: "apikey",
          apikey: [
            { key: "key", value: r.auth.api_key_key || "" },
            { key: "value", value: r.auth.api_key_value || "" },
            { key: "in", value: r.auth.api_key_in || "header" },
          ],
        };
      }
    }
    return item;
  };

  return {
    info: {
      _postman_id: col.id,
      name: col.name,
      description: col.description,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: col.requests.map(itemToPostman),
  };
}
