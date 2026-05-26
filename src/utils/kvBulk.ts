import type { KeyValue } from "../types";

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Serialize a key/value list into the bulk-edit textarea format.
 *
 * One row per line, `key: value`. Disabled rows are prefixed with `# ` so a
 * round-trip through bulk mode preserves the enabled bit. Empty rows
 * (no key and no value) are dropped to avoid clutter.
 */
export function serializeKeyValues(items: KeyValue[]): string {
  return items
    .filter((it) => it.key.trim() || it.value.trim())
    .map((it) => `${it.enabled ? "" : "# "}${it.key}: ${it.value}`)
    .join("\n");
}

/**
 * Parse the bulk-edit textarea back into KeyValue rows.
 *
 * Rules:
 *   - Empty / whitespace-only lines are skipped (treated as visual spacing).
 *   - Lines beginning with `#` are stored disabled; the `#` and any
 *     following whitespace are stripped from the key.
 *   - `:` is preferred as the key/value separator since that's what
 *     `serializeKeyValues` writes; `=` is only consulted when there is no
 *     `:` on the line. Picking the leftmost of the two would corrupt keys
 *     that legitimately contain `=` (e.g. form fields named `a=b`) on
 *     round-trip, since the serialized form `a=b: value` would split at
 *     the `=` instead of the `:`.
 *   - Everything after the separator is taken verbatim, so
 *     `Authorization: Bearer abc:def` survives the round trip.
 *   - A line without a separator becomes a bare key with empty value.
 *   - The result always contains at least one row; if the input parses to
 *     zero rows, a fresh empty row is returned so the editor stays usable.
 */
export function parseKeyValues(input: string): KeyValue[] {
  const rows: KeyValue[] = [];
  const lines = input.split(/\r?\n/);
  for (const raw of lines) {
    if (!raw.trim()) continue;
    let enabled = true;
    let body = raw;
    if (body.startsWith("#")) {
      enabled = false;
      body = body.replace(/^#\s*/, "");
    }
    // Prefer ':' (canonical separator we write). Fall back to '=' so users
    // pasting form-data-style input still get sensible behaviour.
    let sepIdx = body.indexOf(":");
    if (sepIdx === -1) sepIdx = body.indexOf("=");
    if (sepIdx === -1) {
      rows.push({ id: generateId(), key: body.trim(), value: "", enabled });
      continue;
    }
    const key = body.slice(0, sepIdx).trim();
    const value = body.slice(sepIdx + 1).trim();
    rows.push({ id: generateId(), key, value, enabled });
  }
  if (rows.length === 0) {
    rows.push({ id: generateId(), key: "", value: "", enabled: true });
  }
  return rows;
}
