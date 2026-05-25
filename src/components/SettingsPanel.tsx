import { useState } from "react";
import { X, Settings as SettingsIcon } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const defaultTimeoutMs = useRequestStore((s) => s.defaultTimeoutMs);
  const setDefaultTimeoutMs = useRequestStore((s) => s.setDefaultTimeoutMs);
  const [value, setValue] = useState(String(defaultTimeoutMs));
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    await setDefaultTimeoutMs(n);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-surface rounded-apple-lg shadow-apple-lg w-[480px] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <div className="flex items-center gap-2">
            <SettingsIcon size={18} className="text-accent" />
            <h2 className="text-[15px] font-semibold text-text-primary">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-secondary transition-colors"
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
              Default request timeout (ms)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                min={1}
                className="input-apple flex-1 text-[12px]"
              />
              <button
                onClick={save}
                className="px-3 py-1.5 bg-accent text-white text-[12px] rounded-apple hover:bg-accent-hover active:scale-[0.97] transition-all"
              >
                {saved ? "Saved" : "Save"}
              </button>
            </div>
            <p className="text-[11px] text-text-tertiary mt-1">
              Applied when a request does not override the timeout itself.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
