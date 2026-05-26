/**
 * Single source of truth for the app's light/dark theme.
 *
 * Theme state lives on `<html class="dark">`. We persist the user's choice
 * in `localStorage["theme"]` ("dark" | "light"), and fall back to the OS
 * `prefers-color-scheme` query when no choice has been made.
 *
 * `applyInitialTheme()` is intentionally a plain function (not a hook) so
 * `main.tsx` can call it BEFORE React mounts — this avoids a flash of the
 * wrong theme during initial paint.
 *
 * `applyTheme(dark)` is the write path: components changing the theme
 * (currently the Sidebar toggle and SettingsPanel) should call this — never
 * touch `document.documentElement.classList` or `localStorage` directly.
 *
 * Components reading the current theme use `useDarkMode()` from
 * `./useDarkMode`, which is driven by a `MutationObserver` on `<html>` so
 * any caller of `applyTheme` correctly notifies every subscriber.
 */

const STORAGE_KEY = "theme";

export type Theme = "light" | "dark";

/** Read the persisted theme (or fall back to the OS preference). */
export function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "dark") return "dark";
  if (saved === "light") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Toggle the `dark` class on `<html>` and persist the choice. */
export function applyTheme(dark: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", dark);
  try {
    window.localStorage.setItem(STORAGE_KEY, dark ? "dark" : "light");
  } catch {
    // localStorage may be unavailable in some embedded contexts; ignore.
  }
}

/** Convenience for the boot path. Reads the initial theme and applies it. */
export function applyInitialTheme(): void {
  applyTheme(getInitialTheme() === "dark");
}
