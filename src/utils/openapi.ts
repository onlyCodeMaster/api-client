import yaml from "js-yaml";
import type {
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
 * Parse an OpenAPI 3.x or Swagger 2.0 spec from a JSON/YAML string and convert
 * it into a Collection. Falls back to JSON parsing if YAML fails.
 *
 * Supports:
 *  - JSON and YAML input
 *  - Both Swagger 2.0 (`host` + `basePath`) and OpenAPI 3.x (`servers[]`)
 *  - Operations grouped into folders by their first tag
 *  - Query and header parameters
 *  - JSON request body examples (from `example`, `examples`, or `schema`)
 */
export function openapiToCollection(input: string | object): Collection {
  const spec = typeof input === "string" ? parseSpec(input) : (input as OpenApiSpec);
  const isV3 = !!spec.openapi;
  const baseUrl = pickBaseUrl(spec);
  const collectionName =
    (spec.info && spec.info.title) || (isV3 ? "OpenAPI Import" : "Swagger Import");
  const description = (spec.info && spec.info.description) || "";

  const now = Date.now();
  const byTag = new Map<string, CollectionRequest[]>();
  const noTag: CollectionRequest[] = [];

  const paths = spec.paths || {};
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"] as const) {
      const op = (pathItem as Record<string, OpenApiOperation | undefined>)[method];
      if (!op) continue;

      const req = operationToRequest(op, method.toUpperCase(), path, baseUrl, spec, now);
      const tag = op.tags && op.tags.length > 0 ? op.tags[0] : null;
      if (tag) {
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag)!.push(req);
      } else {
        noTag.push(req);
      }
    }
  }

  const folders: CollectionFolder[] = [];
  for (const [tag, reqs] of byTag) {
    folders.push({
      id: genId(),
      name: tag,
      requests: reqs,
      folders: [],
    });
  }

  return {
    id: genId(),
    name: collectionName,
    description,
    requests: noTag,
    folders,
    created_at: now,
    updated_at: now,
  };
}

function parseSpec(raw: string): OpenApiSpec {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as OpenApiSpec;
    } catch {
      // fall through to YAML
    }
  }
  return yaml.load(trimmed) as OpenApiSpec;
}

function pickBaseUrl(spec: OpenApiSpec): string {
  if (spec.servers && spec.servers.length > 0) {
    const server = spec.servers[0];
    let url = server.url || "";
    // Substitute server variables with their defaults.
    if (server.variables) {
      for (const [k, v] of Object.entries(server.variables)) {
        url = url.replace(new RegExp(`\\{${k}\\}`, "g"), v.default ?? "");
      }
    }
    return url.replace(/\/$/, "");
  }
  if (spec.host) {
    const scheme = spec.schemes && spec.schemes.includes("https") ? "https" : spec.schemes?.[0] || "https";
    const basePath = spec.basePath || "";
    return `${scheme}://${spec.host}${basePath}`.replace(/\/$/, "");
  }
  return "";
}

function operationToRequest(
  op: OpenApiOperation,
  method: string,
  path: string,
  baseUrl: string,
  spec: OpenApiSpec,
  now: number
): CollectionRequest {
  const headers: KeyValue[] = [];
  const params: KeyValue[] = [];

  const allParams = [...(op.parameters || []), ...((spec.paths?.[path] as PathItem | undefined)?.parameters || [])];
  for (const p of allParams) {
    if (!p || !p.name) continue;
    if (p.in === "query") {
      params.push({
        id: genId(),
        key: p.name,
        value: typeof p.example === "string" ? p.example : "",
        enabled: !!p.required,
      });
    } else if (p.in === "header") {
      headers.push({
        id: genId(),
        key: p.name,
        value: typeof p.example === "string" ? p.example : "",
        enabled: !!p.required,
      });
    }
  }
  if (params.length === 0) params.push(emptyKV());
  if (headers.length === 0) headers.push(emptyKV());

  let body = "";
  let bodyType: CollectionRequest["body_type"] = "none";
  if (op.requestBody) {
    const content = op.requestBody.content || {};
    const jsonEntry = content["application/json"];
    if (jsonEntry) {
      body = sampleFromMedia(jsonEntry);
      bodyType = "json";
    } else {
      const first = Object.entries(content)[0];
      if (first) {
        const [mime, media] = first;
        body = sampleFromMedia(media);
        bodyType = mime.includes("xml") ? "xml" : "text";
      }
    }
  }

  const url = `${baseUrl}${path}`;
  return {
    id: genId(),
    name: op.summary || op.operationId || `${method} ${path}`,
    method,
    url,
    headers,
    params,
    body,
    body_type: bodyType,
    auth: { auth_type: "inherit" },
    created_at: now,
    updated_at: now,
  };
}

function sampleFromMedia(media: OpenApiMedia): string {
  if (media.example !== undefined) return stringifyMaybe(media.example);
  if (media.examples) {
    const first = Object.values(media.examples)[0];
    if (first && "value" in first) return stringifyMaybe(first.value);
  }
  if (media.schema) {
    const sample = sampleFromSchema(media.schema);
    if (sample !== undefined) return stringifyMaybe(sample);
  }
  return "";
}

function stringifyMaybe(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** Build a tiny synthetic example from a JSON schema. Only covers the common shapes. */
function sampleFromSchema(schema: OpenApiSchema | undefined, depth = 0): unknown {
  if (!schema || depth > 4) return undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  switch (schema.type) {
    case "string":
      return schema.format === "date-time" ? new Date().toISOString() : "";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "array":
      return [sampleFromSchema(schema.items, depth + 1)];
    case "object":
    default: {
      if (!schema.properties) return {};
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(schema.properties)) {
        obj[k] = sampleFromSchema(v, depth + 1);
      }
      return obj;
    }
  }
}

// === Minimal OpenAPI types (we only touch a subset). ===
interface OpenApiSpec {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; description?: string };
  servers?: { url: string; variables?: Record<string, { default?: string }> }[];
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths?: Record<string, PathItem>;
}

interface PathItem {
  parameters?: OpenApiParameter[];
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
  head?: OpenApiOperation;
  options?: OpenApiOperation;
}

interface OpenApiOperation {
  summary?: string;
  operationId?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: { content?: Record<string, OpenApiMedia> };
}

interface OpenApiParameter {
  name: string;
  in: "query" | "header" | "path" | "cookie" | "body";
  required?: boolean;
  example?: unknown;
  schema?: OpenApiSchema;
}

interface OpenApiMedia {
  schema?: OpenApiSchema;
  example?: unknown;
  examples?: Record<string, { value?: unknown }>;
}

interface OpenApiSchema {
  type?: string;
  format?: string;
  example?: unknown;
  default?: unknown;
  enum?: unknown[];
  items?: OpenApiSchema;
  properties?: Record<string, OpenApiSchema>;
}
