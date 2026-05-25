/**
 * Sandbox Web Worker that evaluates user-supplied pre-request / test scripts.
 *
 * Why a Worker:
 *  - Isolates user code from the main thread (no DOM, no Tauri APIs, no
 *    window). The user can still spin forever; the main thread terminates
 *    the worker after the timeout in `scriptRunner.ts`.
 *  - Postman-flavoured `pm.*` API surface so existing Postman tests/scripts
 *    can be copy-pasted with minimal edits.
 *
 * Limitations (intentional, documented for users):
 *  - No `fetch`/`XMLHttpRequest` (Worker has these but we don't expose them
 *    on `pm`; the user can still call them directly via globals — that's
 *    their choice and stays in-worker).
 *  - No filesystem / Tauri access.
 *  - `setTimeout` exists in the Worker but the runner's deadline will kill
 *    the worker anyway.
 *
 * The protocol is one message in, one message out:
 *  IN:  { kind: "pre" | "test", source, context }
 *  OUT: { ok, error?, environment, variables, tests, logs }
 */

interface WorkerInMessage {
  kind: "pre" | "test";
  source: string;
  context: {
    request: {
      method: string;
      url: string;
      headers: Record<string, string>;
      body: string;
    };
    response?: {
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: string;
      bodyEncoding: "text" | "base64";
      timeMs: number;
      sizeBytes: number;
    };
    environment: Record<string, string>;
    variables: Record<string, string>;
  };
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

interface ScriptLog {
  level: "log" | "warn" | "error";
  args: string[];
}

interface WorkerOutMessage {
  ok: boolean;
  error?: string;
  environment: Record<string, string>;
  variables: Record<string, string>;
  tests: TestResult[];
  logs: ScriptLog[];
}

// ---- Sandbox `pm` API factory ------------------------------------------------

function buildPm(msg: WorkerInMessage, out: WorkerOutMessage) {
  const env = { ...msg.context.environment };
  const vars = { ...msg.context.variables };

  const expect = (actual: unknown) => {
    const chain = {
      to: {} as Record<string, unknown>,
    };
    // `.to.equal(x)` — strict equality.
    chain.to.equal = (expected: unknown) => {
      if (actual !== expected) {
        throw new Error(`expected ${JSON.stringify(actual)} to equal ${JSON.stringify(expected)}`);
      }
    };
    // `.to.eql(x)` — deep equality via JSON canonicalization.
    chain.to.eql = (expected: unknown) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`expected ${JSON.stringify(actual)} to deeply equal ${JSON.stringify(expected)}`);
      }
    };
    // `.to.have.status(n)` — Postman style on a response.
    chain.to.have = {
      status: (code: number) => {
        const r = actual as { status?: number };
        if (!r || r.status !== code) {
          throw new Error(`expected status ${code}, got ${r?.status}`);
        }
      },
      property: (key: string) => {
        if (!actual || typeof actual !== "object" || !(key in (actual as object))) {
          throw new Error(`expected object to have property "${key}"`);
        }
      },
    };
    // `.to.include(x)` — substring or member.
    chain.to.include = (expected: unknown) => {
      if (typeof actual === "string" && typeof expected === "string") {
        if (!actual.includes(expected)) {
          throw new Error(`expected "${actual}" to include "${expected}"`);
        }
        return;
      }
      if (Array.isArray(actual)) {
        if (!actual.includes(expected)) {
          throw new Error(`expected array to include ${JSON.stringify(expected)}`);
        }
        return;
      }
      throw new Error("include() only supports strings and arrays");
    };
    // `.to.be.ok` / `.to.be.true` / etc.
    chain.to.be = {
      ok: () => {
        if (!actual) throw new Error(`expected ${JSON.stringify(actual)} to be truthy`);
      },
      true: () => {
        if (actual !== true) throw new Error(`expected ${JSON.stringify(actual)} to be true`);
      },
      false: () => {
        if (actual !== false) throw new Error(`expected ${JSON.stringify(actual)} to be false`);
      },
      a: (type: string) => {
        const t = Array.isArray(actual) ? "array" : typeof actual;
        if (t !== type) throw new Error(`expected ${t} to be a ${type}`);
      },
    };
    chain.to.match = (re: RegExp) => {
      if (typeof actual !== "string" || !re.test(actual)) {
        throw new Error(`expected "${actual}" to match ${re}`);
      }
    };
    return chain;
  };

  const pm: Record<string, unknown> = {
    request: msg.context.request,
    environment: {
      get: (k: string) => env[k],
      set: (k: string, v: string) => {
        env[k] = String(v);
      },
      unset: (k: string) => {
        delete env[k];
      },
      has: (k: string) => k in env,
      toObject: () => ({ ...env }),
    },
    variables: {
      get: (k: string) => vars[k],
      set: (k: string, v: string) => {
        vars[k] = String(v);
      },
      unset: (k: string) => {
        delete vars[k];
      },
      has: (k: string) => k in vars,
      toObject: () => ({ ...vars }),
    },
    expect,
  };

  if (msg.kind === "test" && msg.context.response) {
    const r = msg.context.response;
    let cachedJson: unknown = undefined;
    let cachedJsonError: Error | null = null;
    pm.response = {
      ...r,
      // `pm.response.json()` parses the body once (matches Postman).
      json: () => {
        if (cachedJson !== undefined) return cachedJson;
        if (cachedJsonError) throw cachedJsonError;
        try {
          cachedJson = JSON.parse(r.body);
          return cachedJson;
        } catch (e) {
          cachedJsonError = e as Error;
          throw e;
        }
      },
      text: () => r.body,
      // `.to.have.status(...)` works on response, too.
      get status() {
        return r.status;
      },
    };
    pm.test = (name: string, fn: () => void) => {
      try {
        fn();
        out.tests.push({ name, passed: true });
      } catch (e) {
        out.tests.push({ name, passed: false, error: (e as Error).message });
      }
    };
  } else {
    // Pre-request scripts get a no-op pm.test so shared snippets don't
    // explode when run pre-flight.
    pm.test = () => {};
  }

  // Snapshot end state so we can ship mutations back.
  pm.__capture = () => {
    out.environment = env;
    out.variables = vars;
  };

  return pm;
}

// ---- Console capture ---------------------------------------------------------

function buildConsole(out: WorkerOutMessage) {
  const stringify = (v: unknown) => {
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  };
  const make = (level: "log" | "warn" | "error") =>
    (...args: unknown[]) => {
      out.logs.push({ level, args: args.map(stringify) });
    };
  return { log: make("log"), warn: make("warn"), error: make("error") };
}

// ---- Worker entrypoint -------------------------------------------------------

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;
  const out: WorkerOutMessage = {
    ok: false,
    environment: { ...msg.context.environment },
    variables: { ...msg.context.variables },
    tests: [],
    logs: [],
  };

  try {
    const pm = buildPm(msg, out);
    const sandboxedConsole = buildConsole(out);
    // Use AsyncFunction so user scripts can `await` async tasks (e.g.
    // fetch, timers). The runner will terminate this Worker if the
    // returned promise outlives the deadline.
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction("pm", "console", msg.source);
    Promise.resolve(fn(pm, sandboxedConsole))
      .then(() => {
        (pm.__capture as () => void)();
        out.ok = true;
        (self as unknown as Worker).postMessage(out);
      })
      .catch((err: Error) => {
        (pm.__capture as () => void)();
        out.error = err.message || String(err);
        (self as unknown as Worker).postMessage(out);
      });
  } catch (e) {
    out.error = (e as Error).message || String(e);
    (self as unknown as Worker).postMessage(out);
  }
};
