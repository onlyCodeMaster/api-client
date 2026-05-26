import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";
import { AuthEditor } from "./AuthEditor";
import type { AuthConfig } from "../types";

interface Props {
  /** Collection to edit. `null` closes the modal. */
  collectionId: string | null;
  onClose: () => void;
}

/**
 * Edit a collection's root-level auth. Saving writes back through
 * `setCollectionAuth`, which goes through the usual `save_collection`
 * sanitize path so any bearer tokens / passwords end up in the keychain
 * rather than on disk.
 */
export function CollectionAuthModal({ collectionId, onClose }: Props) {
  const { t } = useTranslation();
  const collections = useRequestStore((s) => s.collections);
  const setCollectionAuth = useRequestStore((s) => s.setCollectionAuth);
  const collection = collections.find((c) => c.id === collectionId) || null;

  const [draft, setDraft] = useState<AuthConfig>(
    () => collection?.auth || { auth_type: "none" },
  );

  // Reset the draft when the editor opens against a different collection.
  // Uses the React-recommended "compare previous value during render" pattern
  // to avoid a useEffect that would only mirror the new collection's state.
  const [prevCollectionId, setPrevCollectionId] = useState(collection?.id);
  if (collection?.id !== prevCollectionId) {
    setPrevCollectionId(collection?.id);
    setDraft(collection?.auth || { auth_type: "none" });
  }

  if (!collectionId || !collection) return null;

  const save = async () => {
    // Strip an explicit "no auth" config back to undefined so the collection
    // file doesn't gain an irrelevant auth block.
    await setCollectionAuth(
      collection.id,
      draft.auth_type === "none" ? undefined : draft
    );
    onClose();
  };

  // Portal to <body> so we escape the sidebar's `backdrop-blur-xl`
  // containing block (without it, the modal is clipped to the sidebar).
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-bg-elevated border border-border rounded-apple-lg shadow-xl w-[560px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-light shrink-0">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-text-primary">
              {t("collection_auth.title")}
            </h2>
            <p className="text-[11px] text-text-tertiary mt-0.5">
              {t("collection_auth.subtitle_prefix")}{" "}
              <span className="font-medium text-text-secondary">
                {collection.name}
              </span>{" "}
              {t("collection_auth.subtitle_suffix")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors shrink-0"
            title={t("common.close")}
          >
            <X size={14} className="text-text-tertiary" />
          </button>
        </div>

        <div className="p-4 flex-1 overflow-auto">
          <AuthEditor value={draft} onChange={setDraft} />
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-light shrink-0">
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
