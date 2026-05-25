import type { ResponseData, ScriptLog, ScriptRunOutcome, TestResult } from "../types";

/** What the caller hands the runner. */
export interface ScriptRunInput {
  kind: "pre" | "test";
  source: string;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string;
  };
  response?: ResponseData;
  environment: Record<string, string>;
  variables: Record<string, string>;
  /** Wall-clock deadline in ms. Default 5000. */
  timeoutMs?: number;
}

/** What the runner returns. */
export interface ScriptRunResult extends ScriptRunOutcome {
  /** Final state of the env scope after mutations. */
  environment: Record<string, string>;
  /** Final state of the variable scope after mutations. */
  variables: Record<string, string>;
}

/**
 * Run a user script in a sandboxed Web Worker. The Worker is terminated
 * after `timeoutMs` so a malicious / buggy `while(true)` can't wedge the
 * UI thread.
 *
 * Trims down to a no-op result when `source` is empty so callers can
 * blindly invoke this without branching on "is there a script?".
 */
export async function runScript(input: ScriptRunInput): Promise<ScriptRunResult> {
  const trimmed = input.source.trim();
  if (!trimmed) {
    return {
      ok: true,
      tests: [],
      logs: [],
      environment: { ...input.environment },
      variables: { ...input.variables },
    };
  }

  const timeout = input.timeoutMs ?? 5000;
  // Built via Vite's worker import. The `?worker&inline` query yields a
  // constructor that ships the worker source inline in the main bundle —
  // simpler than a separate chunked file when the worker is small.
  const WorkerCtor = (await import("./scriptWorker.ts?worker&inline")).default;
  const worker = new WorkerCtor();

  return new Promise<ScriptRunResult>((resolve) => {
    let settled = false;
    const finish = (result: ScriptRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      worker.terminate();
      resolve(result);
    };

    const killTimer = setTimeout(() => {
      finish({
        ok: false,
        error: `Script exceeded ${timeout}ms and was terminated.`,
        tests: [],
        logs: [],
        environment: { ...input.environment },
        variables: { ...input.variables },
      });
    }, timeout);

    worker.onmessage = (e: MessageEvent<{
      ok: boolean;
      error?: string;
      tests: TestResult[];
      logs: ScriptLog[];
      environment: Record<string, string>;
      variables: Record<string, string>;
    }>) => {
      const m = e.data;
      finish({
        ok: m.ok,
        error: m.error,
        tests: m.tests,
        logs: m.logs,
        environment: m.environment,
        variables: m.variables,
      });
    };

    worker.onerror = (e: ErrorEvent) => {
      finish({
        ok: false,
        error: e.message || "Worker crashed",
        tests: [],
        logs: [],
        environment: { ...input.environment },
        variables: { ...input.variables },
      });
    };

    worker.postMessage({
      kind: input.kind,
      source: input.source,
      context: {
        request: input.request,
        response: input.response
          ? {
              status: input.response.status,
              statusText: input.response.status_text,
              headers: input.response.headers,
              body: input.response.body,
              bodyEncoding: input.response.body_encoding,
              timeMs: input.response.time_ms,
              sizeBytes: input.response.size_bytes,
            }
          : undefined,
        environment: input.environment,
        variables: input.variables,
      },
    });
  });
}
