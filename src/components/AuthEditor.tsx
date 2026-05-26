import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Loader2, AlertTriangle } from "lucide-react";
import type { AuthConfig } from "../types";

interface Props {
  value: AuthConfig | undefined;
  onChange: (next: AuthConfig) => void;
  /**
   * Available auth strategies. The default omits `"inherit"` because most
   * scopes (collection root, top-level requests) have nothing to inherit
   * from. Pass `allowInherit` when this editor is bound to a request that
   * lives inside a collection/folder.
   */
  allowInherit?: boolean;
  /**
   * Human-readable description of what `"inherit"` resolves to right now,
   * shown under the inherit option. Optional.
   */
  inheritedFrom?: string | null;
}

const ALL: AuthConfig["auth_type"][] = ["inherit", "none", "bearer", "basic", "api_key", "oauth2", "sigv4"];

export function AuthEditor({ value, onChange, allowInherit, inheritedFrom }: Props) {
  const current: AuthConfig = value || { auth_type: allowInherit ? "inherit" : "none" };
  const types = allowInherit ? ALL : ALL.filter((t) => t !== "inherit");

  return (
    <div className="space-y-3">
      <div className="segmented-control">
        {types.map((type) => (
          <button
            key={type}
            onClick={() => onChange({ ...current, auth_type: type })}
            className={`segment ${current.auth_type === type ? "segment-active" : ""}`}
          >
            {type === "api_key"
              ? "API Key"
              : type === "oauth2"
              ? "OAuth 2"
              : type === "sigv4"
              ? "AWS SigV4"
              : type === "none"
              ? "None"
              : type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {current.auth_type === "inherit" && (
        <p className="text-[12px] text-text-tertiary">
          {inheritedFrom
            ? `Inherits authentication from ${inheritedFrom}.`
            : "Inherits authentication from this request's parent folder or collection. Configure auth on the collection (right-click → Edit auth) to use this."}
        </p>
      )}

      {current.auth_type === "bearer" && (
        <div className="space-y-2">
          <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Token</label>
          <input
            type="text"
            value={current.bearer_token || ""}
            onChange={(e) => onChange({ ...current, bearer_token: e.target.value })}
            placeholder="Enter bearer token..."
            className="input-apple w-full font-mono text-[12px]"
            spellCheck={false}
          />
        </div>
      )}

      {current.auth_type === "basic" && (
        <div className="space-y-2">
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Username</label>
            <input
              type="text"
              value={current.basic_username || ""}
              onChange={(e) => onChange({ ...current, basic_username: e.target.value })}
              placeholder="Username"
              className="input-apple w-full text-[12px] mt-1"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Password</label>
            <input
              type="password"
              value={current.basic_password || ""}
              onChange={(e) => onChange({ ...current, basic_password: e.target.value })}
              placeholder="Password"
              className="input-apple w-full text-[12px] mt-1"
            />
          </div>
        </div>
      )}

      {current.auth_type === "api_key" && (
        <div className="space-y-2">
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Key</label>
            <input
              type="text"
              value={current.api_key_key || ""}
              onChange={(e) => onChange({ ...current, api_key_key: e.target.value })}
              placeholder="X-API-Key"
              className="input-apple w-full text-[12px] mt-1"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Value</label>
            <input
              type="text"
              value={current.api_key_value || ""}
              onChange={(e) => onChange({ ...current, api_key_value: e.target.value })}
              placeholder="your-api-key"
              className="input-apple w-full font-mono text-[12px] mt-1"
              spellCheck={false}
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Add to</label>
            <div className="segmented-control mt-1">
              <button
                onClick={() => onChange({ ...current, api_key_in: "header" })}
                className={`segment ${(current.api_key_in || "header") === "header" ? "segment-active" : ""}`}
              >
                Header
              </button>
              <button
                onClick={() => onChange({ ...current, api_key_in: "query" })}
                className={`segment ${current.api_key_in === "query" ? "segment-active" : ""}`}
              >
                Query Param
              </button>
            </div>
          </div>
        </div>
      )}

      {current.auth_type === "oauth2" && (
        <OAuth2Editor value={current} onChange={onChange} />
      )}

      {current.auth_type === "sigv4" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Access Key ID</label>
              <input
                type="text"
                value={current.aws_access_key_id || ""}
                onChange={(e) => onChange({ ...current, aws_access_key_id: e.target.value })}
                placeholder="AKIA..."
                className="input-apple w-full font-mono text-[12px] mt-1"
                spellCheck={false}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Secret Access Key</label>
              <input
                type="password"
                value={current.aws_secret_access_key || ""}
                onChange={(e) => onChange({ ...current, aws_secret_access_key: e.target.value })}
                placeholder="secret"
                className="input-apple w-full font-mono text-[12px] mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Region</label>
              <input
                type="text"
                value={current.aws_region || ""}
                onChange={(e) => onChange({ ...current, aws_region: e.target.value })}
                placeholder="us-east-1"
                className="input-apple w-full font-mono text-[12px] mt-1"
                spellCheck={false}
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Service</label>
              <input
                type="text"
                value={current.aws_service || ""}
                onChange={(e) => onChange({ ...current, aws_service: e.target.value })}
                placeholder="execute-api / s3 / dynamodb"
                className="input-apple w-full font-mono text-[12px] mt-1"
                spellCheck={false}
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Session Token (optional)</label>
            <input
              type="password"
              value={current.aws_session_token || ""}
              onChange={(e) => onChange({ ...current, aws_session_token: e.target.value })}
              placeholder="STS session token — leave blank for long-lived credentials"
              className="input-apple w-full font-mono text-[12px] mt-1"
            />
          </div>
          <p className="text-[10px] text-text-tertiary leading-relaxed">
            Signing happens client-side on every Send. form-data bodies are signed with UNSIGNED-PAYLOAD
            (works for S3 and API Gateway over HTTPS).
          </p>
        </div>
      )}

      {current.auth_type === "none" && (
        <p className="text-[12px] text-text-tertiary">
          {allowInherit
            ? "This request explicitly opts out of inherited authentication."
            : "No authentication is configured."}
        </p>
      )}
    </div>
  );
}

function OAuth2Editor({
  value,
  onChange,
}: {
  value: AuthConfig;
  onChange: (next: AuthConfig) => void;
}) {
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchOk, setFetchOk] = useState(false);
  // Drive "expired" state off a tick that updates once a minute, instead of
  // calling Date.now() in render (which violates react-hooks purity and
  // produces non-deterministic renders).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const grant = value.oauth2_grant_type || "client_credentials";
  const clientAuth = value.oauth2_client_auth || "basic";

  const hasToken = !!value.oauth2_access_token;
  const expiresAt = value.oauth2_token_expires_at;
  const isExpired = expiresAt != null && expiresAt < now;
  const tokenStatus = !hasToken
    ? null
    : isExpired
    ? "expired"
    : expiresAt != null
    ? `valid until ${new Date(expiresAt).toLocaleString()}`
    : "no expiry reported";

  const fetchToken = async () => {
    setFetching(true);
    setFetchError(null);
    setFetchOk(false);
    try {
      const resp = await invoke<{ access_token: string; expires_at: number | null }>(
        "oauth2_fetch_token",
        {
          request: {
            grant_type: grant,
            token_url: value.oauth2_token_url || "",
            client_id: value.oauth2_client_id || "",
            client_secret: value.oauth2_client_secret || "",
            scope: value.oauth2_scope || null,
            client_auth: clientAuth,
            username: grant === "password" ? value.oauth2_username || "" : null,
            password: grant === "password" ? value.oauth2_password || "" : null,
            insecure: false,
          },
        }
      );
      onChange({
        ...value,
        oauth2_access_token: resp.access_token,
        oauth2_token_expires_at: resp.expires_at ?? undefined,
      });
      setFetchOk(true);
    } catch (err) {
      setFetchError(String(err));
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="space-y-2">
      <div>
        <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Grant Type</label>
        <div className="segmented-control mt-1">
          <button
            onClick={() => onChange({ ...value, oauth2_grant_type: "client_credentials" })}
            className={`segment ${grant === "client_credentials" ? "segment-active" : ""}`}
          >
            Client Credentials
          </button>
          <button
            onClick={() => onChange({ ...value, oauth2_grant_type: "password" })}
            className={`segment ${grant === "password" ? "segment-active" : ""}`}
          >
            Password
          </button>
        </div>
      </div>

      <div>
        <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Token URL</label>
        <input
          type="text"
          value={value.oauth2_token_url || ""}
          onChange={(e) => onChange({ ...value, oauth2_token_url: e.target.value })}
          placeholder="https://auth.example.com/oauth/token"
          className="input-apple w-full font-mono text-[12px] mt-1"
          spellCheck={false}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Client ID</label>
          <input
            type="text"
            value={value.oauth2_client_id || ""}
            onChange={(e) => onChange({ ...value, oauth2_client_id: e.target.value })}
            placeholder="client id"
            className="input-apple w-full text-[12px] mt-1 font-mono"
            spellCheck={false}
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Client Secret</label>
          <input
            type="password"
            value={value.oauth2_client_secret || ""}
            onChange={(e) => onChange({ ...value, oauth2_client_secret: e.target.value })}
            placeholder="client secret"
            className="input-apple w-full text-[12px] mt-1 font-mono"
          />
        </div>
      </div>

      {grant === "password" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Username</label>
            <input
              type="text"
              value={value.oauth2_username || ""}
              onChange={(e) => onChange({ ...value, oauth2_username: e.target.value })}
              placeholder="username"
              className="input-apple w-full text-[12px] mt-1"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Password</label>
            <input
              type="password"
              value={value.oauth2_password || ""}
              onChange={(e) => onChange({ ...value, oauth2_password: e.target.value })}
              placeholder="password"
              className="input-apple w-full text-[12px] mt-1"
            />
          </div>
        </div>
      )}

      <div>
        <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Scope</label>
        <input
          type="text"
          value={value.oauth2_scope || ""}
          onChange={(e) => onChange({ ...value, oauth2_scope: e.target.value })}
          placeholder="read write (space-separated)"
          className="input-apple w-full font-mono text-[12px] mt-1"
          spellCheck={false}
        />
      </div>

      <div>
        <label className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">Client Auth Method</label>
        <div className="segmented-control mt-1">
          <button
            onClick={() => onChange({ ...value, oauth2_client_auth: "basic" })}
            className={`segment ${clientAuth === "basic" ? "segment-active" : ""}`}
            title="HTTP Basic auth header (RFC 6749 §2.3.1 preferred)"
          >
            Basic auth header
          </button>
          <button
            onClick={() => onChange({ ...value, oauth2_client_auth: "body" })}
            className={`segment ${clientAuth === "body" ? "segment-active" : ""}`}
            title="client_id / client_secret in form body"
          >
            Request body
          </button>
        </div>
      </div>

      <div className="pt-2 border-t border-border-light">
        <button
          type="button"
          onClick={fetchToken}
          disabled={fetching}
          className="px-3 py-1.5 text-[12px] bg-accent text-white rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {fetching ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              Fetching…
            </>
          ) : (
            <>Fetch Token</>
          )}
        </button>

        {fetchError && (
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-error">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            <span className="break-words">{fetchError}</span>
          </div>
        )}

        {fetchOk && !fetchError && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-success">
            <Check size={11} />
            <span>Token fetched.</span>
          </div>
        )}

        {hasToken && (
          <div className="mt-2 text-[11px] text-text-tertiary">
            Cached token: <span className={isExpired ? "text-error" : "text-text-secondary"}>{tokenStatus}</span>
            {" — "}
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  oauth2_access_token: "",
                  oauth2_token_expires_at: undefined,
                })
              }
              className="text-accent hover:underline"
            >
              clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
