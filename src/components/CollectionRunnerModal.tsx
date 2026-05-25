import { useState, useRef } from "react";
import { Play, X, Square, CheckCircle2, XCircle } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";
import { executeRequestWithScripts } from "../utils/requestPipeline";
import type {
  Collection,
  CollectionRequest,
  CollectionFolder,
  RequestItem,
  KeyValue,
  TestResult,
} from "../types";

interface RunResult {
  name: string;
  method: string;
  status?: number;
  timeMs?: number;
  tests: TestResult[];
  error?: string;
  iteration: number;
}

function genId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function emptyKV(): KeyValue {
  return { id: genId(), key: "", value: "", enabled: true };
}

function flattenRequests(col: Collection): CollectionRequest[] {
  const result: CollectionRequest[] = [...col.requests];
  function walk(folders: CollectionFolder[]) {
    for (const f of folders) {
      result.push(...f.requests);
      walk(f.folders);
    }
  }
  walk(col.folders);
  return result;
}

function colReqToRequestItem(
  req: CollectionRequest,
  collectionId: string
): RequestItem {
  return {
    id: req.id,
    name: req.name,
    method: req.method as RequestItem["method"],
    url: req.url,
    headers: req.headers.length > 0 ? req.headers : [emptyKV()],
    params: req.params.length > 0 ? req.params : [emptyKV()],
    body: req.body,
    bodyType: req.body_type as RequestItem["bodyType"],
    formData: [emptyKV()],
    auth: req.auth,
    preScript: req.pre_script,
    testScript: req.test_script,
    collectionId,
    protocol: "http",
    createdAt: req.created_at,
  };
}

interface Props {
  collectionId: string;
  onClose: () => void;
}

