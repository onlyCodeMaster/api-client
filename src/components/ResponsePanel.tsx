import { useState, useMemo } from "react";
import { Copy, Check, ArrowUpRight, Search, X, Download, AlertTriangle, FileQuestion, GitCompare, ListTree, FileCode2 } from "lucide-react";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { JsonView, defaultStyles, darkStyles } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";
import { useDarkMode } from "../utils/useDarkMode";
import { useRequestStore } from "../store/useRequestStore";
import { ResponseDiffModal } from "./ResponseDiffModal";

type ResponseTab = "body" | "headers" | "tests";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getStatusStyle(status: number): string {
  if (status >= 200 && status < 300) return "text-success bg-success/10";
  if (status >= 300 && status < 400) return "text-teal bg-teal/10";
  if (status >= 400 && status < 500) return "text-orange bg-orange/10";
  return "text-error bg-error/10";
}

function tryFormatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

// Lightweight JSON syntax highlighter (no external dependency)
function highlightJson(json: string): React.ReactNode[] {
  const lines = json.split("\n");
  return lines.map((line, i) => {
    const parts: React.ReactNode[] = [];
    let remaining = line;
    let key = 0;

    // Match JSON tokens
    const regex = /("(?:\\.|[^"\\])*")\s*(:)?|(\b(?:true|false|null)\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(remaining)) !== null) {
      // Text before match
      if (match.index > lastIndex) {
        parts.push(<span key={key++}>{remaining.slice(lastIndex, match.index)}</span>);
      }

      if (match[1] && match[2]) {
        // Key
        parts.push(<span key={key++} className="text-accent">{match[1]}</span>);
        parts.push(<span key={key++}>{match[2]}</span>);
      } else if (match[1]) {
        // String value
        parts.push(<span key={key++} className="text-success">{match[1]}</span>);
      } else if (match[3]) {
        // Boolean / null
        parts.push(<span key={key++} className="text-orange">{match[3]}</span>);
      } else if (match[4]) {
        // Number
        parts.push(<span key={key++} className="text-purple">{match[4]}</span>);
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < remaining.length) {
      parts.push(<span key={key++}>{remaining.slice(lastIndex)}</span>);
    }

    return (
      <div key={i} className="leading-[1.65]">
        {parts.length > 0 ? parts : " "}
      </div>
    );
  });
}

function isJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

function extractMime(headers: Record<string, string>): string {
  const ct =
    headers["content-type"] ||
    headers["Content-Type"] ||
    Object.entries(headers).find(([k]) => k.toLowerCase() === "content-type")?.[1] ||
    "";
  return ct.split(";")[0].trim().toLowerCase();
}

function defaultFileName(url: string, mime: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (last && last.includes(".")) return last;
  } catch {}
  const ext = mime.split("/")[1] || "bin";
  return `response.${ext.replace(/\+.*$/, "")}`;
}

/// Render the first N bytes of a base64-encoded body as a classic hex dump.
function hexDump(base64: string, maxBytes = 4096): string {
  let bytes: Uint8Array;
  try {
    const bin = atob(base64);
    bytes = new Uint8Array(Math.min(bin.length, maxBytes));
    for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return "(invalid base64 body)";
  }
  const lines: string[] = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const chunk = bytes.slice(off, off + 16);
    const hex = Array.from(chunk)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ")
      .padEnd(16 * 3 - 1, " ");
    const ascii = Array.from(chunk)
      .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "."))
      .join("");
    lines.push(`${off.toString(16).padStart(8, "0")}  ${hex}  ${ascii}`);
  }
  return lines.join("\n");
}

