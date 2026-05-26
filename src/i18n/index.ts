import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

export const SUPPORTED_LOCALES = ["en", "zh"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const STORAGE_KEY = "api-client:locale";

/** Resolve which locale to start the app in. Order:
 *  1. Explicitly chosen by the user (persisted in localStorage).
 *  2. Browser / OS UI language if it's one of our supported locales.
 *  3. English fallback. */
function detectInitialLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
      return stored as Locale;
    }
  } catch {
    // localStorage may be unavailable in test environments; fall through.
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  if (nav.toLowerCase().startsWith("zh")) return "zh";
  return "en";
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: detectInitialLocale(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Persist the chosen locale so future sessions remember it, then apply
 *  it to the i18next instance live. */
export function setLocale(locale: Locale) {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Ignore storage failures — the in-memory change still applies.
  }
  void i18n.changeLanguage(locale);
}

export default i18n;
