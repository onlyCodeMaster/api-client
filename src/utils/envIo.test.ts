import { describe, expect, it } from "vitest";
import { buildEnvironmentExport, parseImportFile } from "./envIo";

describe("buildEnvironmentExport", () => {
  it("strips unknown variable fields and stamps the schema version", () => {
    const out = buildEnvironmentExport("prod", [
      {
        key: "BASE_URL",
        value: "https://api.example.com",
        enabled: true,
        is_secret: false,
        // @ts-expect-error: simulating a stray field from older state
        extra: "ignored",
      },
    ]);

    expect(out).toEqual({
      schema: "api-client.env/v1",
      name: "prod",
      variables: [
        {
          key: "BASE_URL",
          value: "https://api.example.com",
          enabled: true,
          is_secret: false,
        },
      ],
    });
  });
});

describe("parseImportFile", () => {
  it("accepts the native single-env format", () => {
    const file = JSON.stringify({
      schema: "api-client.env/v1",
      name: "prod",
      variables: [
        { key: "A", value: "1", enabled: true, is_secret: false },
        { key: "B", value: "2", enabled: false, is_secret: true },
      ],
    });

    expect(parseImportFile(file)).toEqual([
      {
        name: "prod",
        variables: [
          { key: "A", value: "1", enabled: true, is_secret: false },
          { key: "B", value: "2", enabled: false, is_secret: true },
        ],
      },
    ]);
  });

  it("accepts a single Postman environment and maps `type: secret`", () => {
    const file = JSON.stringify({
      id: "uuid",
      name: "Staging",
      values: [
        { key: "URL", value: "https://staging", enabled: true, type: "default" },
        { key: "TOKEN", value: "xyz", enabled: true, type: "secret" },
        { key: "OFF", value: "0", enabled: false, type: "default" },
      ],
      _postman_variable_scope: "environment",
    });

    expect(parseImportFile(file)).toEqual([
      {
        name: "Staging",
        variables: [
          { key: "URL", value: "https://staging", enabled: true, is_secret: false },
          { key: "TOKEN", value: "xyz", enabled: true, is_secret: true },
          { key: "OFF", value: "0", enabled: false, is_secret: false },
        ],
      },
    ]);
  });

  it("accepts an array of native exports", () => {
    const file = JSON.stringify([
      {
        schema: "api-client.env/v1",
        name: "a",
        variables: [{ key: "X", value: "1", enabled: true, is_secret: false }],
      },
      {
        schema: "api-client.env/v1",
        name: "b",
        variables: [],
      },
    ]);

    const parsed = parseImportFile(file);
    expect(parsed.map((p) => p.name)).toEqual(["a", "b"]);
  });

  it("accepts a Postman `{environments: [...]}` collection export", () => {
    const file = JSON.stringify({
      environments: [
        {
          name: "prod",
          values: [{ key: "URL", value: "https://prod", enabled: true }],
        },
        {
          name: "dev",
          values: [{ key: "URL", value: "http://localhost", enabled: true }],
        },
      ],
    });

    const parsed = parseImportFile(file);
    expect(parsed.map((p) => p.name)).toEqual(["prod", "dev"]);
  });

  it("throws `invalid_json` for malformed input", () => {
    expect(() => parseImportFile("{not json")).toThrowError("invalid_json");
  });

  it("throws `unrecognised_format` for a structurally-wrong file", () => {
    expect(() =>
      parseImportFile(JSON.stringify({ hello: "world" })),
    ).toThrowError("unrecognised_format");
  });

  it("defaults `enabled` to true and `is_secret` to false on partial rows", () => {
    const file = JSON.stringify({
      name: "x",
      variables: [{ key: "A", value: "1" }],
    });

    expect(parseImportFile(file)).toEqual([
      {
        name: "x",
        variables: [{ key: "A", value: "1", enabled: true, is_secret: false }],
      },
    ]);
  });

  it("drops fully-empty variable rows on import", () => {
    const file = JSON.stringify({
      schema: "api-client.env/v1",
      name: "x",
      variables: [
        { key: "", value: "" },
        { key: "K", value: "V", enabled: true, is_secret: false },
      ],
    });

    const parsed = parseImportFile(file);
    expect(parsed[0].variables).toEqual([
      { key: "K", value: "V", enabled: true, is_secret: false },
    ]);
  });
});
