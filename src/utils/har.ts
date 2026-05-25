import type {
  Collection,
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
 * Parse a HAR (HTTP Archive) v1.2 file into a single Collection. Each entry
 * becomes one request named after its URL path.
 *
 * Reference: http://www.softwareishard.com/blog/har-12-spec/
 */
export function harToCollection(data: unknown): Collection {
  const root = data as HarFile;
  const entries = root?.log?.entries || [];
  const now = Date.now();

  const requests: CollectionRequest[] = entries.map((e) => {
    const r = e.request;
    const url = r.url || "";
    const headers: KeyValue[] = (r.headers || []).map((h) => ({
      id: genId(),
      key: h.name,
      value: h.value,
      // HAR records what was actually sent on the wire; drop hop-by-hop
      // headers and cookies (those get re-applied automatically) but keep
      // everything else enabled so the request reproduces faithfully.
      enabled: !isHopByHop(h.name),
    }));
    if (headers.length === 0) headers.push(emptyKV());

    const params: KeyValue[] = (r.queryString || []).map((q) => ({
      id: genId(),
      key: q.name,
      value: q.value,
      enabled: true,
    }));
    if (params.length === 0) params.push(emptyKV());

    let body = "";
    let bodyType: CollectionRequest["body_type"] = "none";
    if (r.postData) {
      body = r.postData.text || "";
      const mime = (r.postData.mimeType || "").toLowerCase();
      if (mime.includes("json")) bodyType = "json";
      else if (mime.includes("xml")) bodyType = "xml";
      else if (mime.includes("form-urlencoded")) bodyType = "text";
      else if (mime) bodyType = "text";
    }

    return {
      id: genId(),
      name: makeName(r.method, url),
      method: (r.method || "GET").toUpperCase(),
      url: stripQuery(url),
      headers,
      params,
      body,
      body_type: bodyType,
      auth: { auth_type: "inherit" },
      created_at: now,
      updated_at: now,
    };
  });

  return {
    id: genId(),
    name: "HAR Import",
    description: `Imported ${requests.length} request(s) from HAR.`,
    requests,
    folders: [],
    created_at: now,
    updated_at: now,
  };
}

function makeName(method: string | undefined, url: string): string {
  try {
    const u = new URL(url);
    return `${(method || "GET").toUpperCase()} ${u.pathname || "/"}`;
  } catch {
    return `${(method || "GET").toUpperCase()} ${url}`;
  }
}

/** Strip the query string from `url` because HAR also reports it as `queryString` entries. */
function stripQuery(url: string): string {
  const idx = url.indexOf("?");
  return idx >= 0 ? url.slice(0, idx) : url;
}

function isHopByHop(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === "host" ||
    n === "content-length" ||
    n === "connection" ||
    n === "keep-alive" ||
    n === "proxy-connection" ||
    n === "transfer-encoding" ||
    n === "upgrade"
  );
}

interface HarFile {
  log?: {
    entries?: HarEntry[];
  };
}

interface HarEntry {
  request: {
    method?: string;
    url?: string;
    headers?: { name: string; value: string }[];
    queryString?: { name: string; value: string }[];
    postData?: { mimeType?: string; text?: string };
  };
}
