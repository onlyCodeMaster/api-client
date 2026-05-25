import { useState, useMemo } from "react";
import { Copy, Check, ArrowUpRight, Search, X } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";

type ResponseTab = "body" | "headers";

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

export function ResponsePanel() {
  const [activeTab, setActiveTab] = useState<ResponseTab>("body");
  const [copied, setCopied] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { response, loading, error } = useRequestStore();

  const formattedBody = useMemo(() => {
    if (!response?.body) return "";
    return isJson(response.body) ? tryFormatJson(response.body) : response.body;
  }, [response?.body]);

  const bodyIsJson = useMemo(() => response ? isJson(response.body) : false, [response?.body]);

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
          </div>
          <button
            onClick={() => setSearchOpen((s) => !s)}
            className={`ml-1.5 w-7 h-7 flex items-center justify-center rounded-lg transition-colors ${searchOpen ? "bg-accent/15" : "hover:bg-black/5"}`}
            title="Search in response"
          >
            <Search size={14} className={searchOpen ? "text-accent" : "text-text-tertiary"} />
          </button>
          <button
            onClick={copyBody}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/5 active:bg-black/8 transition-colors"
            title="Copy response"
          >
            {copied ? <Check size={14} className="text-success" /> : <Copy size={14} className="text-text-tertiary" />}
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
        {activeTab === "body" && (
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
      </div>
    </div>
  );
}
