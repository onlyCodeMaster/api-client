import { describe, it, expect } from "vitest";
import { evaluateJsonPath } from "./jsonPath";

describe("evaluateJsonPath", () => {
  const fixture = {
    name: "root",
    items: [
      { id: 1, label: "first", tags: ["a", "b"] },
      { id: 2, label: "second", tags: ["c"] },
      { id: 3, label: "third", tags: [] },
    ],
    meta: { author: "alice", count: 3 },
  };

  it("returns the root for $", () => {
    expect(evaluateJsonPath(fixture, "$")).toBe(fixture);
  });

  it("returns root for an empty path", () => {
    expect(evaluateJsonPath(fixture, "")).toBe(fixture);
  });

  it("evaluates a simple property chain", () => {
    expect(evaluateJsonPath(fixture, "$.meta.author")).toBe("alice");
    expect(evaluateJsonPath(fixture, "$.meta.count")).toBe(3);
  });

  it("supports positive and negative array indexes", () => {
    expect(evaluateJsonPath(fixture, "$.items[0].id")).toBe(1);
    expect(evaluateJsonPath(fixture, "$.items[-1].label")).toBe("third");
  });

  it("supports quoted property segments for keys with awkward names", () => {
    const data = { "weird.key": { nested: 42 } };
    expect(evaluateJsonPath(data, '$["weird.key"].nested')).toBe(42);
    expect(evaluateJsonPath(data, "$['weird.key'].nested")).toBe(42);
  });

  it("expands wildcards across array members", () => {
    expect(evaluateJsonPath(fixture, "$.items[*].id")).toEqual([1, 2, 3]);
  });

  it("walks recursive descent collecting matching keys", () => {
    expect(evaluateJsonPath(fixture, "$..id")).toEqual([1, 2, 3]);
  });

  it("returns undefined when no nodes match", () => {
    expect(evaluateJsonPath(fixture, "$.nope")).toBeUndefined();
    expect(evaluateJsonPath(fixture, "$.items[99]")).toBeUndefined();
  });

  it("rejects paths that don't begin with $", () => {
    expect(() => evaluateJsonPath(fixture, "items[0]")).toThrow(
      /must start with \$/,
    );
  });

  it("rejects unsupported segments", () => {
    expect(() => evaluateJsonPath(fixture, "$.items[1:2]")).toThrow(
      /Unsupported JSONPath segment/,
    );
  });
});
