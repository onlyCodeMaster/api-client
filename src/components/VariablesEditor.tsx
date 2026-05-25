import { useState } from "react";
import { Plus, Trash2, Eye, EyeOff } from "lucide-react";
import type { EnvVariable } from "../types";

/**
 * Tabular editor for a list of `EnvVariable`. Mirrors `EnvironmentPanel`'s
 * row layout (enabled checkbox, key, value, secret toggle, delete) but is
 * decoupled from environment storage so it can be reused for collection-
 * and workspace-scoped variable lists.
 */
export function VariablesEditor({
  value,
  onChange,
  emptyHint,
}: {
  value: EnvVariable[];
  onChange: (next: EnvVariable[]) => void;
  emptyHint?: string;
}) {
  const update = (i: number, partial: Partial<EnvVariable>) => {
    const next = value.map((v, idx) => (idx === i ? { ...v, ...partial } : v));
    onChange(next);
  };
  const remove = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i));
  };
  const add = () => {
    onChange([
      ...value,
      { key: "", value: "", enabled: true, is_secret: false },
    ]);
  };

  return (
    <div className="space-y-1.5">
      {value.length === 0 && (
        <p className="text-[11px] text-text-tertiary italic">
          {emptyHint ?? "No variables yet."}
        </p>
      )}
      {value.map((variable, i) => (
        <VariableRow
          key={i}
          variable={variable}
          onChange={(partial) => update(i, partial)}
          onDelete={() => remove(i)}
        />
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1 text-[11px] text-accent hover:text-accent-hover mt-2"
      >
        <Plus size={11} />
        Add variable
      </button>
    </div>
  );
}

function VariableRow({
  variable,
  onChange,
  onDelete,
}: {
  variable: EnvVariable;
  onChange: (partial: Partial<EnvVariable>) => void;
  onDelete: () => void;
}) {
  const [showValue, setShowValue] = useState(!variable.is_secret);

  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={variable.enabled}
        onChange={(e) => onChange({ enabled: e.target.checked })}
        className="w-3.5 h-3.5 rounded accent-accent"
      />
      <input
        type="text"
        value={variable.key}
        onChange={(e) => onChange({ key: e.target.value })}
        placeholder="VARIABLE_NAME"
        className="input-apple flex-1 text-[11px] py-[4px] font-mono"
      />
      <div className="relative flex-1">
        <input
          type={showValue ? "text" : "password"}
          value={variable.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="value"
          className="input-apple w-full text-[11px] py-[4px] font-mono pr-7"
        />
        <button
          onClick={() => setShowValue(!showValue)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
          type="button"
        >
          {showValue ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
      </div>
      <button
        type="button"
        onClick={() => onChange({ is_secret: !variable.is_secret })}
        className={`text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors ${
          variable.is_secret
            ? "bg-warning/15 text-warning"
            : "bg-surface-secondary text-text-tertiary"
        }`}
        title={variable.is_secret ? "Secret (stored in Keychain)" : "Plain text"}
      >
        {variable.is_secret ? "🔒" : "Aa"}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="p-1 hover:bg-error/10 rounded transition-colors"
        title="Delete variable"
      >
        <Trash2 size={11} className="text-error/70" />
      </button>
    </div>
  );
}
