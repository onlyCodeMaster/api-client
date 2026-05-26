import { describe, expect, it } from "vitest";
import { parseKeyValues, serializeKeyValues } from "./kvBulk";
import type { KeyValue } from "../types";

/** Strip the synthetic `id` (random per row) so we can compare on content. */
function stripIds(rows: KeyValue[]): Omit<KeyValue, "id">[] {
  return rows.map(({ id: _id, ...rest }) => rest);
}

describe("serializeKeyValues", () => {
  it("emits `key: value` lines and drops empty rows", () => {
    const out = serializeKeyValues([
      { id: "a", key: "Accept", value: "application/json", enabled: true },
      { id: "b", key: "", value: "", enabled: true },
      { id: "c", key: "X-Debug", value: "1", enabled: false },
    ]);
    expect(out).toBe("Accept: application/json\n# X-Debug: 1");
  });

  it("returns an empty string when every row is empty", () => {
    expect(
      serializeKeyValues([
        { id: "a", key: "", value: "", enabled: true },
      ]),
    ).toBe("");
  });
});

describe("parseKeyValues", () => {
  it("splits on the first `:` and trims surrounding whitespace", () => {
    const out = parseKeyValues("Authorization: Bearer abc:def");
    expect(stripIds(out)).toEqual([
      { key: "Authorization", value: "Bearer abc:def", enabled: true },
    ]);
  });

  it("accepts `=` as a separator (form-style)", () => {
    const out = parseKeyValues("foo=bar");
    expect(stripIds(out)).toEqual([
      { key: "foo", value: "bar", enabled: true },
    ]);
  });

  it("treats `#`-prefixed lines as disabled rows", () => {
    const out = parseKeyValues("# X-Debug: 1\nAccept: application/json");
    expect(stripIds(out)).toEqual([
      { key: "X-Debug", value: "1", enabled: false },
      { key: "Accept", value: "application/json", enabled: true },
    ]);
  });

  it("ignores blank / whitespace-only lines", () => {
    const out = parseKeyValues("\n  \nA: 1\n\nB: 2\n");
    expect(stripIds(out)).toEqual([
      { key: "A", value: "1", enabled: true },
      { key: "B", value: "2", enabled: true },
    ]);
  });

  it("tolerates lines without a separator (bare key)", () => {
    const out = parseKeyValues("just-a-key");
    expect(stripIds(out)).toEqual([
      { key: "just-a-key", value: "", enabled: true },
    ]);
  });

  it("always returns at least one row even on empty input", () => {
    const out = parseKeyValues("");
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe("");
    expect(out[0].value).toBe("");
    expect(out[0].enabled).toBe(true);
  });

  it("round-trips through serialize/parse without losing enabled state", () => {
    const original: KeyValue[] = [
      { id: "a", key: "Accept", value: "application/json", enabled: true },
      { id: "b", key: "X-Debug", value: "1", enabled: false },
    ];
    const text = serializeKeyValues(original);
    const reparsed = parseKeyValues(text);
    expect(stripIds(reparsed)).toEqual(stripIds(original));
  });

  it("handles CRLF line endings (Windows-pasted content)", () => {
    const out = parseKeyValues("A: 1\r\nB: 2");
    expect(stripIds(out)).toEqual([
      { key: "A", value: "1", enabled: true },
      { key: "B", value: "2", enabled: true },
    ]);
  });

  it("prefers `:` over `=` when the key itself contains `=`", () => {
    // Regression: previously `body.search(/[:=]/)` took the leftmost of the
    // two separators, so `a=b: value` was parsed as `key="a"`, `value="b: value"`
    // — corrupting any form field whose name legitimately contained `=`.
    const out = parseKeyValues("a=b: value");
    expect(stripIds(out)).toEqual([
      { key: "a=b", value: "value", enabled: true },
    ]);
  });

  it("falls back to `=` only when there is no `:` on the line", () => {
    const out = parseKeyValues("foo=bar=baz");
    expect(stripIds(out)).toEqual([
      { key: "foo", value: "bar=baz", enabled: true },
    ]);
  });

  it("round-trips a key containing `=` without corrupting it", () => {
    const original: KeyValue[] = [
      { id: "a", key: "a=b", value: "value", enabled: true },
    ];
    const text = serializeKeyValues(original);
    const reparsed = parseKeyValues(text);
    expect(stripIds(reparsed)).toEqual(stripIds(original));
  });

  it("keeps `:` inside an `=`-separated value (e.g. a URL)", () => {
    // Regression for PR-D-1.1 first attempt: unconditionally preferring
    // `:` over `=` broke values like URLs that contain a `:` after the
    // `=` separator. Anchoring on `": "` (colon-space) avoids both pitfalls.
    const out = parseKeyValues("redirect_uri=https://example.com/callback");
    expect(stripIds(out)).toEqual([
      {
        key: "redirect_uri",
        value: "https://example.com/callback",
        enabled: true,
      },
    ]);
  });

  it("still parses `:` as separator when there is no space after it", () => {
    const out = parseKeyValues("Auth:Bearer abc");
    expect(stripIds(out)).toEqual([
      { key: "Auth", value: "Bearer abc", enabled: true },
    ]);
  });

  it("handles `key:` with no value (no space after colon)", () => {
    const out = parseKeyValues("X-Trailer:");
    expect(stripIds(out)).toEqual([
      { key: "X-Trailer", value: "", enabled: true },
    ]);
  });
});
