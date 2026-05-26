import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, X, Globe, Check } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";
import { VariablesEditor } from "./VariablesEditor";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Full environment manager. Left column lists environments (with the active
 * one badged); right column edits the selected environment's variables via
 * the shared {@link VariablesEditor}.
 *
 * The shell is intentionally sized to `min(1024px, 92vw)` × `85vh` so the
 * variable rows have enough room for real-world token / URL values without
 * truncating. The narrow legacy 640 × 80vh layout couldn't fit a JWT.
 */
export function EnvironmentPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const {
    environments,
    workspace,
    addEnvironment,
    deleteEnvironment,
    updateEnvironment,
    setActiveEnvironment,
  } = useRequestStore();

  const [newEnvName, setNewEnvName] = useState("");
  const [editingEnvId, setEditingEnvId] = useState<string | null>(
    environments.length > 0 ? environments[0].id : null,
  );
  // null when no confirmation pending; otherwise the env id queued for delete.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const activeEnvId = workspace?.active_environment_id;
  const editingEnv = environments.find((e) => e.id === editingEnvId);
  const pendingDeleteEnv = environments.find((e) => e.id === pendingDeleteId);

  const handleAddEnv = async () => {
    const name = newEnvName.trim();
    if (!name) return;
    await addEnvironment(name);
    setNewEnvName("");
    // Select the newly-created env so the user can immediately edit it.
    const updated = useRequestStore.getState().environments;
    const created = updated[updated.length - 1];
    if (created) setEditingEnvId(created.id);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteId) return;
    await deleteEnvironment(pendingDeleteId);
    if (editingEnvId === pendingDeleteId) setEditingEnvId(null);
    setPendingDeleteId(null);
  };

  // Portal to <body> so we escape the sidebar's `backdrop-blur-xl`
  // containing block. Without the portal, the `position: fixed` modal
  // is sized to the sidebar's bounding box (~256px wide) and renders
  // visibly clipped — the exact "display incomplete" bug we're fixing.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-surface rounded-apple-lg shadow-apple-lg w-[1024px] max-w-[92vw] h-[85vh] max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light shrink-0">
          <div className="flex items-center gap-2">
            <Globe size={18} className="text-accent" />
            <h2 className="text-[15px] font-semibold text-text-primary">
              {t("env.panel_title")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-secondary transition-colors"
            title={t("common.close")}
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Env list */}
          <div className="w-60 shrink-0 border-r border-border-light flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {environments.length === 0 && (
                <p className="text-[12px] text-text-tertiary italic px-2 py-3">
                  {t("env.empty_list")}
                </p>
              )}
              {environments.map((env) => {
                const isActive = activeEnvId === env.id;
                const isSelected = editingEnvId === env.id;
                return (
                  <div
                    key={env.id}
                    onClick={() => setEditingEnvId(env.id)}
                    title={env.name}
                    className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-accent/10"
                        : "hover:bg-surface-secondary"
                    }`}
                  >
                    <span className="text-[12px] text-text-primary truncate flex-1 min-w-0">
                      {env.name}
                    </span>
                    <span className="text-[10px] text-text-tertiary tabular-nums shrink-0">
                      {env.variables.length}
                    </span>
                    {isActive && (
                      <Check size={12} className="text-success shrink-0" />
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDeleteId(env.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-error/10 rounded transition-all shrink-0"
                      title={t("env.delete_env_tooltip")}
                    >
                      <Trash2 size={11} className="text-error/70" />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="p-2 border-t border-border-light">
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newEnvName}
                  onChange={(e) => setNewEnvName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddEnv()}
                  placeholder={t("env.new_env_placeholder")}
                  className="input-apple flex-1 min-w-0 text-[12px] py-1"
                />
                <button
                  onClick={handleAddEnv}
                  disabled={!newEnvName.trim()}
                  className="p-1.5 hover:bg-accent/10 rounded-md transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                  title={t("env.add_env_tooltip")}
                >
                  <Plus size={13} className="text-accent" />
                </button>
              </div>
            </div>
          </div>

          {/* Variables editor */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {editingEnv ? (
              <>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border-light shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-[13px] font-medium text-text-primary truncate"
                      title={editingEnv.name}
                    >
                      {editingEnv.name}
                    </span>
                    <span className="text-[11px] text-text-tertiary shrink-0">
                      {t("env.variable_count", {
                        count: editingEnv.variables.length,
                      })}
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      setActiveEnvironment(
                        activeEnvId === editingEnv.id ? null : editingEnv.id,
                      )
                    }
                    className={`text-[11px] font-medium px-3 py-1 rounded-md transition-colors shrink-0 ${
                      activeEnvId === editingEnv.id
                        ? "bg-success/15 text-success"
                        : "bg-accent/10 text-accent hover:bg-accent/20"
                    }`}
                  >
                    {activeEnvId === editingEnv.id
                      ? t("env.active_badge")
                      : t("env.set_active")}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  <VariablesEditor
                    value={editingEnv.variables}
                    onChange={(next) =>
                      updateEnvironment({ ...editingEnv, variables: next })
                    }
                    emptyHint={t("env.no_variables_in_env")}
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-text-tertiary text-[12px]">
                {t("env.select_or_create")}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDeleteEnv !== undefined}
        title={t("env.delete_env_title")}
        message={t("env.delete_env_message", {
          name: pendingDeleteEnv?.name ?? "",
        })}
        confirmLabel={t("common.delete")}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>,
    document.body,
  );
}
