/**
 * Postman-compatible dynamic variables. Any `{{$name}}` token (note the
 * leading `$`) is resolved by calling the matching generator below. Unlike
 * environment variables, dynamic variables are **per-substitution** —
 * `{{$randomInt}}` referenced twice in the same request produces two
 * different numbers, matching Postman's semantics.
 *
 * Used by the regular `{{var}}` substitution sites in `requestPipeline.ts`
 * and the streaming protocols (`useRequestStore.ts` for WS/SSE) so users
 * can drop dynamic tokens into URLs, headers, body, query strings, etc.
 *
 * No external deps — `crypto.randomUUID` is in every supported runtime
 * (Tauri's WebView2/WKWebView/WebKitGTK all expose it), and the rest use
 * `Math.random()` since these values are non-cryptographic by definition.
 */

const HEX = "0123456789abcdef";

function randomHex(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += HEX[Math.floor(Math.random() * 16)];
  }
  return out;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Format a Date as an ISO-8601 string with timezone offset (`2024-05-25T08:15:00+00:00`),
 * matching what most server-side timestamp parsers expect.
 */
function isoWithOffset(d: Date): string {
  const pad = pad2;
  const tzMin = -d.getTimezoneOffset();
  const sign = tzMin >= 0 ? "+" : "-";
  const tzAbs = Math.abs(tzMin);
  const tz = `${sign}${pad(Math.floor(tzAbs / 60))}:${pad(tzAbs % 60)}`;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    tz
  );
}

const FIRST_NAMES = [
  "Alex", "Sam", "Jordan", "Casey", "Taylor", "Morgan", "Robin", "Drew",
  "Pat", "Riley", "Cameron", "Hayden", "Sage", "Charlie", "Quinn",
];
const LAST_NAMES = [
  "Smith", "Jones", "Brown", "Taylor", "Lee", "Garcia", "Martinez",
  "Davis", "Wilson", "Anderson", "Thomas", "Moore", "Walker",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Each generator returns a fresh string on every call. The signature is
 * fixed so we can store them all in one record without TS complaining.
 */
const generators: Record<string, () => string> = {
  // --- Time -----------------------------------------------------------------
  /** Unix timestamp in seconds. */
  timestamp: () => String(Math.floor(Date.now() / 1000)),
  /** Unix timestamp in milliseconds. */
  timestampMs: () => String(Date.now()),
  /** ISO-8601 UTC, e.g. `2024-05-25T08:15:00.123Z`. */
  isoTimestamp: () => new Date().toISOString(),
  /** ISO-8601 with local timezone offset. */
  isoLocal: () => isoWithOffset(new Date()),

  // --- IDs ------------------------------------------------------------------
  /** RFC 4122 v4 UUID via crypto.randomUUID. */
  guid: () => crypto.randomUUID(),
  /** Alias for guid (Postman's name). */
  randomUUID: () => crypto.randomUUID(),
  /** 32-char lowercase hex string. */
  randomHex: () => randomHex(32),

  // --- Numbers --------------------------------------------------------------
  /** Integer in `[0, 1000)`. */
  randomInt: () => String(Math.floor(Math.random() * 1000)),
  /** Float in `[0, 1)` with 6 decimal places. */
  randomFloat: () => Math.random().toFixed(6),
  /** Boolean as `"true"` or `"false"`. */
  randomBoolean: () => (Math.random() < 0.5 ? "true" : "false"),

  // --- Strings --------------------------------------------------------------
  /** 8-char alphanumeric. */
  randomAlphaNumeric: () => Math.random().toString(36).slice(2, 10),
  /** First name from a small pool. */
  randomFirstName: () => pick(FIRST_NAMES),
  /** Last name from a small pool. */
  randomLastName: () => pick(LAST_NAMES),
  /** Plausible-looking full name. */
  randomFullName: () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
  /** Plausible-looking email. */
  randomEmail: () =>
    `${pick(FIRST_NAMES).toLowerCase()}.${pick(LAST_NAMES).toLowerCase()}${Math.floor(Math.random() * 1000)}@example.com`,
};

/**
 * Resolve a `{{$name}}` token. Returns the literal placeholder if the name
 * is unknown so the failure is visible to the user instead of silently
 * substituting an empty string.
 */
export function resolveDynamic(name: string): string {
  const gen = generators[name];
  if (!gen) return `{{$${name}}}`;
  try {
    return gen();
  } catch {
    return `{{$${name}}}`;
  }
}

/**
 * Names of all known dynamic variables, sorted. Used by autocomplete-style
 * UI (variable hover preview, future).
 */
export function listDynamicVarNames(): string[] {
  return Object.keys(generators).sort();
}

/**
 * Apply a substitution pass that resolves both `{{name}}` (env / transient
 * lookups via the `lookup` callback) and `{{$name}}` (dynamic generators).
 * The `{{$...}}` branch wins over a same-named env var if anyone happens to
 * have one — the `$` prefix is reserved.
 */
export function substituteAll(
  str: string,
  lookup: (key: string) => string | undefined
): string {
  return str.replace(/\{\{([^}]+)\}\}/g, (orig, raw: string) => {
    const key = raw.trim();
    if (key.startsWith("$")) {
      return resolveDynamic(key.slice(1));
    }
    const v = lookup(key);
    return v !== undefined ? v : orig;
  });
}
