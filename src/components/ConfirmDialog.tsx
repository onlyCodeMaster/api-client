import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

interface ConfirmDialogProps {
  /** When `null`/`false`, the dialog is closed. */
  open: boolean;
  /** Dialog title. */
  title: string;
  /**
   * Body text. Newlines are honoured. Pass a longer explanation here when
   * the consequence is non-obvious (e.g. cascade delete).
   */
  message: string;
  /** Label for the destructive action. Defaults to the localized "Delete". */
  confirmLabel?: string;
  /** Label for the safe action. Defaults to the localized "Cancel". */
  cancelLabel?: string;
  /**
   * Style hint for the confirm button. `"danger"` (default) renders red;
   * `"primary"` renders the accent colour for non-destructive confirmations
   * (e.g. discarding unsaved changes).
   */
  variant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Lightweight in-app confirmation dialog. Replaces the browser-native
 * `window.confirm` so confirmations can be styled, themed (dark mode),
 * localized, and shown above other modals without breaking focus.
 *
 * Esc closes the dialog (treated as cancel). Enter confirms.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = "danger",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        // Cmd/Ctrl+Enter to confirm — plain Enter is reserved for the
        // confirm button being focused, which already triggers via the
        // browser's default activation behaviour.
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  const confirmClass =
    variant === "danger"
      ? "bg-error text-white hover:bg-error/90"
      : "bg-accent text-white hover:bg-accent-hover";

  // Portal to <body> so we escape any ancestor `backdrop-filter` / `transform`
  // containing block (e.g. the sidebar's `backdrop-blur-xl`). Without this,
  // `position: fixed` is constrained to the ancestor instead of the viewport.
  return createPortal(
    <div
      // z-60 keeps confirm above the panel that triggered it (panels use z-50).
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-surface rounded-apple-lg shadow-apple-lg w-[420px] max-w-[90vw] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 p-5">
          {variant === "danger" && (
            <div className="shrink-0 w-9 h-9 rounded-full bg-error/10 flex items-center justify-center">
              <AlertTriangle size={18} className="text-error" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-semibold text-text-primary">
              {title}
            </h2>
            <p className="text-[12px] text-text-secondary mt-1 whitespace-pre-line break-words">
              {message}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 bg-surface-secondary/50 border-t border-border-light">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-[12px] text-text-secondary hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors"
          >
            {cancelLabel ?? t("common.cancel")}
          </button>
          <button
            autoFocus
            onClick={onConfirm}
            className={`px-3 py-1.5 text-[12px] rounded-md transition-colors ${confirmClass}`}
          >
            {confirmLabel ?? t("common.delete")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
