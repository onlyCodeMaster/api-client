import { useState } from "react";
import { X, Settings as SettingsIcon, ShieldCheck, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRequestStore } from "../store/useRequestStore";
import { setLocale, SUPPORTED_LOCALES, type Locale } from "../i18n";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const defaultTimeoutMs = useRequestStore((s) => s.defaultTimeoutMs);
  const setDefaultTimeoutMs = useRequestStore((s) => s.setDefaultTimeoutMs);
  const verifyTlsDefault = useRequestStore((s) => s.verifyTlsDefault);
  const setVerifyTlsDefault = useRequestStore((s) => s.setVerifyTlsDefault);
  const [value, setValue] = useState(String(defaultTimeoutMs));
  const [saved, setSaved] = useState(false);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-surface rounded-apple-lg shadow-apple-lg w-[480px] flex flex-col overflow-hidden">
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

        <div className="p-5 space-y-4">
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
    </div>
  );
}
