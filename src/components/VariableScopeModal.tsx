import { useEffect, useState } from "react";
import { X } from "lucide-react";
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
  const workspace = useRequestStore((s) => s.workspace);
  const collections = useRequestStore((s) => s.collections);
  const setGlobalVariables = useRequestStore((s) => s.setGlobalVariables);
  const setCollectionVariables = useRequestStore((s) => s.setCollectionVariables);

  const [draft, setDraft] = useState<EnvVariable[]>([]);

  const collection =
    scope?.kind === "collection"
      ? collections.find((c) => c.id === scope.collectionId) ?? null
      : null;

  useEffect(() => {
    if (!scope) return;
    if (scope.kind === "global") {
      setDraft(workspace?.variables ?? []);
    } else if (collection) {
      setDraft(collection.variables ?? []);
    }
  }, [scope?.kind, scope?.kind === "collection" ? scope.collectionId : null, workspace?.id, collection?.id]);

  if (!scope) return null;
  if (scope.kind === "collection" && !collection) return null;

  const title =
    scope.kind === "global" ? "Global variables" : `Variables — ${collection?.name}`;
  const description =
    scope.kind === "global"
      ? "Workspace-wide variables. Override-able by collection, folder, and environment scopes (in that order)."
      : "Collection-scoped variables. Override global vars; overridden by folder and environment vars.";

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

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-bg-elevated border border-border rounded-apple-lg shadow-xl w-[640px] max-w-[90vw] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-light shrink-0">
          <div>
            <h2 className="text-[13px] font-semibold text-text-primary">{title}</h2>
            <p className="text-[11px] text-text-tertiary mt-0.5">{description}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors"
            title="Close"
          >
            <X size={14} className="text-text-tertiary" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto">
          <VariablesEditor
            value={draft}
            onChange={setDraft}
            emptyHint={
              scope.kind === "global"
                ? "No global variables yet. Add one to define a value available to every request."
                : "No collection-scoped variables yet."
            }
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-light shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] text-text-secondary hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="px-3 py-1.5 text-[12px] bg-accent text-white rounded-md hover:bg-accent-hover transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
