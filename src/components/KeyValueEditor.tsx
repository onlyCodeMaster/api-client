import { useState } from "react";
import { Plus, X, GripVertical, Paperclip, FileText } from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import type { KeyValue } from "../types";

interface KeyValueEditorProps {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** When true, each row may be toggled to a file upload (form-data only). */
  allowFiles?: boolean;
  /** When true, rows can be reordered via drag-and-drop. */
  reorderable?: boolean;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  allowFiles = false,
  reorderable = true,
}: KeyValueEditorProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const updateItem = (id: string, patch: Partial<KeyValue>) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addItem = () => {
    onChange([...items, { id: generateId(), key: "", value: "", enabled: true }]);
  };

  const removeItem = (id: string) => {
    if (items.length <= 1) {
      // Reset to a single empty row instead of removing the last one
      onChange([{ id: generateId(), key: "", value: "", enabled: true }]);
      return;
    }
    onChange(items.filter((item) => item.id !== id));
  };

  const reorder = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const from = items.findIndex((i) => i.id === fromId);
    const to = items.findIndex((i) => i.id === toId);
    if (from === -1 || to === -1) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const pickFile = async (id: string) => {
    try {
      const selected = await openFileDialog({ multiple: false });
      if (selected && typeof selected === "string") {
        updateItem(id, { is_file: true, file_path: selected, value: "" });
      }
    } catch (err) {
      console.error("File picker failed:", err);
    }
  };

  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div
          key={item.id}
          draggable={reorderable}
          onDragStart={() => setDraggingId(item.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (draggingId) reorder(draggingId, item.id);
            setDraggingId(null);
          }}
          onDragEnd={() => setDraggingId(null)}
          className="flex items-center gap-1.5 group"
        >
          {reorderable && (
            <GripVertical
              size={12}
              className="text-text-tertiary/50 opacity-0 group-hover:opacity-100 cursor-grab shrink-0"
            />
          )}
          <label className="relative flex items-center justify-center w-5 h-5 shrink-0">
            <input
              type="checkbox"
              checked={item.enabled}
              onChange={(e) => updateItem(item.id, { enabled: e.target.checked })}
              className="w-[15px] h-[15px] rounded-[4px] border border-border accent-accent cursor-pointer"
            />
          </label>
          <input
            type="text"
            value={item.key}
            onChange={(e) => updateItem(item.id, { key: e.target.value })}
            placeholder={keyPlaceholder}
            className="input-apple flex-1 text-[12px] py-[5px]"
          />
          {item.is_file ? (
            <div className="flex-1 flex items-center gap-1.5 px-2 py-[5px] bg-surface-secondary rounded-lg text-[12px] min-w-0">
              <FileText size={12} className="text-accent shrink-0" />
              <span className="truncate flex-1 text-text-primary" title={item.file_path}>
                {item.file_path?.split(/[\\/]/).pop() || "Select file…"}
              </span>
              <button
                onClick={() => updateItem(item.id, { is_file: false, file_path: undefined })}
                className="text-text-tertiary hover:text-error transition-colors shrink-0"
                title="Switch back to text value"
              >
                <X size={11} />
              </button>
            </div>
          ) : (
            <input
              type="text"
              value={item.value}
              onChange={(e) => updateItem(item.id, { value: e.target.value })}
              placeholder={valuePlaceholder}
              className="input-apple flex-1 text-[12px] py-[5px]"
            />
          )}
          {allowFiles && (
            <button
              onClick={() => pickFile(item.id)}
              className="w-5 h-5 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent/10 transition-all shrink-0"
              title="Attach file"
            >
              <Paperclip size={12} className="text-text-tertiary" />
            </button>
          )}
          <button
            onClick={() => removeItem(item.id)}
            className="w-5 h-5 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-black/5 transition-all shrink-0"
          >
            <X size={12} className="text-text-tertiary" />
          </button>
        </div>
      ))}
      <button
        onClick={addItem}
        className="flex items-center gap-1 text-[12px] text-accent hover:text-accent-hover transition-colors pl-6 py-1"
      >
        <Plus size={12} strokeWidth={2.2} />
        Add
      </button>
    </div>
  );
}
