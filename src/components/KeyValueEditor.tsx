import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus,
  X,
  GripVertical,
  Paperclip,
  FileText,
  Maximize2,
  Minimize2,
  List,
  Type,
  Check,
  CircleSlash,
} from "lucide-react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import type { KeyValue } from "../types";
import { VariablePreview } from "./VariablePreview";
import { parseKeyValues, serializeKeyValues } from "../utils/kvBulk";

interface KeyValueEditorProps {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** When true, each row may be toggled to a file upload (form-data only). */
  allowFiles?: boolean;
  /** When true, rows can be reordered via drag-and-drop. */
  reorderable?: boolean;
  /**
   * Scope used for the inline `{{var}}` preview. When omitted, the preview
   * eye-icon is hidden (callers without a meaningful resolution scope shouldn't
   * pretend they have one — Mock route headers, for example).
   */
  previewVars?: Record<string, string>;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/** Threshold above which the bulk-toggle (enable/disable all) buttons
 *  start appearing. Keeps the toolbar from looking busy for the common
 *  short-row case. */
const BULK_TOOLBAR_MIN_ROWS = 3;

export function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  allowFiles = false,
  reorderable = true,
  previewVars,
}: KeyValueEditorProps) {
  const { t } = useTranslation();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  /** IDs of rows the user has expanded to a multi-line textarea. */
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const keyPh = keyPlaceholder ?? t("kv.key_placeholder");
  const valuePh = valuePlaceholder ?? t("kv.value_placeholder");

  const updateItem = (id: string, patch: Partial<KeyValue>) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addItem = () => {
    onChange([...items, { id: generateId(), key: "", value: "", enabled: true }]);
  };

  const removeItem = (id: string) => {
    if (items.length <= 1) {
      // Reset to a single empty row instead of removing the last one so the
      // editor always has at least one focusable input.
      onChange([{ id: generateId(), key: "", value: "", enabled: true }]);
      return;
    }
    onChange(items.filter((item) => item.id !== id));
    setExpandedRows((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
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

  const setAllEnabled = (enabled: boolean) => {
    onChange(items.map((item) => ({ ...item, enabled })));
  };

  const toggleExpanded = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Count of rows the user has actually started filling in. Used to gate
   *  the bulk-mode toggle (otherwise a one-row table looks identical to a
   *  one-row text block and the button is just noise). */
  const meaningfulRows = useMemo(
    () => items.filter((it) => it.key.trim() || it.value.trim()).length,
    [items],
  );

  /** Bulk text mode can't represent file-attachment rows (`is_file`,
   *  `file_path` aren't part of the `key: value` line format). Suppress
   *  the toggle whenever any row is a file row so we don't silently lose
   *  the attachment on a round-trip through the textarea. */
  const hasFileRows = useMemo(
    () => items.some((it) => it.is_file),
    [items],
  );
  const bulkAllowed = !hasFileRows;

  const enterBulkMode = () => {
    setBulkText(serializeKeyValues(items));
    setBulkMode(true);
  };

  const applyBulkMode = () => {
    onChange(parseKeyValues(bulkText));
    setBulkMode(false);
  };

  const cancelBulkMode = () => {
    setBulkText("");
    setBulkMode(false);
  };

  if (bulkMode) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-text-tertiary">
            {t("kv.bulk_hint")}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={cancelBulkMode}
              className="px-2 py-1 text-[11px] text-text-secondary rounded-md hover:bg-surface-secondary transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={applyBulkMode}
              className="px-2 py-1 text-[11px] bg-accent text-white rounded-md hover:bg-accent-hover transition-colors"
            >
              {t("kv.bulk_apply")}
            </button>
          </div>
        </div>
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={t("kv.bulk_placeholder")}
          spellCheck={false}
          className="input-apple w-full text-[12px] font-mono py-2 min-h-[180px] resize-y"
        />
      </div>
    );
  }

  const allEnabled = items.length > 0 && items.every((it) => it.enabled);
  const showBulkToolbar = items.length >= BULK_TOOLBAR_MIN_ROWS;

  return (
    <div className="space-y-1.5">
      {showBulkToolbar && (
        <div className="flex items-center justify-end gap-1 text-[11px] text-text-tertiary pb-1">
          <button
            onClick={() => setAllEnabled(!allEnabled)}
            className="px-1.5 py-0.5 rounded-md hover:bg-surface-secondary flex items-center gap-1 transition-colors"
            title={
              allEnabled
                ? t("kv.disable_all_tooltip")
                : t("kv.enable_all_tooltip")
            }
          >
            {allEnabled ? (
              <CircleSlash size={11} />
            ) : (
              <Check size={11} />
            )}
            {allEnabled ? t("kv.disable_all") : t("kv.enable_all")}
          </button>
          {bulkAllowed && (
            <button
              onClick={enterBulkMode}
              className="px-1.5 py-0.5 rounded-md hover:bg-surface-secondary flex items-center gap-1 transition-colors"
              title={t("kv.bulk_edit_tooltip")}
            >
              <Type size={11} />
              {t("kv.bulk_edit")}
            </button>
          )}
        </div>
      )}

      {items.map((item) => {
        const isExpanded = expandedRows.has(item.id);
        const isOver = overId === item.id && draggingId && draggingId !== item.id;
        return (
          <div
            key={item.id}
            draggable={reorderable}
            onDragStart={() => setDraggingId(item.id)}
            onDragOver={(e) => {
              e.preventDefault();
              if (overId !== item.id) setOverId(item.id);
            }}
            onDragLeave={() => {
              if (overId === item.id) setOverId(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (draggingId) reorder(draggingId, item.id);
              setDraggingId(null);
              setOverId(null);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setOverId(null);
            }}
            className={`flex items-start gap-1.5 group rounded-md transition-colors ${
              isOver ? "bg-accent/5 outline outline-1 outline-accent/40" : ""
            } ${draggingId === item.id ? "opacity-50" : ""}`}
          >
            {reorderable && (
              <span
                className="pt-[7px] cursor-grab active:cursor-grabbing shrink-0"
                title={t("kv.drag_to_reorder")}
              >
                <GripVertical
                  size={12}
                  className="text-text-tertiary/30 group-hover:text-text-tertiary transition-colors"
                />
              </span>
            )}
            <label className="relative flex items-center justify-center w-5 h-7 shrink-0">
              <input
                type="checkbox"
                checked={item.enabled}
                onChange={(e) => updateItem(item.id, { enabled: e.target.checked })}
                className="w-[15px] h-[15px] rounded-[4px] border border-border accent-accent cursor-pointer"
                title={
                  item.enabled
                    ? t("kv.toggle_disable")
                    : t("kv.toggle_enable")
                }
              />
            </label>
            <input
              type="text"
              value={item.key}
              onChange={(e) => updateItem(item.id, { key: e.target.value })}
              placeholder={keyPh}
              spellCheck={false}
              className="input-apple w-[180px] text-[12px] py-[5px]"
            />
            {item.is_file ? (
              <div className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-[5px] bg-surface-secondary rounded-lg text-[12px]">
                <FileText size={12} className="text-accent shrink-0" />
                <span
                  className="truncate flex-1 text-text-primary"
                  title={item.file_path}
                >
                  {item.file_path?.split(/[\\/]/).pop() || t("kv.select_file")}
                </span>
                <button
                  onClick={() =>
                    updateItem(item.id, { is_file: false, file_path: undefined })
                  }
                  className="text-text-tertiary hover:text-error transition-colors shrink-0"
                  title={t("kv.switch_back_to_text")}
                >
                  <X size={11} />
                </button>
              </div>
            ) : isExpanded ? (
              <textarea
                value={item.value}
                onChange={(e) => updateItem(item.id, { value: e.target.value })}
                placeholder={valuePh}
                spellCheck={false}
                rows={3}
                className="input-apple flex-1 min-w-0 text-[12px] py-[5px] font-mono resize-y"
              />
            ) : (
              <input
                type="text"
                value={item.value}
                onChange={(e) => updateItem(item.id, { value: e.target.value })}
                placeholder={valuePh}
                spellCheck={false}
                className="input-apple flex-1 min-w-0 text-[12px] py-[5px]"
                title={item.value || undefined}
              />
            )}
            {previewVars && !item.is_file && (
              <div className="pt-[1px]">
                <VariablePreview value={item.value} vars={previewVars} />
              </div>
            )}
            {!item.is_file && (
              <button
                onClick={() => toggleExpanded(item.id)}
                className="w-5 h-7 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-all shrink-0"
                title={
                  isExpanded
                    ? t("kv.collapse_value")
                    : t("kv.expand_value")
                }
              >
                {isExpanded ? (
                  <Minimize2 size={11} className="text-text-tertiary" />
                ) : (
                  <Maximize2 size={11} className="text-text-tertiary" />
                )}
              </button>
            )}
            {allowFiles && (
              <button
                onClick={() => pickFile(item.id)}
                className="w-5 h-7 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent/10 transition-all shrink-0"
                title={t("kv.attach_file")}
              >
                <Paperclip size={12} className="text-text-tertiary" />
              </button>
            )}
            <button
              onClick={() => removeItem(item.id)}
              className="w-5 h-7 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-all shrink-0"
              title={t("kv.remove_row")}
            >
              <X size={12} className="text-text-tertiary" />
            </button>
          </div>
        );
      })}
      <div className="flex items-center gap-2 pl-6 pt-0.5">
        <button
          onClick={addItem}
          className="flex items-center gap-1 text-[12px] text-accent hover:text-accent-hover transition-colors py-1"
        >
          <Plus size={12} strokeWidth={2.2} />
          {t("kv.add")}
        </button>
        {!showBulkToolbar && bulkAllowed && meaningfulRows > 0 && (
          <button
            onClick={enterBulkMode}
            className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors py-1"
            title={t("kv.bulk_edit_tooltip")}
          >
            <List size={11} />
            {t("kv.bulk_edit")}
          </button>
        )}
      </div>
    </div>
  );
}
