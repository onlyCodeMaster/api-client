// Pure helpers for serializing / deserializing a response snapshot into the
// SQLite history row format. Lifted out of useRequestStore so they can be
// unit-tested in isolation and reused if other panels want to render a
// history row's response without going through the tab system.

import type { HistoryEntry, ResponseData } from "../types";

/** Default cap (256 KiB) for persisting response bodies in the history
 *  table. Anything larger gets truncated; the full size is still recorded
 *  in `response_size_bytes`. Configurable via Settings → Max history body
 *  size. The in-memory ResponseData cap (`max_body_bytes`) is independent
 *  and typically larger (10 MiB). */
export const DEFAULT_MAX_HISTORY_BODY_BYTES = 256 * 1024;

/** Truncate a string so its UTF-8 byte length is <= `maxBytes`. Returns
 *  the truncated string and whether truncation occurred. Walks back to
 *  the nearest UTF-8 lead byte so we never split a multibyte code point
 *  (which would otherwise inflate the re-encoded byte count via
 *  U+FFFD replacement characters). */
export function truncateToBytes(
  s: string,
  maxBytes: number,
): { value: string; truncated: boolean } {
  if (maxBytes <= 0) return { value: "", truncated: s.length > 0 };
  const encoded = new TextEncoder().encode(s);
  if (encoded.length <= maxBytes) return { value: s, truncated: false };
  // Step back to a UTF-8 lead byte: a continuation byte has the high
  // bits `10xxxxxx`, i.e. `(b & 0xC0) === 0x80`. We back off at most 3
  // bytes (max continuation-byte run length).
  let end = maxBytes;
  for (let i = 0; i < 3 && end > 0; i++) {
    if ((encoded[end] & 0xc0) !== 0x80) break;
    end -= 1;
  }
  const slice = encoded.slice(0, end);
  const value = new TextDecoder("utf-8", { fatal: false }).decode(slice);
  return { value, truncated: true };
}

/** Serialize a response into the history-row snapshot columns. Returns
 *  the per-column fragment that the caller merges into the full
 *  `HistoryEntry`. */
export function buildResponseSnapshot(
  response: ResponseData | null | undefined,
  maxHistoryBodyBytes: number = DEFAULT_MAX_HISTORY_BODY_BYTES,
): Pick<
  HistoryEntry,
  | "response_status"
  | "response_time_ms"
  | "response_headers"
  | "response_body"
  | "response_body_encoding"
  | "response_body_truncated"
  | "response_size_bytes"
> {
  if (!response) return {};
  const { value, truncated } = truncateToBytes(response.body, maxHistoryBodyBytes);
  return {
    response_status: response.status,
    response_time_ms: response.time_ms,
    response_headers: JSON.stringify(response.headers),
    response_body: value,
    response_body_encoding: response.body_encoding,
    response_body_truncated: truncated || response.body_truncated,
    response_size_bytes: response.size_bytes,
  };
}

/** Rebuild a `ResponseData` from a history row, or `null` if the row
 *  pre-dates the response-snapshot migration (no body persisted). */
export function historyEntryToResponse(entry: HistoryEntry): ResponseData | null {
  if (entry.response_status === undefined || entry.response_body === undefined) return null;
  let headers: Record<string, string> = {};
  if (entry.response_headers) {
    try {
      headers = JSON.parse(entry.response_headers);
    } catch {
      headers = {};
    }
  }
  return {
    status: entry.response_status,
    // We don't persist status_text; HTTP status codes are well-known
    // enough that the response panel renders fine without it.
    status_text: "",
    headers,
    body: entry.response_body,
    body_encoding: entry.response_body_encoding ?? "text",
    body_truncated: entry.response_body_truncated ?? false,
    time_ms: entry.response_time_ms ?? 0,
    size_bytes: entry.response_size_bytes ?? entry.response_body.length,
  };
}
