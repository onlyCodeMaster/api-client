import { useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { RequestPanel } from "./components/RequestPanel";
import { ResponsePanel } from "./components/ResponsePanel";
import { TabBar } from "./components/TabBar";
import { WsPanel } from "./components/WsPanel";
import { useRequestStore } from "./store/useRequestStore";

interface WsEvent {
  request_id: string;
  kind: string;
  text: string | null;
}

function App() {
  const initialize = useRequestStore((s) => s.initialize);
  const initialized = useRequestStore((s) => s.initialized);
  const activeRequest = useRequestStore((s) => s.activeRequest);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Listen for WS events from the Rust backend
  useEffect(() => {
    const unlistenPromise = listen<WsEvent>("ws-event", (event) => {
      const { request_id, kind, text } = event.payload;
      useRequestStore.getState().appendWsEvent(request_id, kind, text);
    });
    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  // Global keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isMeta = e.metaKey || e.ctrlKey;

    // Cmd+Enter: Send request
    if (isMeta && e.key === "Enter") {
      e.preventDefault();
      useRequestStore.getState().sendRequest();
      return;
    }

    // Cmd+N or Cmd+T: New request / tab
    if (isMeta && (e.key === "n" || e.key === "t")) {
      e.preventDefault();
      useRequestStore.getState().createNewRequest();
      return;
    }

    // Cmd+W: Close active tab
    if (isMeta && e.key === "w") {
      e.preventDefault();
      const { activeTabId } = useRequestStore.getState();
      if (activeTabId) useRequestStore.getState().closeTab(activeTabId);
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

  const isWs = activeRequest?.protocol === "websocket";

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TabBar />
        <div className="flex-1 flex flex-col gap-0 p-3 pl-0 h-full">
          <div className="bg-surface rounded-t-apple-lg shadow-apple overflow-hidden flex flex-col" style={{ height: "48%" }}>
            <RequestPanel />
          </div>
          <div className="bg-surface rounded-b-apple-lg shadow-apple overflow-hidden flex-1 flex flex-col border-t border-border-light">
            {isWs ? <WsPanel /> : <ResponsePanel />}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