export function ResponsePanel() {
  const [activeTab, setActiveTab] = useState<ResponseTab>("body");
  const [copied, setCopied] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [diffOpen, setDiffOpen] = useState(false);
  // Body view mode: raw pretty-printed text (default) or interactive JSON
  // tree. Only meaningful when the body is valid JSON; for everything else
  // we fall back to raw regardless of this setting.
  const [bodyView, setBodyView] = useState<"raw" | "tree">("raw");
  const { response, loading, error, activeRequest, testResults, scriptLogs, scriptError, responseHistory } = useRequestStore();
  const snapshots = activeRequest ? responseHistory[activeRequest.id] ?? [] : [];
  const canDiff = snapshots.length >= 2;

  const tests = activeRequest ? testResults[activeRequest.id] ?? null : null;
  const logs = activeRequest ? scriptLogs[activeRequest.id] ?? null : null;
  const sErr = activeRequest ? scriptError[activeRequest.id] ?? null : null;
  const passedCount = tests ? tests.filter((t) => t.passed).length : 0;
  const failedCount = tests ? tests.length - passedCount : 0;

  const isBinary = response?.body_encoding === "base64";
  const mime = useMemo(() => (response ? extractMime(response.headers) : ""), [response]);

  const formattedBody = useMemo(() => {
    if (!response?.body || isBinary) return "";
    return isJson(response.body) ? tryFormatJson(response.body) : response.body;
  }, [response?.body, isBinary]);

  const bodyIsJson = useMemo(
    () => (response && !isBinary ? isJson(response.body) : false),
    [response?.body, isBinary]
  );

  // Parsed JSON value for the tree view. Kept separate from `bodyIsJson`
  // so we don't pay the parse cost again if the user is just looking at
  // the raw body.
  const parsedJson = useMemo(() => {
    if (!bodyIsJson || !response?.body) return undefined;
    try {
      return JSON.parse(response.body) as unknown;
    } catch {
      return undefined;
    }
  }, [bodyIsJson, response?.body]);

  // Pick the JSON tree theme that follows the app's current light/dark
  // setting. `useDarkMode` subscribes to the `.dark` class on the document
  // root so we re-render and swap styles when the user toggles the theme.
  const isDark = useDarkMode();
  const treeStyles = isDark ? darkStyles : defaultStyles;

  const highlightedSearchBody = useMemo(() => {
    if (!searchQuery || !formattedBody) return null;
    const lines = formattedBody.split("\n");
    return lines.map((line, i) => {
      if (!line.toLowerCase().includes(searchQuery.toLowerCase())) {
        return <div key={i} className="leading-[1.65]">{line || " "}</div>;
      }
      const parts: React.ReactNode[] = [];
      let remaining = line;
      const lowerQuery = searchQuery.toLowerCase();
      let key = 0;
      while (remaining.length > 0) {
        const idx = remaining.toLowerCase().indexOf(lowerQuery);
        if (idx === -1) {
          parts.push(<span key={key++}>{remaining}</span>);
          break;
        }
        if (idx > 0) parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>);
        parts.push(
          <mark key={key++} className="bg-warning/40 text-text-primary rounded-sm px-0.5">
            {remaining.slice(idx, idx + searchQuery.length)}
          </mark>
        );
        remaining = remaining.slice(idx + searchQuery.length);
      }
      return <div key={i} className="leading-[1.65]">{parts}</div>;
    });
  }, [searchQuery, formattedBody]);

  const copyBody = async () => {
    if (response?.body) {
      await navigator.clipboard.writeText(response.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const saveResponseToDisk = async () => {
    if (!response) return;
    const suggested = defaultFileName(activeRequest?.url || "", mime);
    const path = await saveFileDialog({ defaultPath: suggested });
    if (!path) return;
    // When the body was truncated for display, ask the backend to write the
    // full cached bytes from the most recent send. Otherwise just write the
    // bytes we already have in the frontend.
    await invoke("save_response_to_file", {
      path,
      body: response.body,
      encoding: response.body_encoding,
      requestId: activeRequest?.id,
      useCached: response.body_truncated,
    });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-[13px] text-text-tertiary">Sending…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="bg-error/5 rounded-apple p-4 max-w-md text-center">
          <p className="text-error font-medium text-[13px] mb-1">Request Failed</p>
          <p className="text-text-secondary text-[12px] leading-relaxed">{error}</p>
        </div>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <ArrowUpRight size={32} className="mx-auto text-text-tertiary/50 mb-3" strokeWidth={1.5} />
          <p className="text-text-tertiary text-[13px]">Send a request to see the response</p>
          <p className="text-text-tertiary/70 text-[11px] mt-1.5">
            Press <kbd className="px-1.5 py-0.5 bg-surface-secondary rounded-md text-text-secondary text-[10px] font-mono">⏎</kbd> to send
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center gap-2.5 px-4 py-2.5">
        <span className={`px-2 py-[3px] rounded-md text-[11px] font-semibold ${getStatusStyle(response.status)}`}>
          {response.status} {response.status_text}
        </span>
        <span className="text-[11px] text-text-tertiary">{response.time_ms} ms</span>
        <span className="text-[11px] text-text-tertiary">·</span>
        <span className="text-[11px] text-text-tertiary">{formatSize(response.size_bytes)}</span>

        <div className="ml-auto flex items-center gap-1">
          <div className="segmented-control">
            <button
              onClick={() => setActiveTab("body")}
              className={`segment ${activeTab === "body" ? "segment-active" : ""}`}
            >
              Body
            </button>
            <button
              onClick={() => setActiveTab("headers")}
              className={`segment ${activeTab === "headers" ? "segment-active" : ""}`}
            >
              Headers
              <span className="ml-1 text-[10px] text-text-tertiary">
                {Object.keys(response.headers).length}
              </span>
            </button>
            {(tests !== null || sErr !== null || (logs && logs.length > 0)) && (
              <button
                onClick={() => setActiveTab("tests")}
                className={`segment ${activeTab === "tests" ? "segment-active" : ""}`}
              >
                Tests
                {tests && tests.length > 0 && (
                  <span
                    className={`ml-1 text-[10px] ${
                      failedCount > 0 ? "text-error" : "text-success"
                    }`}
                  >
                    {failedCount > 0
                      ? `${failedCount}/${tests.length} failed`
                      : `${passedCount}/${tests.length} passed`}
                  </span>
                )}
              </button>
            )}
          </div>
          {activeTab === "body" && bodyIsJson && (
            <button
              onClick={() => setBodyView((v) => (v === "raw" ? "tree" : "raw"))}
              className={`ml-1.5 w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${bodyView === "tree" ? "bg-accent/15" : "hover:bg-black/5"}`}
              title={bodyView === "tree" ? "Show raw JSON" : "Show JSON tree"}
            >
              {bodyView === "tree" ? (
                <FileCode2 size={14} className="text-accent" />
              ) : (
                <ListTree size={14} className="text-text-tertiary" />
              )}
            </button>
          )}
          <button
            onClick={() => setSearchOpen((s) => !s)}
            className={`ml-1.5 w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${searchOpen ? "bg-accent/15" : "hover:bg-black/5"}`}
            title="Search in response"
          >
            <Search size={14} className={searchOpen ? "text-accent" : "text-text-tertiary"} />
          </button>
          <button
            onClick={() => setDiffOpen(true)}
            disabled={!canDiff}
            className={`w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${canDiff ? "hover:bg-black/5 active:bg-black/8" : "opacity-40 cursor-not-allowed"}`}
            title={canDiff ? `Compare with previous responses (${snapshots.length} captured)` : "Need 2+ responses to diff"}
          >
            <GitCompare size={14} className="text-text-tertiary" />
          </button>
          <button
            onClick={copyBody}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/5 active:bg-black/8 transition-colors"
            title="Copy response"
          >
            {copied ? <Check size={14} className="text-success" /> : <Copy size={14} className="text-text-tertiary" />}
          </button>
          <button
            onClick={saveResponseToDisk}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/5 active:bg-black/8 transition-colors"
            title="Save response to file"
          >
            {savedFlash ? <Check size={14} className="text-success" /> : <Download size={14} className="text-text-tertiary" />}
          </button>
        </div>
      </div>

      {/* Search bar */}
      {searchOpen && activeTab === "body" && (
        <div className="px-4 pb-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in response body..."
              autoFocus
              className="input-apple w-full text-[12px] py-[5px] pl-8 pr-7"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 pb-4">
        {activeTab === "body" && response.body_truncated && (
          <div className="mb-2 flex items-center gap-2 text-[11px] text-warning bg-warning/10 rounded-apple px-2.5 py-1.5">
            <AlertTriangle size={12} />
            Response was truncated for display ({formatSize(response.size_bytes)}). Use
            <button onClick={saveResponseToDisk} className="underline hover:no-underline">Save</button>
            to get the full body.
          </div>
        )}
        {activeTab === "body" && isBinary && mime.startsWith("image/") && (
          <div className="flex items-center justify-center bg-surface-secondary rounded-apple p-3">
            <img
              src={`data:${mime};base64,${response.body}`}
              alt="response"
              className="max-w-full max-h-[480px] object-contain"
            />
          </div>
        )}
        {activeTab === "body" && isBinary && mime === "application/pdf" && (
          <iframe
            title="PDF preview"
            src={`data:application/pdf;base64,${response.body}`}
            className="w-full h-[640px] bg-surface-secondary rounded-apple"
          />
        )}
        {activeTab === "body" && isBinary && !mime.startsWith("image/") && mime !== "application/pdf" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
              <FileQuestion size={12} />
              Binary response ({mime || "unknown type"}, {formatSize(response.size_bytes)}). Hex dump of
              first 4&thinsp;KiB:
            </div>
            <pre className="text-[11px] font-mono text-text-primary whitespace-pre leading-[1.55] bg-surface-secondary rounded-apple p-3 overflow-auto">
              {hexDump(response.body)}
            </pre>
          </div>
        )}
        {activeTab === "body" && !isBinary && bodyView === "tree" && bodyIsJson && parsedJson !== undefined && (
          <div className="text-[12px] font-mono bg-surface-secondary rounded-apple p-3 overflow-auto json-tree-host">
            <JsonView
              data={parsedJson as object}
              clickToExpandNode
              shouldExpandNode={(level) => level < 2}
              style={treeStyles}
            />
          </div>
        )}
        {activeTab === "body" && !isBinary && (bodyView === "raw" || !bodyIsJson || parsedJson === undefined) && (
          <pre className="text-[12px] font-mono text-text-primary whitespace-pre-wrap break-all leading-[1.65] bg-surface-secondary rounded-apple p-3">
            {searchQuery
              ? highlightedSearchBody
              : bodyIsJson
              ? highlightJson(formattedBody)
              : formattedBody}
          </pre>
        )}
        {activeTab === "headers" && (
          <div className="bg-surface-secondary rounded-apple overflow-hidden">
            {Object.entries(response.headers).map(([key, value], i) => (
              <div
                key={key}
                className={`flex gap-4 px-3 py-2 ${i !== Object.entries(response.headers).length - 1 ? "border-b border-border-light/60" : ""}`}
              >
                <span className="text-[12px] font-medium text-accent shrink-0 w-44 truncate">
                  {key}
                </span>
                <span className="text-[12px] text-text-secondary break-all">{value}</span>
              </div>
            ))}
          </div>
        )}
        {activeTab === "tests" && (
          <div className="space-y-3">
            {sErr && (
              <div className="bg-error/5 text-error rounded-apple px-3 py-2 text-[12px]">
                {sErr}
              </div>
            )}
            {tests && tests.length > 0 && (
              <div className="bg-surface-secondary rounded-apple overflow-hidden">
                {tests.map((t, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 px-3 py-2 ${
                      i !== tests.length - 1 ? "border-b border-border-light/60" : ""
                    }`}
                  >
                    <span
                      className={`mt-0.5 inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                        t.passed ? "bg-success" : "bg-error"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-[12px] ${
                          t.passed ? "text-text-primary" : "text-error"
                        }`}
                      >
                        {t.name}
                      </div>
                      {!t.passed && t.error && (
                        <div className="text-[11px] text-text-tertiary font-mono mt-0.5 break-words">
                          {t.error}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {tests && tests.length === 0 && !sErr && (
              <p className="text-[12px] text-text-tertiary">
                Test script ran without recording any assertions.
              </p>
            )}
            {logs && logs.length > 0 && (
              <div>
                <div className="text-[11px] font-medium text-text-secondary uppercase tracking-wider mb-1.5">
                  Console
                </div>
                <pre className="text-[11px] font-mono whitespace-pre-wrap bg-surface-secondary rounded-apple p-3">
                  {logs
                    .map(
                      (l) =>
                        `${l.level === "error" ? "✕" : l.level === "warn" ? "!" : "›"} ${l.args.join(" ")}`
                    )
                    .join("\n")}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
      {diffOpen && (
        <ResponseDiffModal
          snapshots={snapshots}
          onClose={() => setDiffOpen(false)}
        />
      )}
    </div>
  );
}
