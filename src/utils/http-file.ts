import type {
  Collection,
  CollectionRequest,
  KeyValue,
} from "../types";

function genId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function emptyKV(): KeyValue {
  return { id: genId(), key: "", value: "", enabled: true };
}

/**
 * Parse a `.http` / `.rest` file as used by JetBrains HTTP Client and the
 * VS Code REST Client extension.
 *
 * Format (simplified):
 *
 *   ### Optional request name (separator between requests)
 *   # @name explicit-name           // optional name directive
 *   GET https://example.com/users
 *   Authorization: Bearer xxx
 *   X-Header: value
 *
 *   { "body": "goes here" }
 *
 *   ### Next request
 *   POST https://example.com/posts
 *   ...
 *
 * Lines starting with `#` (other than `###` separators and `# @name`) are
 * treated as comments. The blank line between headers and body is optional;
 * any line that doesn't look like a header after the request line is treated
 * as the start of the body.
 */
export function httpFileToCollection(source: string, name = "HTTP File Import"): Collection {
  const now = Date.now();
  const blocks = splitBlocks(source);
  const requests: CollectionRequest[] = [];

  for (const block of blocks) {
    const req = parseBlock(block, now);
    if (req) requests.push(req);
  }

  return {
    id: genId(),
    name,
    description: `Imported ${requests.length} request(s) from .http file.`,
    requests,
    folders: [],
    created_at: now,
    updated_at: now,
  };
}

function splitBlocks(source: string): string[] {
  const lines = source.split(/\r?\n/);
  const blocks: string[] = [];
  let buf: string[] = [];
  for (const line of lines) {
    if (/^###\s*/.test(line)) {
      if (buf.length > 0) blocks.push(buf.join("\n"));
      buf = [line];
    } else {
      buf.push(line);
    }
  }
  if (buf.length > 0) blocks.push(buf.join("\n"));
  return blocks.filter((b) => b.trim().length > 0);
}

function parseBlock(block: string, now: number): CollectionRequest | null {
  const lines = block.split("\n");
  let name: string | null = null;
  let method = "";
  let url = "";
  const headers: KeyValue[] = [];
  const bodyLines: string[] = [];

  let phase: "preamble" | "headers" | "body" = "preamble";

  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    if (phase === "preamble") {
      if (/^###/.test(line)) {
        const m = line.match(/^###\s*(.*)$/);
        if (m && m[1].trim()) name = m[1].trim();
        continue;
      }
      const nameDirective = line.match(/^#\s*@name\s+(.+)$/);
      if (nameDirective) {
        name = nameDirective[1].trim();
        continue;
      }
      if (/^#/.test(line) || line.trim() === "") continue;
      // First non-comment, non-blank line is the request line.
      const reqMatch = line.match(/^([A-Z]+)\s+(.+)$/);
      if (!reqMatch) return null;
      method = reqMatch[1];
      url = reqMatch[2].trim();
      phase = "headers";
      continue;
    }

    if (phase === "headers") {
      if (line.trim() === "") {
        phase = "body";
        continue;
      }
      if (/^#/.test(line)) continue;
      const hMatch = line.match(/^([^:\s][^:]*):\s*(.*)$/);
      if (hMatch) {
        headers.push({
          id: genId(),
          key: hMatch[1].trim(),
          value: hMatch[2].trim(),
          enabled: true,
        });
      } else {
        // Not a header — assume the body started without a blank line.
        phase = "body";
        bodyLines.push(line);
      }
      continue;
    }

    if (phase === "body") {
      bodyLines.push(line);
    }
  }

  if (!method || !url) return null;
  if (headers.length === 0) headers.push(emptyKV());

  const body = bodyLines.join("\n").replace(/^\s+|\s+$/g, "");
  let bodyType: CollectionRequest["body_type"] = "none";
  if (body) {
    const ct = headers.find((h) => h.key.toLowerCase() === "content-type")?.value.toLowerCase() || "";
    if (ct.includes("json") || body.trimStart().startsWith("{") || body.trimStart().startsWith("[")) {
      bodyType = "json";
    } else if (ct.includes("xml")) {
      bodyType = "xml";
    } else {
      bodyType = "text";
    }
  }

  return {
    id: genId(),
    name: name || `${method} ${shortenUrl(url)}`,
    method,
    url,
    headers,
    params: [emptyKV()],
    body,
    body_type: bodyType,
    auth: { auth_type: "inherit" },
    created_at: now,
    updated_at: now,
  };
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    return url;
  }
}
