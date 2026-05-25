import { useEffect, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { RequestPanel } from "./components/RequestPanel";
import { ResponsePanel } from "./components/ResponsePanel";
import { useRequestStore } from "./store/useRequestStore";

function App() {
  const initialize = useRequestStore((s) => s.initialize);
  const initialized = useRequestStore((s) => s.initialized);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Global keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isMeta = e.metaKey || e.ctrlKey;

    // Cmd+Enter: Send request
    if (isMeta && e.key === "Enter") {
      e.preventDefault();
      useRequestStore.getState().sendRequest();
      return;
    }

    // Cmd+N: New request
    if (isMeta && e.key === "n") {
      e.preventDefault();
      useRequestStore.getState().createNewRequest();
      return;
    }

    // Cmd+L: Focus URL bar
    if (isMeta && e.key === "l") {
      e.preventDefault();
      const urlInput = document.querySelector<HTMLInputElement>('input[placeholder*="api.example.com"]');
      urlInput?.focus();
      urlInput?.select();
      return;
    }

    // Escape: Cancel request
    if (e.key === "Escape") {
      const { loading } = useRequestStore.getState();
      if (loading) {
        e.preventDefault();
        useRequestStore.getState().cancelRequest();
      }
      return;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  if (!initialized) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-[13px] text-text-tertiary">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex flex-col gap-0 p-3 pl-0 h-full">
          <div className="bg-surface rounded-t-apple-lg shadow-apple overflow-hidden flex flex-col" style={{ height: "48%" }}>
            <RequestPanel />
          </div>
          <div className="bg-surface rounded-b-apple-lg shadow-apple overflow-hidden flex-1 flex flex-col border-t border-border-light">
            <ResponsePanel />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
