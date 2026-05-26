import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, Eye, EyeOff, Maximize2, Minimize2 } from "lucide-react";
import type { EnvVariable } from "../types";

/**
 * Tabular editor for a list of `EnvVariable`. Used by both `EnvironmentPanel`
 * and `VariableScopeModal` (workspace / collection scopes) so the layout +
 * keyboard handling stay consistent across scopes.
 *
 * Row layout (left → right):
 *   ‑ enabled checkbox
 *   ‑ key (fixed-width column so values get the rest of the row)
 *   ‑ value (single-line input, OR multi-line textarea when expanded)
 *   ‑ expand / collapse toggle for the value field
 *   ‑ secret toggle (Aa <-> 🔒)
 *   ‑ show/hide value (Eye / EyeOff)
 *   ‑ delete
 *
 * The key column is intentionally narrower than the value column because
 * real-world variable values (tokens, URLs, JWTs) are 10× longer than keys.
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
  const { t } = useTranslation();

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
        <p className="text-[12px] text-text-tertiary italic">
          {emptyHint ?? t("env.no_variables")}
        </p>
      )}
      {value.length > 0 && <VariableHeader />}
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
        className="flex items-center gap-1.5 text-[12px] text-accent hover:text-accent-hover mt-2"
      >
        <Plus size={13} />
        {t("env.add_variable")}
      </button>
    </div>
  );
}

/** Column headers for the variable table. Kept inline so the row layout
 *  stays in lockstep with the data rows below. */
function VariableHeader() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 px-1 pb-1 text-[10px] uppercase tracking-wide text-text-tertiary font-medium">
      <span className="w-4 shrink-0" />
      <span className="w-[180px] shrink-0">{t("env.column_key")}</span>
      <span className="flex-1 min-w-0">{t("env.column_value")}</span>
      <span className="w-[112px] shrink-0 text-right pr-1">
        {t("env.column_actions")}
      </span>
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
  const { t } = useTranslation();
  const [showValue, setShowValue] = useState(!variable.is_secret);
  // Expanded view turns the single-line input into a multi-line textarea
  // so long URLs / JWTs / JSON snippets can be inspected without horizontal
  // scrolling. Persists per row for the lifetime of the editor.
  const [expanded, setExpanded] = useState(false);

  const looksLong = variable.value.length > 60 || variable.value.includes("\n");
  const showExpand = looksLong || expanded;

  return (
    <div className="flex items-start gap-2">
      <input
        type="checkbox"
        checked={variable.enabled}
        onChange={(e) => onChange({ enabled: e.target.checked })}
        className="w-4 h-4 rounded accent-accent mt-1.5"
        title={t("env.toggle_enabled")}
      />
      <input
        type="text"
        value={variable.key}
        onChange={(e) => onChange({ key: e.target.value })}
        placeholder={t("env.key_placeholder")}
        spellCheck={false}
        className="input-apple w-[180px] shrink-0 text-[12px] py-1 font-mono"
      />
      <div className="relative flex-1 min-w-0">
        {expanded ? (
          <textarea
            value={variable.value}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder={t("env.value_placeholder")}
            spellCheck={false}
            rows={Math.min(8, Math.max(2, variable.value.split("\n").length))}
            className="input-apple w-full text-[12px] py-1.5 font-mono resize-y leading-snug"
            // Visually mask the value if it's a secret + hide is requested;
            // textareas don't have type="password" so we hand-roll it via
            // the `webkit-text-security` style. Falls back to plaintext on
            // older browsers — acceptable: the value is on screen only for
            // the user who can already see the env in the panel.
            style={
              !showValue && variable.is_secret
                ? ({
                    WebkitTextSecurity: "disc",
                  } as React.CSSProperties)
                : undefined
            }
          />
        ) : (
          <input
            type={showValue || !variable.is_secret ? "text" : "password"}
            value={variable.value}
            onChange={(e) => onChange({ value: e.target.value })}
            placeholder={t("env.value_placeholder")}
            spellCheck={false}
            className="input-apple w-full text-[12px] py-1 font-mono"
            title={variable.value}
          />
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {showExpand && (
          <IconButton
            onClick={() => setExpanded((v) => !v)}
            title={
              expanded
                ? t("env.collapse_value")
                : t("env.expand_value")
            }
          >
            {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </IconButton>
        )}
        <IconButton
          onClick={() => setShowValue((v) => !v)}
          title={showValue ? t("env.hide_value") : t("env.show_value")}
        >
          {showValue ? <Eye size={12} /> : <EyeOff size={12} />}
        </IconButton>
        <button
          type="button"
          onClick={() => onChange({ is_secret: !variable.is_secret })}
          className={`px-1.5 h-6 rounded text-[10px] font-semibold transition-colors leading-none ${
            variable.is_secret
              ? "bg-warning/15 text-warning"
              : "bg-surface-secondary text-text-tertiary hover:text-text-secondary"
          }`}
          title={
            variable.is_secret ? t("env.secret_on") : t("env.secret_off")
          }
        >
          {variable.is_secret ? t("env.badge_secret") : t("env.badge_text")}
        </button>
        <IconButton
          onClick={onDelete}
          title={t("env.delete_variable")}
          hoverClass="hover:bg-error/10"
        >
          <Trash2 size={12} className="text-error/70" />
        </IconButton>
      </div>
    </div>
  );
}

/** Small icon button used for the row actions. Sized to align with the
 *  single-line input height (24px) so the row stays visually balanced. */
function IconButton({
  children,
  onClick,
  title,
  hoverClass = "hover:bg-black/5 dark:hover:bg-white/10",
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  hoverClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-6 h-6 flex items-center justify-center rounded text-text-tertiary transition-colors ${hoverClass}`}
      title={title}
    >
      {children}
    </button>
  );
}
