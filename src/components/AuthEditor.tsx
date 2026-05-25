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

const ALL: AuthConfig["auth_type"][] = ["inherit", "none", "bearer", "basic", "api_key"];

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
