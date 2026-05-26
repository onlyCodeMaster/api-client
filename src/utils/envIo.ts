import type { EnvVariable } from "../types";

/**
 * On-disk JSON layout for an exported environment.
 *
 * We intentionally version this so future changes (e.g. encoding secrets
 * differently) can be picked up by importers. Use the validator
 * {@link parseEnvironmentExport} when reading user-supplied files \u2014 don't
 * trust the shape blindly.
 */
export interface EnvironmentExport {
  schema: "api-client.env/v1";
  name: string;
  variables: EnvVariable[];
}

/**
 * Build an `EnvironmentExport` blob ready to be written to disk. Strips
 * any extra fields from each variable so the file is stable across
 * runtime changes that might add private metadata.
 */
export function buildEnvironmentExport(
  name: string,
  variables: EnvVariable[],
): EnvironmentExport {
  return {
    schema: "api-client.env/v1",
    name,
    variables: variables.map((v) => ({
      key: v.key,
      value: v.value,
      enabled: v.enabled,
      is_secret: v.is_secret,
    })),
  };
}

/**
 * Trigger a browser-native file download for the given environment.
 * Works in both the Tauri webview and a plain browser \u2014 we deliberately
 * don't use `@tauri-apps/plugin-dialog` here because the file is small
 * text and a `<a download>` works the same way in every shell, which
 * keeps the e2e tests honest.
 */
export function downloadEnvironmentJson(
  name: string,
  variables: EnvVariable[],
) {
  const data = buildEnvironmentExport(name, variables);
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFilename(name)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revocation: some browsers race the click-through if we revoke
  // synchronously. A microtask is enough; we don't need a long timeout.
  queueMicrotask(() => URL.revokeObjectURL(url));
}

/** Replace characters that misbehave in filenames across major OSes. */
function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim() || "environment"
  );
}

/**
 * Shape of a single environment-like object we accept on import. Returned
 * by {@link parseImportFile} regardless of source format \u2014 native, Postman,
 * or a bare array \u2014 so the UI doesn't need to know which kind of file the
 * user picked.
 */
export interface ImportedEnvironment {
  name: string;
  variables: EnvVariable[];
}

/**
 * Parse a file's text content into one or more importable environments.
 *
 * Recognised formats:
 *  1. Native `{schema: "api-client.env/v1", name, variables}` (single env).
 *  2. Postman v2 environment `{name, values: [{key, value, enabled, type}]}`.
 *  3. Postman *collection* environment list (`{environments: [...]}`).
 *  4. Bare array of native exports.
 *
 * Throws if no recognised shape is found, so the caller can surface a
 * single error message to the user instead of guessing.
 */
export function parseImportFile(text: string): ImportedEnvironment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("invalid_json");
  }

  // Try array of native exports.
  if (Array.isArray(parsed)) {
    const out: ImportedEnvironment[] = [];
    for (const item of parsed) {
      const one = tryParseSingle(item);
      if (one) out.push(one);
    }
    if (out.length === 0) throw new Error("unrecognised_format");
    return out;
  }

  // Single native / Postman environment.
  const single = tryParseSingle(parsed);
  if (single) return [single];

  // Postman environment-list export.
  if (isObject(parsed) && Array.isArray(parsed.environments)) {
    const out: ImportedEnvironment[] = [];
    for (const item of parsed.environments) {
      const one = tryParseSingle(item);
      if (one) out.push(one);
    }
    if (out.length === 0) throw new Error("unrecognised_format");
    return out;
  }

  throw new Error("unrecognised_format");
}

function tryParseSingle(value: unknown): ImportedEnvironment | null {
  if (!isObject(value)) return null;

  // Native format.
  if (value.schema === "api-client.env/v1") {
    if (typeof value.name !== "string") return null;
    const variables = parseNativeVariables(value.variables);
    return { name: value.name, variables };
  }

  // Postman v2 environment.
  if (Array.isArray(value.values) && typeof value.name === "string") {
    return {
      name: value.name,
      variables: parsePostmanValues(value.values),
    };
  }

  // Last-resort: anything with `name` + `variables` array.
  if (typeof value.name === "string" && Array.isArray(value.variables)) {
    return {
      name: value.name,
      variables: parseNativeVariables(value.variables),
    };
  }

  return null;
}

function parseNativeVariables(input: unknown): EnvVariable[] {
  if (!Array.isArray(input)) return [];
  const out: EnvVariable[] = [];
  for (const v of input) {
    if (!isObject(v)) continue;
    const key = typeof v.key === "string" ? v.key : "";
    const value = typeof v.value === "string" ? v.value : "";
    if (!key && !value) continue;
    out.push({
      key,
      value,
      enabled: v.enabled === false ? false : true,
      is_secret: v.is_secret === true,
    });
  }
  return out;
}

function parsePostmanValues(input: unknown[]): EnvVariable[] {
  const out: EnvVariable[] = [];
  for (const v of input) {
    if (!isObject(v)) continue;
    const key = typeof v.key === "string" ? v.key : "";
    const value = typeof v.value === "string" ? v.value : "";
    if (!key && !value) continue;
    out.push({
      key,
      value,
      enabled: v.enabled === false ? false : true,
      // Postman exposes secrets as `type: "secret"`; map that to our flag.
      is_secret: v.type === "secret",
    });
  }
  return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
