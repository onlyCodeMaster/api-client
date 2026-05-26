import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
// Side-effect import: registers translations and sets the initial locale
// before any component reads `useTranslation()`.
import "./i18n";
import { installE2EMockIPC, isE2EMode } from "./utils/e2eMockTauri";

// E2E mode (Playwright opt-in via `?e2e=1`): swap the Tauri IPC out for an
// in-process mock BEFORE React mounts so the store's `initialize()` sees
// the mocked backend. No-op in production builds — the desktop app is
// never loaded with that query string.
if (isE2EMode()) {
  installE2EMockIPC();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
