import { useEffect, useState } from "react";

/**
 * Reactively tracks whether the document is currently in dark mode.
 *
 * Dark-mode state lives on `document.documentElement` (the `.dark` class is
 * toggled by the Sidebar theme switcher). Components that need to derive
 * visual state from this — e.g. picking a light vs dark JSON tree theme —
 * can't just read the class once at mount because the toggle doesn't
 * trigger a React re-render anywhere else in the tree.
 *
 * This hook uses a `MutationObserver` to watch the `class` attribute and
 * keeps a local state in sync. SSR-safe: returns `false` when `document`
 * is unavailable.
 */
export function useDarkMode(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === "undefined") return false;
    return document.documentElement.classList.contains("dark");
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    const update = () => setIsDark(el.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
