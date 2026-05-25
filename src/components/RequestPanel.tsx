import { useState, useRef, useEffect } from "react";
import { Send, XCircle, Copy, FileDown, Check } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";
import { KeyValueEditor } from "./KeyValueEditor";
import { exportCurl, parseCurl } from "../utils/curl";
import type { HttpMethod } from "../types";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "text-success",
  POST: "text-orange",
  PUT: "text-accent",
  PATCH: "text-purple",
  DELETE: "text-error",
  HEAD: "text-text-secondary",
  OPTIONS: "text-text-secondary",
};

type RequestTab = "params" | "headers" | "body" | "auth";

export function RequestPanel() {
  const [activeTab, setActiveTab] = useState<RequestTab>("params");
  const {
    activeRequest,
    loading,
    setMethod,
    setUrl,
    setHeaders,
    setParams,
    setBody,
    setBodyType,
    setFormData,
    setAuth,
    setName,
    sendRequest,
    cancelRequest,
  } = useRequestStore();

  const urlRef = useRef<HTMLInputElement>(null);
  const [showCurlImport, setShowCurlImport] = useState(false);
  const [curlInput, setCurlInput] = useState("");
  const [curlCopied, setCurlCopied] = useState(false);

  useEffect(() => {
    urlRef.current?.focus();
  }, [activeRequest?.id]);

  if (!activeRequest) return null;

  const tabs: { id: RequestTab; label: string }[] = [
    { id: "params", label: "Params" },
    { id: "headers", label: "Headers" },
    { id: "body", label: "Body" },
    { id: "auth", label: "Auth" },
  ];

  const paramCount = activeRequest.params.filter((p) => p.key).length;
  const headerCount = activeRequest.headers.filter((h) => h.key).length;
  const currentAuth = activeRequest.auth || { auth_type: "none" as const };

  return (
    <div className="flex flex-col h-full">
      {/* Request Name + cURL buttons */}
      <div className="px-4 pt-3 pb-0 flex items-center gap-2">
        <input
          type="text"
          value={activeRequest.name}
          onChange={(e) => setName(e.target.value)}
          className="text-[13px] text-text-secondary bg-transparent border-0 outline-none flex-1 px-0 py-0.5 placeholder-text-tertiary focus:text-text-primary transition-colors"
          placeholder="Request name..."
        />
        <button
          onClick={() => {
            const curl = exportCurl(activeRequest);
            navigator.clipboard.writeText(curl);
            setCurlCopied(true);
            setTimeout(() => setCurlCopied(false), 2000);
          }}
          className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent transition-colors shrink-0"
          title="Copy as cURL"
        >
          {curlCopied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          cURL
        </button>
        <button
          onClick={() => setShowCurlImport(true)}
          className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent transition-colors shrink-0"
          title="Import from cURL"
        >
          <FileDown size={12} />
          Import
        </button>
      </div>

      {/* cURL Import Modal */}
      {showCurlImport && (
        <div className="px-4 pt-2 pb-1">
          <div className="bg-surface-secondary rounded-apple p-3 space-y-2">
            <textarea
              value={curlInput}
              onChange={(e) => setCurlInput(e.target.value)}
              placeholder={'Paste cURL command here...\ncurl -X POST https://api.example.com -H "Content-Type: application/json" -d \'{"key":"value"}\'  '}
              className="input-apple w-full h-20 font-mono text-[11px] resize-none leading-relaxed"
              spellCheck={false}
              autoFocus
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => { setShowCurlImport(false); setCurlInput(""); }}
                className="text-[11px] text-text-tertiary hover:text-text-secondary px-2 py-1"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (curlInput.trim()) {
                    const parsed = parseCurl(curlInput);
                    useRequestStore.getState().updateActiveRequest(parsed);
                  }
                  setShowCurlImport(false);
                  setCurlInput("");
                }}
                className="text-[11px] text-accent font-medium px-3 py-1 bg-accent/10 rounded-md hover:bg-accent/20 transition-colors"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* URL Bar */}
      <div className="flex items-center gap-2 px-4 py-3">
        <select
          value={activeRequest.method}
          onChange={(e) => setMethod(e.target.value as HttpMethod)}
          className={`input-apple font-semibold w-[100px] ${METHOD_COLORS[activeRequest.method]}`}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        <input
          ref={urlRef}
          type="text"
          value={activeRequest.url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendRequest();
          }}
          placeholder="https://api.example.com/endpoint"
          className="input-apple flex-1"
        />

        {loading ? (
          <button
            onClick={cancelRequest}
            className="px-4 py-2 bg-error text-white font-medium rounded-apple text-[13px] hover:bg-error/90 active:scale-[0.97] transition-all shadow-apple-sm flex items-center gap-1.5"
          >
            <XCircle size={14} />
            Cancel
          </button>
        ) : (
          <button
            onClick={sendRequest}
            disabled={!activeRequest.url}
            className="btn-send flex items-center gap-1.5"
          >
            <Send size={14} />
            Send
          </button>
        )}
      </div>

      {/* Segmented Tabs */}
      <div className="px-4 pb-3">
        <div className="segmented-control">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`segment ${activeTab === tab.id ? "segment-active" : ""}`}
            >
              {tab.label}
              {tab.id === "params" && paramCount > 0 && (
                <span className="ml-1 text-[10px] text-accent">{paramCount}</span>
              )}
              {tab.id === "headers" && headerCount > 0 && (
                <span className="ml-1 text-[10px] text-accent">{headerCount}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {activeTab === "params" && (
          <KeyValueEditor
            items={activeRequest.params}
            onChange={setParams}
            keyPlaceholder="Parameter"
            valuePlaceholder="Value"
          />
        )}

        {activeTab === "headers" && (
          <KeyValueEditor
            items={activeRequest.headers}
            onChange={setHeaders}
            keyPlaceholder="Header"
            valuePlaceholder="Value"
          />
        )}

        {activeTab === "body" && (
          <div className="space-y-3">
            <div className="segmented-control">
              {(["none", "json", "text", "xml", "form-data"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setBodyType(type)}
                  className={`segment ${activeRequest.bodyType === type ? "segment-active" : ""}`}
                >
                  {type === "form-data" ? "Form" : type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
            {activeRequest.bodyType === "form-data" && (
              <KeyValueEditor
                items={activeRequest.formData}
                onChange={setFormData}
                keyPlaceholder="Field name"
                valuePlaceholder="Value"
              />
            )}
            {activeRequest.bodyType !== "none" && activeRequest.bodyType !== "form-data" && (
              <textarea
                value={activeRequest.body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={
                  activeRequest.bodyType === "json"
                    ? '{\n  "key": "value"\n}'
                    : "Enter request body..."
                }
                className="input-apple w-full h-40 font-mono text-[12px] resize-none leading-relaxed"
                spellCheck={false}
              />
            )}
          </div>
        )}

        {activeTab === "auth" && (
          <div className="space-y-3">
            <div className="segmented-control">
              {(["none", "bearer", "basic", "api_key"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setAuth({ ...currentAuth, auth_type: type })}
                  className={`segment ${currentAuth.auth_type === type ? "segment-active" : ""}`}
                >
                  {type === "api_key" ? "API Key" : type === "none" ? "None" : type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>

            {currentAuth.auth_type === "bearer" && (
              <div className="space-y-2">
                <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Token</label>
                <input
                  type="text"
                  value={currentAuth.bearer_token || ""}
                  onChange={(e) => setAuth({ ...currentAuth, bearer_token: e.target.value })}
                  placeholder="Enter bearer token..."
                  className="input-apple w-full font-mono text-[12px]"
                  spellCheck={false}
                />
              </div>
            )}

            {currentAuth.auth_type === "basic" && (
              <div className="space-y-2">
                <div>
                  <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Username</label>
                  <input
                    type="text"
                    value={currentAuth.basic_username || ""}
                    onChange={(e) => setAuth({ ...currentAuth, basic_username: e.target.value })}
                    placeholder="Username"
                    className="input-apple w-full text-[12px] mt-1"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Password</label>
                  <input
                    type="password"
                    value={currentAuth.basic_password || ""}
                    onChange={(e) => setAuth({ ...currentAuth, basic_password: e.target.value })}
                    placeholder="Password"
                    className="input-apple w-full text-[12px] mt-1"
                  />
                </div>
              </div>
            )}

            {currentAuth.auth_type === "api_key" && (
              <div className="space-y-2">
                <div>
                  <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Key</label>
                  <input
                    type="text"
                    value={currentAuth.api_key_key || ""}
                    onChange={(e) => setAuth({ ...currentAuth, api_key_key: e.target.value })}
                    placeholder="X-API-Key"
                    className="input-apple w-full text-[12px] mt-1"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Value</label>
                  <input
                    type="text"
                    value={currentAuth.api_key_value || ""}
                    onChange={(e) => setAuth({ ...currentAuth, api_key_value: e.target.value })}
                    placeholder="your-api-key"
                    className="input-apple w-full font-mono text-[12px] mt-1"
                    spellCheck={false}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Add to</label>
                  <div className="segmented-control mt-1">
                    <button
                      onClick={() => setAuth({ ...currentAuth, api_key_in: "header" })}
                      className={`segment ${(currentAuth.api_key_in || "header") === "header" ? "segment-active" : ""}`}
                    >
                      Header
                    </button>
                    <button
                      onClick={() => setAuth({ ...currentAuth, api_key_in: "query" })}
                      className={`segment ${currentAuth.api_key_in === "query" ? "segment-active" : ""}`}
                    >
                      Query Param
                    </button>
                  </div>
                </div>
              </div>
            )}

            {currentAuth.auth_type === "none" && (
              <p className="text-[12px] text-text-tertiary">
                This request does not use any authorization.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
