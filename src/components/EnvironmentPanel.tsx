import { useState } from "react";
import { Plus, Trash2, X, Globe, Eye, EyeOff } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";
import type { EnvVariable } from "../types";

export function EnvironmentPanel({ onClose }: { onClose: () => void }) {
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
    environments.length > 0 ? environments[0].id : null
  );

  const activeEnvId = workspace?.active_environment_id;
  const editingEnv = environments.find((e) => e.id === editingEnvId);

  const handleAddEnv = async () => {
    const name = newEnvName.trim();
    if (!name) return;
    await addEnvironment(name);
    setNewEnvName("");
    // Select the newly created environment
    const updated = useRequestStore.getState().environments;
    const created = updated[updated.length - 1];
    if (created) setEditingEnvId(created.id);
  };

  const handleAddVariable = () => {
    if (!editingEnv) return;
    const newVar: EnvVariable = { key: "", value: "", enabled: true, is_secret: false };
    updateEnvironment({ ...editingEnv, variables: [...editingEnv.variables, newVar] });
  };

  const handleUpdateVariable = (index: number, partial: Partial<EnvVariable>) => {
    if (!editingEnv) return;
    const vars = [...editingEnv.variables];
    vars[index] = { ...vars[index], ...partial };
    updateEnvironment({ ...editingEnv, variables: vars });
  };

  const handleDeleteVariable = (index: number) => {
    if (!editingEnv) return;
    const vars = editingEnv.variables.filter((_, i) => i !== index);
    updateEnvironment({ ...editingEnv, variables: vars });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-surface rounded-apple-lg shadow-apple-lg w-[640px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <div className="flex items-center gap-2">
            <Globe size={18} className="text-accent" />
            <h2 className="text-[15px] font-semibold text-text-primary">Environments</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-secondary transition-colors"
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Env list */}
          <div className="w-48 border-r border-border-light flex flex-col overflow-y-auto">
            <div className="p-2 space-y-0.5">
              {environments.map((env) => (
                <div
                  key={env.id}
                  onClick={() => setEditingEnvId(env.id)}
                  className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    editingEnvId === env.id ? "bg-accent/10" : "hover:bg-surface-secondary"
                  }`}
                >
                  <span className="text-[12px] text-text-primary truncate flex-1">{env.name}</span>
                  {activeEnvId === env.id && (
                    <span className="w-2 h-2 rounded-full bg-success shrink-0" />
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete "${env.name}"?`)) {
                        deleteEnvironment(env.id);
                        if (editingEnvId === env.id) setEditingEnvId(null);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-error/10 rounded transition-all"
                  >
                    <Trash2 size={11} className="text-error/70" />
                  </button>
                </div>
              ))}
            </div>
            <div className="p-2 border-t border-border-light mt-auto">
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newEnvName}
                  onChange={(e) => setNewEnvName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddEnv()}
                  placeholder="New env..."
                  className="input-apple flex-1 text-[11px] py-[4px]"
                />
                <button
                  onClick={handleAddEnv}
                  className="p-1.5 hover:bg-accent/10 rounded-md transition-colors"
                >
                  <Plus size={13} className="text-accent" />
                </button>
              </div>
            </div>
          </div>

          {/* Variables editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {editingEnv ? (
              <>
                <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
                  <span className="text-[13px] font-medium text-text-primary">{editingEnv.name}</span>
                  <button
                    onClick={() => setActiveEnvironment(activeEnvId === editingEnv.id ? null : editingEnv.id)}
                    className={`text-[11px] font-medium px-3 py-1 rounded-md transition-colors ${
                      activeEnvId === editingEnv.id
                        ? "bg-success/15 text-success"
                        : "bg-accent/10 text-accent hover:bg-accent/20"
                    }`}
                  >
                    {activeEnvId === editingEnv.id ? "Active ✓" : "Set Active"}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
                  {editingEnv.variables.map((variable, i) => (
                    <VariableRow
                      key={i}
                      variable={variable}
                      onChange={(partial) => handleUpdateVariable(i, partial)}
                      onDelete={() => handleDeleteVariable(i)}
                    />
                  ))}
                  <button
                    onClick={handleAddVariable}
                    className="flex items-center gap-1.5 text-[11px] text-accent hover:text-accent-hover mt-2 transition-colors"
                  >
                    <Plus size={12} />
                    Add Variable
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-text-tertiary text-[12px]">
                Select or create an environment
              </div>
            )}
          </div>
        </div>
      </div>
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
        >
          {showValue ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
      </div>
      <button
        onClick={() => onChange({ is_secret: !variable.is_secret })}
        className={`text-[9px] px-1.5 py-0.5 rounded font-medium transition-colors ${
          variable.is_secret ? "bg-warning/15 text-warning" : "bg-surface-secondary text-text-tertiary"
        }`}
        title={variable.is_secret ? "Secret (stored in Keychain)" : "Plain text"}
      >
        {variable.is_secret ? "🔒" : "Aa"}
      </button>
      <button
        onClick={onDelete}
        className="p-1 hover:bg-error/10 rounded transition-colors"
      >
        <Trash2 size={11} className="text-error/70" />
      </button>
    </div>
  );
}
