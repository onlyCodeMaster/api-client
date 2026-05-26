import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play, Square, Plus, Trash2, Copy, RefreshCw } from "lucide-react";
import type { KeyValue, MockRoute, MockServerStatus } from "../types";
import { useRequestStore } from "../store/useRequestStore";
import { KeyValueEditor } from "./KeyValueEditor";
import { CodeEditor } from "./CodeEditor";

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/** Tack a synthetic `id` onto every header row so KeyValueEditor can use it
 *  as a React key — the backend doesn't store ids on KeyValue. */
function hydrateHeaders(headers: KeyValue[] | undefined): KeyValue[] {
  if (!headers || headers.length === 0) {
    return [{ id: generateId(), key: "", value: "", enabled: true }];
  }
  return headers.map((h) => ({ ...h, id: (h as KeyValue).id ?? generateId() }));
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "*"];

export function MockServerPanel({ onClose }: { onClose: () => void }) {
  const workspace = useRequestStore((s) => s.workspace);
  const workspaceId = workspace?.id;

  const [status, setStatus] = useState<MockServerStatus>({ running: false });
  const [routes, setRoutes] = useState<MockRoute[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [port, setPort] = useState<string>("0");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        invoke<MockServerStatus>("mock_server_status"),
        invoke<MockRoute[]>("list_mock_routes", { workspaceId }),
      ]);
      setStatus(s);
      setRoutes(r);
      if (!selectedId && r.length > 0) setSelectedId(r[0].id);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, selectedId]);

  // Data-fetching effect: `refresh` issues async invoke() calls and then
  // calls setState with the result. This is the canonical effect-based fetch
  // pattern; the cascading-render warning doesn't apply because the setState
  // happens after the awaited fetch, not synchronously inside the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const selected = useMemo(
    () => routes.find((r) => r.id === selectedId) ?? null,
    [routes, selectedId],
  );

  const start = async () => {
    if (!workspaceId) return;
    setError(null);
    try {
      const p = Number.parseInt(port, 10);
      const actualPort = await invoke<number>("mock_server_start", {
        workspaceId,
        port: Number.isFinite(p) ? p : 0,
      });
      setStatus({ running: true, port: actualPort, workspace_id: workspaceId });
    } catch (e) {
      setError(String(e));
    }
  };

  const stop = async () => {
    setError(null);
    try {
      await invoke("mock_server_stop");
      setStatus({ running: false });
    } catch (e) {
      setError(String(e));
    }
  };

  const createRoute = async () => {
    if (!workspaceId) return;
    setError(null);
    const now = Date.now();
    const route: MockRoute = {
      id: generateId(),
      method: "GET",
      path: "/api/example",
      status: 200,
      headers: [],
      body: '{"ok": true}',
      enabled: true,
      created_at: now,
      updated_at: now,
    };
    try {
      const saved = await invoke<MockRoute>("save_mock_route", { workspaceId, route });
      setRoutes((prev) => [...prev, saved]);
      setSelectedId(saved.id);
    } catch (e) {
      setError(String(e));
    }
  };

  const duplicateRoute = async (route: MockRoute) => {
    if (!workspaceId) return;
    const now = Date.now();
    const copy: MockRoute = {
      ...route,
      id: generateId(),
      path: route.path + "-copy",
      created_at: now,
      updated_at: now,
    };
    try {
      const saved = await invoke<MockRoute>("save_mock_route", { workspaceId, route: copy });
      setRoutes((prev) => [...prev, saved]);
      setSelectedId(saved.id);
    } catch (e) {
      setError(String(e));
    }
  };

  const updateSelected = async (patch: Partial<MockRoute>) => {
    if (!workspaceId || !selected) return;
    const next: MockRoute = { ...selected, ...patch, updated_at: Date.now() };
    setRoutes((prev) => prev.map((r) => (r.id === next.id ? next : r)));
    try {
      await invoke("save_mock_route", { workspaceId, route: next });
    } catch (e) {
      setError(String(e));
    }
  };

  const deleteSelected = async () => {
    if (!workspaceId || !selected) return;
    if (!window.confirm(`Delete route "${selected.method} ${selected.path}"?`)) return;
    try {
      await invoke("delete_mock_route", { workspaceId, id: selected.id });
      setRoutes((prev) => prev.filter((r) => r.id !== selected.id));
      setSelectedId(routes.find((r) => r.id !== selected.id)?.id ?? null);
    } catch (e) {
      setError(String(e));
    }
  };

  const copyBaseUrl = () => {
    if (!status.port) return;
    const url = `http://127.0.0.1:${status.port}`;
    navigator.clipboard?.writeText(url).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex h-[85vh] w-[1100px] max-w-[95vw] flex-col overflow-hidden rounded-apple-lg bg-white shadow-xl dark:bg-neutral-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
          <div>
            <h2 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
              Mock Server
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Workspace: {workspace?.name ?? "—"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {status.running ? (
              <>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  Running on :{status.port}
                </span>
                <button
                  type="button"
                  onClick={copyBaseUrl}
                  className="rounded border border-neutral-300 p-1.5 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  title="Copy base URL"
                >
                  <Copy size={14} />
                </button>
                <button
                  type="button"
                  onClick={stop}
                  className="flex items-center gap-1 rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                >
                  <Square size={12} /> Stop
                </button>
              </>
            ) : (
              <>
                <input
                  type="text"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="0 (auto)"
                  className="w-20 rounded border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  title="Port (0 = pick a free port)"
                />
                <button
                  type="button"
                  onClick={start}
                  disabled={!workspaceId}
                  className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Play size={12} /> Start
                </button>
              </>
            )}
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="rounded border border-neutral-300 p-1.5 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="ml-2 rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            >
              Close
            </button>
          </div>
        </div>

        {error && (
          <div className="border-b border-red-200 bg-red-50 px-5 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {/* Route list */}
          <div className="flex w-72 flex-col border-r border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
              <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Routes ({routes.length})
              </span>
              <button
                type="button"
                onClick={createRoute}
                className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
              >
                <Plus size={12} /> New
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {routes.length === 0 && (
                <div className="px-3 py-4 text-xs text-neutral-500 dark:text-neutral-400">
                  No routes yet. Click "New" to create one.
                </div>
              )}
              {routes.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedId(r.id)}
                  className={`flex w-full items-center gap-2 border-b border-neutral-100 px-3 py-2 text-left text-xs hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800 ${
                    selectedId === r.id ? "bg-blue-50 dark:bg-blue-950/40" : ""
                  }`}
                >
                  <span
                    className={`min-w-[3.5rem] rounded px-1.5 py-0.5 text-center text-[10px] font-bold ${methodColor(r.method)}`}
                  >
                    {r.method}
                  </span>
                  <span className="flex-1 truncate font-mono text-neutral-800 dark:text-neutral-200">
                    {r.path}
                  </span>
                  {!r.enabled && (
                    <span className="text-[10px] uppercase text-neutral-400">off</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Editor */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
            {selected ? (
              <RouteEditor
                key={selected.id}
                route={selected}
                onChange={updateSelected}
                onDelete={deleteSelected}
                onDuplicate={() => duplicateRoute(selected)}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">
                Select a route or create a new one.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function methodColor(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
    case "POST":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
    case "PUT":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
    case "PATCH":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300";
    case "DELETE":
      return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
    case "*":
      return "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200";
    default:
      return "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";
  }
}

interface RouteEditorProps {
  route: MockRoute;
  onChange: (patch: Partial<MockRoute>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

function RouteEditor({ route, onChange, onDelete, onDuplicate }: RouteEditorProps) {
  const [headers, setHeaders] = useState<KeyValue[]>(hydrateHeaders(route.headers));

  // When the user picks a different route, re-hydrate from the new value.
  // Uses the React-recommended "compare previous value during render" pattern
  // instead of useEffect to avoid a render-then-render cascade.
  const [prevRouteId, setPrevRouteId] = useState(route.id);
  if (route.id !== prevRouteId) {
    setPrevRouteId(route.id);
    setHeaders(hydrateHeaders(route.headers));
  }

  const commitHeaders = (next: KeyValue[]) => {
    setHeaders(next);
    onChange({ headers: next.filter((h) => h.key.trim().length > 0) });
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-xs font-medium text-neutral-700 dark:text-neutral-300">
          <input
            type="checkbox"
            checked={route.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
          />
          Enabled
        </label>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onDuplicate}
          className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1 rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>

      <div className="flex gap-2">
        <select
          value={route.method}
          onChange={(e) => onChange({ method: e.target.value })}
          className="w-24 rounded border border-neutral-300 px-2 py-1.5 text-xs font-medium dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={route.path}
          onChange={(e) => onChange({ path: e.target.value })}
          placeholder="/api/users/:id"
          className="flex-1 rounded border border-neutral-300 px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
            Status code
          </span>
          <input
            type="number"
            value={route.status}
            onChange={(e) => onChange({ status: Number.parseInt(e.target.value, 10) || 200 })}
            className="rounded border border-neutral-300 px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
            Delay (ms)
          </span>
          <input
            type="number"
            value={route.delay_ms ?? ""}
            onChange={(e) => {
              const v = e.target.value.trim();
              onChange({ delay_ms: v === "" ? undefined : Number.parseInt(v, 10) || 0 });
            }}
            placeholder="0"
            className="rounded border border-neutral-300 px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </label>
      </div>

      <div className="space-y-1">
        <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
          Response headers
        </span>
        <KeyValueEditor
          items={headers}
          onChange={commitHeaders}
          keyPlaceholder="Header"
          valuePlaceholder="Value"
          reorderable={false}
        />
      </div>

      <div className="space-y-1">
        <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
          Response body
        </span>
        <CodeEditor
          value={route.body}
          onChange={(v) => onChange({ body: v })}
          language="json"
          height={200}
          placeholder='{"hello": "world"}'
        />
      </div>
    </div>
  );
}
