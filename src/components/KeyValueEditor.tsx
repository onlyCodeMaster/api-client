import { Plus, X } from "lucide-react";
import type { KeyValue } from "../types";

interface KeyValueEditorProps {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
}: KeyValueEditorProps) {
  const updateItem = (id: string, field: keyof KeyValue, value: string | boolean) => {
    onChange(
      items.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  const addItem = () => {
    onChange([...items, { id: generateId(), key: "", value: "", enabled: true }]);
  };

  const removeItem = (id: string) => {
    if (items.length <= 1) return;
    onChange(items.filter((item) => item.id !== id));
  };

  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-1.5 group">
          <label className="relative flex items-center justify-center w-5 h-5 shrink-0">
            <input
              type="checkbox"
              checked={item.enabled}
              onChange={(e) => updateItem(item.id, "enabled", e.target.checked)}
              className="w-[15px] h-[15px] rounded-[4px] border border-border accent-accent cursor-pointer"
            />
          </label>
          <input
            type="text"
            value={item.key}
            onChange={(e) => updateItem(item.id, "key", e.target.value)}
            placeholder={keyPlaceholder}
            className="input-apple flex-1 text-[12px] py-[5px]"
          />
          <input
            type="text"
            value={item.value}
            onChange={(e) => updateItem(item.id, "value", e.target.value)}
            placeholder={valuePlaceholder}
            className="input-apple flex-1 text-[12px] py-[5px]"
          />
          <button
            onClick={() => removeItem(item.id)}
            className="w-5 h-5 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-black/5 transition-all shrink-0"
            disabled={items.length <= 1}
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
