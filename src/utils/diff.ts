/**
 * Minimal line-based diff used by the response Diff panel.
 *
 * Implements the standard Myers/LCS algorithm to produce an ordered list of
 * `equal | added | removed` chunks. We deliberately avoid pulling in a heavy
 * diff library (like `diff` or `diff-match-patch`) because the inputs here are
 * always small response bodies (<= a few hundred KB after the size cap from
 * PR2) and we only need block-level granularity for display, not patching.
 */

export type DiffOp = "equal" | "added" | "removed";

export interface DiffLine {
  op: DiffOp;
  /** Line number in the "left" (old) text; undefined when op === "added". */
  leftNo?: number;
  /** Line number in the "right" (new) text; undefined when op === "removed". */
  rightNo?: number;
  text: string;
}

/** Split a string into lines, preserving empty trailing line semantics. */
function splitLines(s: string): string[] {
  if (s === "") return [];
  return s.split(/\r?\n/);
}

/**
 * Build the LCS length table for two arrays of strings.
 *
 * Returns a `(m+1) x (n+1)` matrix where `lcs[i][j]` is the length of the
 * longest common subsequence of `a[0..i]` and `b[0..j]`.
 */
function buildLcs(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }
  return lcs;
}

/** Walk the LCS table backwards to emit a chronological list of diff ops. */
export function diffLines(leftText: string, rightText: string): DiffLine[] {
  const a = splitLines(leftText);
  const b = splitLines(rightText);
  const lcs = buildLcs(a, b);

  const out: DiffLine[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push({ op: "equal", leftNo: i, rightNo: j, text: a[i - 1] });
      i--;
      j--;
    } else if (lcs[i - 1][j] >= lcs[i][j - 1]) {
      out.push({ op: "removed", leftNo: i, text: a[i - 1] });
      i--;
    } else {
      out.push({ op: "added", rightNo: j, text: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    out.push({ op: "removed", leftNo: i, text: a[i - 1] });
    i--;
  }
  while (j > 0) {
    out.push({ op: "added", rightNo: j, text: b[j - 1] });
    j--;
  }
  return out.reverse();
}

/** Diff helper for header maps: returns added / removed / changed keys. */
export interface HeaderDiff {
  added: Array<{ key: string; value: string }>;
  removed: Array<{ key: string; value: string }>;
  changed: Array<{ key: string; left: string; right: string }>;
}

export function diffHeaders(
  left: Record<string, string>,
  right: Record<string, string>
): HeaderDiff {
  const added: HeaderDiff["added"] = [];
  const removed: HeaderDiff["removed"] = [];
  const changed: HeaderDiff["changed"] = [];

  for (const [k, v] of Object.entries(right)) {
    if (!(k in left)) {
      added.push({ key: k, value: v });
    } else if (left[k] !== v) {
      changed.push({ key: k, left: left[k], right: v });
    }
  }
  for (const [k, v] of Object.entries(left)) {
    if (!(k in right)) {
      removed.push({ key: k, value: v });
    }
  }
  return { added, removed, changed };
}
