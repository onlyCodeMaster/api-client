import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X, Globe, Folder } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";
import { VariablesEditor } from "./VariablesEditor";
import type { EnvVariable } from "../types";

type Scope =
  | { kind: "global" }
  | { kind: "collection"; collectionId: string };

interface Props {
  /** Which scope to edit. `null` closes the modal. */
  scope: Scope | null;
  onClose: () => void;
}

/**
 * Modal for editing the variable list of either the workspace (global
 * scope) or a specific collection. Folder-scope editing is not exposed
 * via UI in this PR — the backend supports it for future work.
 */
export function VariableScopeModal({ scope, onClose }: Props) {
  const { t } = useTranslation();
  const workspace = useRequestStore((s) => s.workspace);
  const collections = useRequestStore((s) => s.collections);
  const setGlobalVariables = useRequestStore((s) => s.setGlobalVariables);
  const setCollectionVariables = useRequestStore((s) => s.setCollectionVariables);

  const collection =
    scope?.kind === "collection"
      ? collections.find((c) => c.id === scope.collectionId) ?? null
      : null;

  // The "source of truth" variable list for the currently selected scope.
  const sourceVars: EnvVariable[] =
    scope?.kind === "global"
      ? workspace?.variables ?? []
      : collection?.variables ?? [];

  const [draft, setDraft] = useState<EnvVariable[]>(sourceVars);

  // Inline preview scope:
  //  - Global scope previews against just its own draft (nothing else is
  //    lower in the hierarchy).
  //  - Collection scope previews against (global ⊕ draft); folder / env
  //    scopes would shadow these at send time, but we don't have a
  //    specific request context here so the lowest meaningful layer wins.
  const previewVars = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    if (scope?.kind === "collection") {
      for (const v of workspace?.variables ?? []) {
        if (v.enabled && v.key) out[v.key] = v.value;
      }
    }
    for (const v of draft) {
      if (v.enabled && v.key) out[v.key] = v.value;
    }
    return out;
  }, [scope?.kind, workspace?.variables, draft]);

  // Reset the draft when the open scope or its source variables change. Uses
  // React's recommended "compare previous value during render" pattern instead
  // of useEffect to avoid a render-then-render cascade.
  const scopeKey =
    scope?.kind === "global"
      ? `global:${workspace?.id ?? ""}`
      : scope?.kind === "collection"
      ? `collection:${collection?.id ?? ""}`
      : "none";
  const [prevScopeKey, setPrevScopeKey] = useState(scopeKey);
  if (scopeKey !== prevScopeKey) {
    setPrevScopeKey(scopeKey);
    setDraft(sourceVars);
  }

  if (!scope) return null;
  if (scope.kind === "collection" && !collection) return null;

  const title =
    scope.kind === "global"
      ? t("variable_scope.global_title")
      : t("variable_scope.collection_title", { name: collection?.name ?? "" });
  const description =
    scope.kind === "global"
      ? t("variable_scope.global_description")
      : t("variable_scope.collection_description");

  const save = async () => {
    // Drop fully-blank rows on save so the file doesn't accumulate noise.
    const cleaned = draft.filter((v) => v.key.trim() !== "" || v.value !== "");
    if (scope.kind === "global") {
      await setGlobalVariables(cleaned);
    } else {
      await setCollectionVariables(scope.collectionId, cleaned);
    }
    onClose();
  };

  // Portal to <body> so we escape the sidebar's `backdrop-blur-xl`
  // containing block (see EnvironmentPanel for the same fix).
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-apple-lg shadow-apple-lg w-[1024px] max-w-[92vw] h-[85vh] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border-light shrink-0">
          <div className="flex items-start gap-2 min-w-0">
            {scope.kind === "global" ? (
              <Globe size={18} className="text-accent shrink-0 mt-0.5" />
            ) : (
              <Folder size={18} className="text-accent shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-text-primary truncate">
                {title}
              </h2>
              <p className="text-[12px] text-text-tertiary mt-0.5">
                {description}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-secondary transition-colors shrink-0"
            title={t("common.close")}
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <VariablesEditor
            value={draft}
            onChange={setDraft}
            emptyHint={
              scope.kind === "global"
                ? t("variable_scope.empty_global")
                : t("variable_scope.empty_collection")
            }
            previewVars={previewVars}
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-surface-secondary/40 border-t border-border-light shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] text-text-secondary hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={save}
            className="px-3 py-1.5 text-[12px] bg-accent text-white rounded-md hover:bg-accent-hover transition-colors"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
