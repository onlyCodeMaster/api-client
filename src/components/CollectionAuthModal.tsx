import { useEffect, useState } from "react";
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
  const collections = useRequestStore((s) => s.collections);
  const setCollectionAuth = useRequestStore((s) => s.setCollectionAuth);
  const collection = collections.find((c) => c.id === collectionId) || null;

  const [draft, setDraft] = useState<AuthConfig>({ auth_type: "none" });

  useEffect(() => {
    if (collection) setDraft(collection.auth || { auth_type: "none" });
  }, [collection?.id]);

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

  return (
    <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-bg-elevated border border-border rounded-apple-lg shadow-xl w-[420px] max-w-[90vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-light">
          <div>
            <h2 className="text-[13px] font-semibold text-text-primary">Collection auth</h2>
            <p className="text-[11px] text-text-tertiary mt-0.5">
              Requests in <span className="font-medium text-text-secondary">{collection.name}</span> with
              auth set to "Inherit" will use this.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-md transition-colors"
            title="Close"
          >
            <X size={14} className="text-text-tertiary" />
          </button>
        </div>

        <div className="p-4">
          <AuthEditor value={draft} onChange={setDraft} />
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-light">
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
