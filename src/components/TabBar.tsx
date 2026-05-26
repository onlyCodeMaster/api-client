import { useState } from "react";
import { X, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRequestStore } from "../store/useRequestStore";
import type { HttpMethod } from "../types";

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "text-success",
  POST: "text-orange",
  PUT: "text-accent",
  PATCH: "text-purple",
  DELETE: "text-error",
  HEAD: "text-text-secondary",
  OPTIONS: "text-text-secondary",
};

export function TabBar() {
  const { t } = useTranslation();
  const tabs = useRequestStore((s) => s.tabs);
  const activeTabId = useRequestStore((s) => s.activeTabId);
  const loadings = useRequestStore((s) => s.loadings);
  const setActiveTab = useRequestStore((s) => s.setActiveTab);
  const closeTab = useRequestStore((s) => s.closeTab);
  const createNewRequest = useRequestStore((s) => s.createNewRequest);
  const reorderTabs = useRequestStore((s) => s.reorderTabs);

  const [draggingId, setDraggingId] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-0.5 px-3 pt-2 overflow-x-auto border-b border-border-light bg-surface-secondary/40">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isLoading = !!loadings[tab.id];
        return (
          <div
            key={tab.id}
            draggable
            onDragStart={() => setDraggingId(tab.id)}
            onDragOver={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (draggingId && draggingId !== tab.id) {
                reorderTabs(draggingId, tab.id);
              }
              setDraggingId(null);
            }}
            onDragEnd={() => setDraggingId(null)}
            onClick={() => setActiveTab(tab.id)}
            className={`group flex items-center gap-1.5 px-2.5 py-1.5 rounded-t-md cursor-pointer min-w-[140px] max-w-[220px] border-t border-l border-r transition-colors ${
              isActive
                ? "bg-surface border-border-light text-text-primary"
                : "border-transparent text-text-secondary hover:bg-surface/60"
            }`}
            title={tab.name}
          >
            <span className={`text-[10px] font-semibold shrink-0 ${METHOD_COLORS[tab.method]}`}>
              {tab.protocol === "websocket" ? "WS" : tab.method}
            </span>
            <span className="text-[12px] truncate flex-1">{tab.name || t("tab.placeholder_name")}</span>
            {isLoading && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0 animate-pulse" />
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-black/5 rounded transition-all shrink-0"
              title={t("tab.close")}
            >
              <X size={11} className="text-text-tertiary" />
            </button>
          </div>
        );
      })}
      <button
        onClick={createNewRequest}
        className="ml-1 w-7 h-7 flex items-center justify-center rounded-md hover:bg-black/5 transition-colors shrink-0"
        title={t("tab.new_tab")}
      >
        <Plus size={14} className="text-text-tertiary" />
      </button>
    </div>
  );
}
