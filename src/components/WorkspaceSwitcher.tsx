import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, Plus, Pencil, Trash2, X } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";

/**
 * Workspace selector that lives at the top of the sidebar.
 *
 * Workspaces partition collections, environments, and history. Switching
 * here calls into the store's `switchWorkspace` action which reloads all
 * three from disk and resets the open tabs so nothing from the previous
 * workspace leaks across.
 */
export function WorkspaceSwitcher() {
  const workspace = useRequestStore((s) => s.workspace);
  const workspaces = useRequestStore((s) => s.workspaces);
  const switchWorkspace = useRequestStore((s) => s.switchWorkspace);
  const createWorkspace = useRequestStore((s) => s.createWorkspace);
  const renameWorkspace = useRequestStore((s) => s.renameWorkspace);
  const deleteWorkspace = useRequestStore((s) => s.deleteWorkspace);

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside to dismiss.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(target)) {
        setOpen(false);
        setCreating(false);
        setNewName("");
        setRenamingId(null);
        setRenameValue("");
        setError(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await createWorkspace(name);
      setCreating(false);
      setNewName("");
      setOpen(false);
    } catch (err) {
      setError(String(err));
    }
  };

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    try {
      await renameWorkspace(renamingId, name);
    } catch (err) {
      setError(String(err));
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const handleDelete = async (id: string, name: string) => {
    if (workspaces.length <= 1) {
      setError("Cannot delete the last remaining workspace.");
      return;
    }
    const ok = window.confirm(
      `Delete workspace "${name}"?\n\nAll collections, environments, and history in this workspace will be permanently removed.`
    );
    if (!ok) return;
    try {
      await deleteWorkspace(id);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-1.5 px-2.5 py-1.5 bg-surface-secondary hover:bg-surface-secondary/70 rounded-lg text-[12px] text-text-secondary transition-colors"
        title="Switch workspace"
      >
        <span className="flex items-center gap-1.5 truncate">
          <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
          <span className="truncate font-medium text-text-primary">
            {workspace?.name ?? "No workspace"}
          </span>
        </span>
        <ChevronDown size={11} className="text-text-tertiary shrink-0" />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-surface rounded-apple shadow-apple-lg border border-border-light z-30 overflow-hidden">
          <div className="max-h-72 overflow-y-auto">
            {workspaces.map((w) => {
              const isActive = w.id === workspace?.id;
              const isRenaming = renamingId === w.id;
              return (
                <div
                  key={w.id}
                  className={`flex items-center gap-1 px-2 py-1.5 hover:bg-surface-secondary transition-colors ${
                    isActive ? "bg-accent/5" : ""
                  }`}
                >
                  {isRenaming ? (
                    <>
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") {
                            setRenamingId(null);
                            setRenameValue("");
                          }
                        }}
                        className="input-apple flex-1 text-[12px] py-0.5"
                      />
                      <button
                        onClick={commitRename}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10"
                        title="Save"
                      >
                        <Check size={12} className="text-accent" />
                      </button>
                      <button
                        onClick={() => {
                          setRenamingId(null);
                          setRenameValue("");
                        }}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10"
                        title="Cancel"
                      >
                        <X size={12} className="text-text-tertiary" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          switchWorkspace(w.id);
                          setOpen(false);
                        }}
                        className="flex-1 flex items-center gap-1.5 text-left text-[12px] text-text-primary py-0.5"
                      >
                        {isActive && <Check size={11} className="text-accent shrink-0" />}
                        <span className={`truncate ${isActive ? "ml-0" : "ml-[15px]"}`}>{w.name}</span>
                      </button>
                      <button
                        onClick={() => startRename(w.id, w.name)}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10 opacity-0 group-hover:opacity-100"
                        title="Rename"
                      >
                        <Pencil size={11} className="text-text-tertiary" />
                      </button>
                      <button
                        onClick={() => handleDelete(w.id, w.name)}
                        disabled={workspaces.length <= 1}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-error/10 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={
                          workspaces.length <= 1
                            ? "Cannot delete the last workspace"
                            : "Delete workspace"
                        }
                      >
                        <Trash2 size={11} className="text-error" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {creating ? (
            <div className="flex items-center gap-1 p-2 border-t border-border-light bg-surface-secondary/40">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                  }
                }}
                placeholder="Workspace name"
                className="input-apple flex-1 text-[12px] py-0.5"
              />
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-accent/10 disabled:opacity-30"
                title="Create"
              >
                <Check size={12} className="text-accent" />
              </button>
              <button
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                }}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-black/5 dark:hover:bg-white/10"
                title="Cancel"
              >
                <X size={12} className="text-text-tertiary" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-accent hover:bg-accent/10 transition-colors border-t border-border-light"
            >
              <Plus size={12} />
              New workspace
            </button>
          )}

          {error && (
            <div className="px-3 py-1.5 text-[11px] text-error border-t border-border-light bg-error/5">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
