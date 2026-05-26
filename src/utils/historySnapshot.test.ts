import { describe, it, expect } from "vitest";
import {
  truncateToBytes,
  buildResponseSnapshot,
  historyEntryToResponse,
  DEFAULT_MAX_HISTORY_BODY_BYTES,
} from "./historySnapshot";
import type { HistoryEntry, ResponseData } from "../types";

describe("truncateToBytes", () => {
  it("returns the string unchanged when shorter than the cap", () => {
    const r = truncateToBytes("hello", 100);
    expect(r).toEqual({ value: "hello", truncated: false });
  });

  it("truncates ASCII to the byte budget", () => {
    const r = truncateToBytes("0123456789", 5);
    expect(r.value).toBe("01234");
    expect(r.truncated).toBe(true);
  });

  it("does not split multibyte UTF-8 code points", () => {
    // "你" encodes to 3 bytes. With a 5-byte budget we can fit one
    // "你" (3) but not the second one (6); decoder must drop the partial.
    const r = truncateToBytes("你你", 5);
    expect(r.truncated).toBe(true);
    // Decoder uses fatal:false so the second incomplete char becomes
    // a replacement char or is dropped — either way the value must not
    // contain the literal second 你.
    expect(r.value.startsWith("你")).toBe(true);
    expect(new TextEncoder().encode(r.value).length).toBeLessThanOrEqual(5);
  });

  it("returns empty when maxBytes is 0", () => {
    expect(truncateToBytes("abc", 0)).toEqual({ value: "", truncated: true });
    expect(truncateToBytes("", 0)).toEqual({ value: "", truncated: false });
  });

  it("returns empty when maxBytes is negative", () => {
    expect(truncateToBytes("abc", -1)).toEqual({ value: "", truncated: true });
  });
});

describe("buildResponseSnapshot", () => {
  const sample: ResponseData = {
    status: 200,
    status_text: "OK",
    headers: { "content-type": "application/json" },
    body: '{"ok":true}',
    body_encoding: "text",
    body_truncated: false,
    time_ms: 42,
    size_bytes: 11,
  };

  it("returns empty object for null response", () => {
    expect(buildResponseSnapshot(null)).toEqual({});
    expect(buildResponseSnapshot(undefined)).toEqual({});
  });

  it("captures all the response fields", () => {
    const snap = buildResponseSnapshot(sample);
    expect(snap.response_status).toBe(200);
    expect(snap.response_time_ms).toBe(42);
    expect(snap.response_headers).toBe('{"content-type":"application/json"}');
    expect(snap.response_body).toBe('{"ok":true}');
    expect(snap.response_body_encoding).toBe("text");
    expect(snap.response_body_truncated).toBe(false);
    expect(snap.response_size_bytes).toBe(11);
  });

  it("flags truncation when body exceeds the cap", () => {
    const big = "a".repeat(1024);
    const snap = buildResponseSnapshot({ ...sample, body: big, size_bytes: 1024 }, 256);
    expect(snap.response_body_truncated).toBe(true);
    expect((snap.response_body as string).length).toBeLessThanOrEqual(256);
    // Full size is preserved even though body is truncated.
    expect(snap.response_size_bytes).toBe(1024);
  });

  it("preserves an upstream truncation flag", () => {
    const snap = buildResponseSnapshot(
      { ...sample, body_truncated: true },
      DEFAULT_MAX_HISTORY_BODY_BYTES,
    );
    expect(snap.response_body_truncated).toBe(true);
  });
});

describe("historyEntryToResponse", () => {
  const base: HistoryEntry = {
    id: "h1",
    name: "Sample",
    method: "GET",
    url: "https://example.test/x",
    headers: "[]",
    params: "[]",
    body: "",
    body_type: "none",
    created_at: 1,
    updated_at: 1,
  };

  it("returns null on legacy rows (no response captured)", () => {
    expect(historyEntryToResponse(base)).toBeNull();
  });

  it("returns null if status was captured but body wasn't", () => {
    expect(historyEntryToResponse({ ...base, response_status: 200 })).toBeNull();
  });

  it("rebuilds a ResponseData from a snapshot row", () => {
    const r = historyEntryToResponse({
      ...base,
      response_status: 200,
      response_time_ms: 12,
      response_headers: '{"a":"b"}',
      response_body: '{"ok":true}',
      response_body_encoding: "text",
      response_body_truncated: false,
      response_size_bytes: 11,
    });
    expect(r).not.toBeNull();
    expect(r!.status).toBe(200);
    expect(r!.body).toBe('{"ok":true}');
    expect(r!.headers).toEqual({ a: "b" });
    expect(r!.time_ms).toBe(12);
    expect(r!.body_encoding).toBe("text");
    expect(r!.body_truncated).toBe(false);
    expect(r!.size_bytes).toBe(11);
  });

  it("defaults missing optional fields gracefully", () => {
    const r = historyEntryToResponse({
      ...base,
      response_status: 200,
      response_body: "x",
    });
    expect(r).not.toBeNull();
    expect(r!.body_encoding).toBe("text");
    expect(r!.body_truncated).toBe(false);
    expect(r!.time_ms).toBe(0);
    expect(r!.size_bytes).toBe(1);
    expect(r!.headers).toEqual({});
  });

  it("survives malformed JSON in response_headers", () => {
    const r = historyEntryToResponse({
      ...base,
      response_status: 200,
      response_body: "x",
      response_headers: "{not json",
    });
    expect(r!.headers).toEqual({});
  });
});
