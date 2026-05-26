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
 *   - Separator precedence:
 *       1. The first `": "` (colon followed by space) wins. This is what
 *          `serializeKeyValues` always emits, and what users paste from
 *          devtools / cURL header blocks, so a round-trip always lands
 *          here. Pinning on the colon-space pair lets keys that contain
 *          `=` (e.g. form field `a=b`) survive round-trip, and lets values
 *          containing `:` (e.g. URLs like `https://example.com`) keep the
 *          `:` intact.
 *       2. If no `": "` is present, fall back to the leftmost of `:` or
 *          `=` (legacy behaviour). Covers manually-typed lines like
 *          `Auth:Bearer xyz` (no space after `:`) and `foo=bar`.
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
    // 1) Anchor on ": " (canonical write form). This both round-trips keys
    //    containing "=" (e.g. `a=b: value`) and keeps `:` inside values
    //    (e.g. `redirect_uri=https://example.com`) from being mistaken for
    //    the separator.
    let sepIdx = body.indexOf(": ");
    let sepLen = 2;
    if (sepIdx === -1) {
      // 2) No ": " on the line. Fall back to the leftmost of ":" or "=",
      //    matching the pre-PR-D-1 behaviour for user-typed lines.
      sepIdx = body.search(/[:=]/);
      sepLen = 1;
    }
    if (sepIdx === -1) {
      rows.push({ id: generateId(), key: body.trim(), value: "", enabled });
      continue;
    }
    const key = body.slice(0, sepIdx).trim();
    const value = body.slice(sepIdx + sepLen).trim();
    rows.push({ id: generateId(), key, value, enabled });
  }
  if (rows.length === 0) {
    rows.push({ id: generateId(), key: "", value: "", enabled: true });
  }
  return rows;
}
