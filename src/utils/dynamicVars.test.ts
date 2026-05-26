import { describe, it, expect } from "vitest";
import { resolveDynamic, substituteAll, listDynamicVarNames } from "./dynamicVars";

describe("resolveDynamic", () => {
  it("returns numeric timestamps", () => {
    const ts = resolveDynamic("timestamp");
    const tsMs = resolveDynamic("timestampMs");
    expect(/^\d+$/.test(ts)).toBe(true);
    expect(/^\d+$/.test(tsMs)).toBe(true);
    // ms timestamp should have ~3 more digits than seconds timestamp.
    expect(tsMs.length - ts.length).toBeGreaterThanOrEqual(2);
  });

  it("returns a parseable ISO timestamp", () => {
    const iso = resolveDynamic("isoTimestamp");
    expect(Number.isFinite(Date.parse(iso))).toBe(true);
  });

  it("returns RFC4122 UUIDs", () => {
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuidRe.test(resolveDynamic("guid"))).toBe(true);
    expect(uuidRe.test(resolveDynamic("randomUUID"))).toBe(true);
  });

  it("returns the original token unchanged for unknown generators", () => {
    expect(resolveDynamic("definitelyDoesNotExist")).toBe(
      "{{$definitelyDoesNotExist}}",
    );
  });

  it("lists generator names sorted", () => {
    const names = listDynamicVarNames();
    expect(names.length).toBeGreaterThan(5);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

describe("substituteAll", () => {
  it("resolves env-style variables via the lookup callback", () => {
    const out = substituteAll("Hello {{name}} from {{place}}", (k) =>
      k === "name" ? "Alice" : k === "place" ? "Earth" : undefined,
    );
    expect(out).toBe("Hello Alice from Earth");
  });

  it("leaves unresolved env tokens untouched", () => {
    const out = substituteAll("Hello {{missing}}", () => undefined);
    expect(out).toBe("Hello {{missing}}");
  });

  it("resolves dynamic ($-prefixed) tokens", () => {
    const out = substituteAll(
      "user_{{$randomInt}}@host",
      () => undefined,
    );
    expect(/^user_\d+@host$/.test(out)).toBe(true);
  });

  it("prefers dynamic generators over same-named env vars", () => {
    const out = substituteAll("{{$timestamp}}", (k) =>
      k === "$timestamp" ? "ENV_WINS" : undefined,
    );
    expect(out).not.toBe("ENV_WINS");
    expect(/^\d+$/.test(out)).toBe(true);
  });
});
