import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Settings as SettingsIcon, ShieldCheck, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRequestStore } from "../store/useRequestStore";
import { setLocale, SUPPORTED_LOCALES, type Locale } from "../i18n";

/** Bytes-per-MiB shortcut. The UI shows MiB to keep numbers readable
 *  (10 MiB ≫ 10485760) and converts to/from bytes when persisting. */
const MIB = 1024 * 1024;

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const defaultTimeoutMs = useRequestStore((s) => s.defaultTimeoutMs);
  const setDefaultTimeoutMs = useRequestStore((s) => s.setDefaultTimeoutMs);
  const verifyTlsDefault = useRequestStore((s) => s.verifyTlsDefault);
  const setVerifyTlsDefault = useRequestStore((s) => s.setVerifyTlsDefault);
  const maxBodyBytes = useRequestStore((s) => s.maxBodyBytes);
  const setMaxBodyBytes = useRequestStore((s) => s.setMaxBodyBytes);
  const maxHistoryBodyBytes = useRequestStore((s) => s.maxHistoryBodyBytes);
  const setMaxHistoryBodyBytes = useRequestStore((s) => s.setMaxHistoryBodyBytes);
  const [value, setValue] = useState(String(defaultTimeoutMs));
  const [maxBodyMiB, setMaxBodyMiB] = useState(String(Math.max(1, Math.round(maxBodyBytes / MIB))));
  const [maxHistoryBodyKiB, setMaxHistoryBodyKiB] = useState(
    String(Math.max(1, Math.round(maxHistoryBodyBytes / 1024)))
  );
  const [saved, setSaved] = useState(false);
  const [savedMaxBody, setSavedMaxBody] = useState(false);
  const [savedHistBody, setSavedHistBody] = useState(false);
  // Drive the dropdown straight off i18next so it stays in sync when the
  // user changes language elsewhere in the future.
  const currentLocale = (i18n.language?.split("-")[0] ?? "en") as Locale;

  const save = async () => {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    await setDefaultTimeoutMs(n);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const saveMaxBody = async () => {
    const n = parseInt(maxBodyMiB, 10);
    if (!Number.isFinite(n) || n <= 0 || n > 1024) return;
    await setMaxBodyBytes(n * MIB);
    setSavedMaxBody(true);
    setTimeout(() => setSavedMaxBody(false), 1500);
  };

  const saveHistBody = async () => {
    const n = parseInt(maxHistoryBodyKiB, 10);
    if (!Number.isFinite(n) || n < 0 || n > 10240) return;
    await setMaxHistoryBodyBytes(n * 1024);
    setSavedHistBody(true);
    setTimeout(() => setSavedHistBody(false), 1500);
  };

  // Portal to <body> so we escape the sidebar's `backdrop-blur-xl`
  // containing block (without it, the modal is clipped to the sidebar).
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-surface rounded-apple-lg shadow-apple-lg w-[520px] max-w-[92vw] max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <div className="flex items-center gap-2">
            <SettingsIcon size={18} className="text-accent" />
            <h2 className="text-[15px] font-semibold text-text-primary">{t("settings.settings")}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-secondary transition-colors"
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
              {t("settings.language")}
            </label>
            <select
              value={currentLocale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className="input-apple w-full text-[12px]"
            >
              {SUPPORTED_LOCALES.map((loc) => (
                <option key={loc} value={loc}>
                  {loc === "en"
                    ? t("settings.language_english")
                    : t("settings.language_chinese")}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
              {t("settings.default_timeout")}
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
                {saved ? t("common.saved") : t("common.save")}
              </button>
            </div>
          </div>

          <div>
            <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
              {t("settings.max_body_bytes")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={maxBodyMiB}
                onChange={(e) => setMaxBodyMiB(e.target.value)}
                min={1}
                max={1024}
                className="input-apple flex-1 text-[12px]"
              />
              <span className="text-[11px] text-text-tertiary shrink-0 w-8">MiB</span>
              <button
                onClick={saveMaxBody}
                className="px-3 py-1.5 bg-accent text-white text-[12px] rounded-apple hover:bg-accent-hover active:scale-[0.97] transition-all"
              >
                {savedMaxBody ? t("common.saved") : t("common.save")}
              </button>
            </div>
            <p className="text-[11px] text-text-tertiary mt-1.5">
              {t("settings.max_body_bytes_hint")}
            </p>
          </div>

          <div>
            <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
              {t("settings.max_history_body_bytes")}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={maxHistoryBodyKiB}
                onChange={(e) => setMaxHistoryBodyKiB(e.target.value)}
                min={0}
                max={10240}
                className="input-apple flex-1 text-[12px]"
              />
              <span className="text-[11px] text-text-tertiary shrink-0 w-8">KiB</span>
              <button
                onClick={saveHistBody}
                className="px-3 py-1.5 bg-accent text-white text-[12px] rounded-apple hover:bg-accent-hover active:scale-[0.97] transition-all"
              >
                {savedHistBody ? t("common.saved") : t("common.save")}
              </button>
            </div>
            <p className="text-[11px] text-text-tertiary mt-1.5">
              {t("settings.max_history_body_bytes_hint")}
            </p>
          </div>

          <div>
            <label className="text-[12px] font-medium text-text-secondary block mb-1.5">
              {t("settings.verify_tls_default")}
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setVerifyTlsDefault(!verifyTlsDefault)}
                className={`relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer rounded-full border transition-colors ${
                  verifyTlsDefault
                    ? "bg-accent border-accent"
                    : "bg-surface-secondary border-border"
                }`}
                role="switch"
                aria-checked={verifyTlsDefault}
              >
                <span
                  className={`inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-sm transition-transform ${
                    verifyTlsDefault ? "translate-x-[18px]" : "translate-x-[2px]"
                  } translate-y-[1px]`}
                />
              </button>
              <div className="flex items-center gap-1.5 text-[12px]">
                {verifyTlsDefault ? (
                  <>
                    <ShieldCheck size={14} className="text-success" />
                    <span className="text-text-primary">{t("settings.tls_on")}</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert size={14} className="text-warning" />
                    <span className="text-warning">{t("settings.tls_off")}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