export function CollectionRunnerModal({ collectionId, onClose }: Props) {
  const { collections, environments, workspace, defaultTimeoutMs, verifyTlsDefault } =
    useRequestStore();

  const col = collections.find((c) => c.id === collectionId);

  const [iterations, setIterations] = useState(1);
  const [delayMs, setDelayMs] = useState(0);
  const [dataJson, setDataJson] = useState("");
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunResult[]>([]);
  const cancelRef = useRef(false);

  if (!col) return null;

  const requests = flattenRequests(col);

  const run = async () => {
    cancelRef.current = false;
    setRunning(true);
    setResults([]);

    // Parse data file (optional JSON array of records).
    let dataRows: Record<string, string>[] = [];
    if (dataJson.trim()) {
      try {
        const parsed = JSON.parse(dataJson.trim());
        if (Array.isArray(parsed)) {
          dataRows = parsed.map((r) => {
            const obj: Record<string, string> = {};
            for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
              obj[k] = String(v);
            }
            return obj;
          });
        }
      } catch {
        setResults([
          {
            name: "(data file)",
            method: "",
            error: "Invalid JSON data file",
            tests: [],
            iteration: 0,
          },
        ]);
        setRunning(false);
        return;
      }
    }
    const effectiveIterations = Math.max(iterations, dataRows.length || iterations);

    // Build initial environment vars.
    const activeEnvId = workspace?.active_environment_id;
    const activeEnv = activeEnvId
      ? environments.find((e) => e.id === activeEnvId)
      : undefined;

    for (let iter = 0; iter < effectiveIterations; iter++) {
      if (cancelRef.current) break;

      // Fresh env for each iteration.
      const envVars: Record<string, string> = {};
      if (activeEnv) {
        for (const v of activeEnv.variables) {
          if (v.enabled && v.key) envVars[v.key] = v.value;
        }
      }
      // Merge data row for this iteration.
      const dataRow = dataRows[iter] ?? {};
      const transientVars: Record<string, string> = { ...dataRow };

      for (const req of requests) {
        if (cancelRef.current) break;

        const requestItem = colReqToRequestItem(req, collectionId);
        const result = await executeRequestWithScripts({
          request: requestItem,
          collections,
          envVars,
          transientVars,
          defaults: { defaultTimeoutMs, verifyTlsDefault },
        });

        const entry: RunResult = {
          name: req.name || req.url,
          method: req.method,
          status: result.response?.status,
          timeMs: result.response?.time_ms,
          tests: result.tests,
          error: result.error || result.scriptError,
          iteration: iter + 1,
        };
        setResults((prev) => [...prev, entry]);

        if (delayMs > 0) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    setRunning(false);
  };

  const totalTests = results.reduce((s, r) => s + r.tests.length, 0);
  const passedTests = results.reduce(
    (s, r) => s + r.tests.filter((t) => t.passed).length,
    0
  );
  const failedTests = totalTests - passedTests;
  const erroredRequests = results.filter((r) => r.error).length;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-bg-primary border border-border rounded-apple shadow-xl w-[640px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-[13px] font-semibold text-text-primary">
            Run Collection: {col.name}
          </h2>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/5"
          >
            <X size={14} className="text-text-tertiary" />
          </button>
        </div>

        {/* Config */}
        <div className="px-4 py-3 border-b border-border space-y-2">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-[11px] text-text-secondary">
              Iterations
              <input
                type="number"
                min={1}
                max={1000}
                value={iterations}
                onChange={(e) => setIterations(Math.max(1, Number(e.target.value)))}
                disabled={running}
                className="w-16 input-apple text-[12px] px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-text-secondary">
              Delay (ms)
              <input
                type="number"
                min={0}
                step={100}
                value={delayMs}
                onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value)))}
                disabled={running}
                className="w-20 input-apple text-[12px] px-2 py-1"
              />
            </label>
          </div>
          <div>
            <label className="text-[11px] text-text-secondary block mb-1">
              Data (JSON array, optional)
            </label>
            <textarea
              value={dataJson}
              onChange={(e) => setDataJson(e.target.value)}
              disabled={running}
              rows={2}
              spellCheck={false}
              placeholder={'[{"token":"abc"},{"token":"xyz"}]'}
              className="w-full input-apple text-[11px] font-mono px-2 py-1.5 resize-none"
            />
          </div>
          <div className="flex items-center gap-2">
            {!running ? (
              <button
                onClick={run}
                disabled={requests.length === 0}
                className="btn-apple btn-apple-sm bg-accent text-white hover:bg-accent/90 flex items-center gap-1.5"
              >
                <Play size={12} />
                Run ({requests.length} requests)
              </button>
            ) : (
              <button
                onClick={() => {
                  cancelRef.current = true;
                }}
                className="btn-apple btn-apple-sm bg-error/10 text-error hover:bg-error/15 flex items-center gap-1.5"
              >
                <Square size={12} />
                Stop
              </button>
            )}
            {results.length > 0 && !running && (
              <span className="text-[11px] text-text-tertiary">
                {totalTests > 0 && (
                  <span>
                    {passedTests} passed, {failedTests} failed
                    {erroredRequests > 0 && `, ${erroredRequests} errored`}
                  </span>
                )}
                {totalTests === 0 && `${results.length} requests completed`}
              </span>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto px-4 py-2">
          {results.length === 0 && !running && (
            <p className="text-[12px] text-text-tertiary py-4 text-center">
              Configure and click Run to execute all requests sequentially.
            </p>
          )}
          {results.map((r, i) => (
            <div
              key={i}
              className="flex items-center gap-2 py-1.5 border-b border-border-light/40 last:border-b-0"
            >
              {r.error ? (
                <XCircle size={13} className="text-error shrink-0" />
              ) : r.tests.length > 0 && r.tests.every((t) => t.passed) ? (
                <CheckCircle2 size={13} className="text-success shrink-0" />
              ) : r.tests.some((t) => !t.passed) ? (
                <XCircle size={13} className="text-error shrink-0" />
              ) : (
                <CheckCircle2 size={13} className="text-text-tertiary shrink-0" />
              )}
              <span className="text-[11px] font-mono text-text-tertiary w-12 shrink-0">
                {r.method}
              </span>
              <span className="text-[12px] text-text-primary truncate flex-1">
                {r.name}
              </span>
              {r.status && (
                <span className="text-[11px] text-text-secondary">{r.status}</span>
              )}
              {r.timeMs !== undefined && (
                <span className="text-[11px] text-text-tertiary">{r.timeMs}ms</span>
              )}
              {iterations > 1 && (
                <span className="text-[10px] text-text-tertiary">#{r.iteration}</span>
              )}
              {r.error && (
                <span className="text-[11px] text-error truncate max-w-[150px]">
                  {r.error}
                </span>
              )}
            </div>
          ))}
          {running && (
            <div className="flex items-center gap-2 py-2">
              <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-[11px] text-text-tertiary">Running…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
