/**
 * Minimal JSONPath evaluator covering the common subset used in API
 * tooling. Not a full spec implementation — intentionally small so we
 * don't pull a parser dep.
 *
 * Supported syntax:
 *   $                root
 *   .foo / ["foo"]   property access (quoted form supports keys with dots)
 *   [0]              numeric index
 *   [-1]             last element (negative index)
 *   [*]              wildcard over array or object values
 *   ..foo            recursive descent matching key "foo"
 *
 * Returns the matched value when the path resolves to a single node, an
 * array of matches for `[*]` / `..` paths, or `undefined` if nothing
 * matched.
 */
export function evaluateJsonPath(root: unknown, path: string): unknown {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "$") return root;
  if (!trimmed.startsWith("$")) {
    throw new Error("JSONPath must start with $");
  }

  const tokens = tokenize(trimmed.slice(1));
  let frontier: unknown[] = [root];

  for (const tok of tokens) {
    const next: unknown[] = [];
    for (const node of frontier) {
      next.push(...applyToken(node, tok));
    }
    frontier = next;
    if (frontier.length === 0) return undefined;
  }

  if (frontier.length === 1) return frontier[0];
  return frontier;
}

type Token =
  | { kind: "prop"; key: string }
  | { kind: "index"; idx: number }
  | { kind: "wildcard" }
  | { kind: "recursive"; key: string | null };

function tokenize(rest: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < rest.length) {
    const c = rest[i];
    if (c === ".") {
      if (rest[i + 1] === ".") {
        // recursive descent: ..key or ..*
        i += 2;
        if (rest[i] === "*") {
          tokens.push({ kind: "recursive", key: null });
          i += 1;
        } else {
          const key = readIdentifier(rest, i);
          tokens.push({ kind: "recursive", key: key.value });
          i = key.next;
        }
        continue;
      }
      i += 1;
      if (rest[i] === "*") {
        tokens.push({ kind: "wildcard" });
        i += 1;
      } else {
        const id = readIdentifier(rest, i);
        tokens.push({ kind: "prop", key: id.value });
        i = id.next;
      }
      continue;
    }
    if (c === "[") {
      const close = rest.indexOf("]", i);
      if (close < 0) throw new Error("Unterminated [ in JSONPath");
      const inner = rest.slice(i + 1, close).trim();
      if (inner === "*") {
        tokens.push({ kind: "wildcard" });
      } else if (
        (inner.startsWith('"') && inner.endsWith('"')) ||
        (inner.startsWith("'") && inner.endsWith("'"))
      ) {
        tokens.push({ kind: "prop", key: inner.slice(1, -1) });
      } else if (/^-?\d+$/.test(inner)) {
        tokens.push({ kind: "index", idx: parseInt(inner, 10) });
      } else {
        throw new Error(`Unsupported JSONPath segment: [${inner}]`);
      }
      i = close + 1;
      continue;
    }
    throw new Error(`Unexpected character in JSONPath at ${i}: ${c}`);
  }
  return tokens;
}

function readIdentifier(s: string, start: number): { value: string; next: number } {
  let end = start;
  while (end < s.length && /[A-Za-z0-9_\-$]/.test(s[end])) end += 1;
  if (end === start) throw new Error(`Expected identifier at ${start}`);
  return { value: s.slice(start, end), next: end };
}

function applyToken(node: unknown, tok: Token): unknown[] {
  if (node === null || node === undefined) return [];
  switch (tok.kind) {
    case "prop": {
      if (typeof node === "object" && !Array.isArray(node)) {
        const v = (node as Record<string, unknown>)[tok.key];
        return v === undefined ? [] : [v];
      }
      return [];
    }
    case "index": {
      if (Array.isArray(node)) {
        const i = tok.idx < 0 ? node.length + tok.idx : tok.idx;
        if (i < 0 || i >= node.length) return [];
        return [node[i]];
      }
      return [];
    }
    case "wildcard": {
      if (Array.isArray(node)) return [...node];
      if (typeof node === "object") return Object.values(node as Record<string, unknown>);
      return [];
    }
    case "recursive": {
      const out: unknown[] = [];
      walk(node, (n) => {
        if (tok.key === null) {
          // ..* — every descendant value
          if (typeof n === "object" && n !== null) {
            if (Array.isArray(n)) out.push(...n);
            else out.push(...Object.values(n as Record<string, unknown>));
          }
        } else {
          if (typeof n === "object" && n !== null && !Array.isArray(n)) {
            const obj = n as Record<string, unknown>;
            if (Object.prototype.hasOwnProperty.call(obj, tok.key)) {
              out.push(obj[tok.key]);
            }
          }
        }
      });
      return out;
    }
  }
}

function walk(node: unknown, visit: (n: unknown) => void): void {
  visit(node);
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
  } else if (typeof node === "object") {
    for (const child of Object.values(node as Record<string, unknown>)) {
      walk(child, visit);
    }
  }
}
