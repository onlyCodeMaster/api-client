import { create } from "zustand";

type PanelKey = "collections" | "history" | "environments" | "settings";
type RequestTab = "params" | "headers" | "body" | "auth";

type UiState = {
  activeSidebarPanel: PanelKey;
  requestTab: RequestTab;
  responseTab: "body" | "headers" | "timeline";
  setActiveSidebarPanel: (panel: PanelKey) => void;
  setRequestTab: (tab: RequestTab) => void;
  setResponseTab: (tab: UiState["responseTab"]) => void;
};

export const useUiStore = create<UiState>((set) => ({
  activeSidebarPanel: "collections",
  requestTab: "body",
  responseTab: "body",
  setActiveSidebarPanel: (panel) => set({ activeSidebarPanel: panel }),
  setRequestTab: (tab) => set({ requestTab: tab }),
  setResponseTab: (tab) => set({ responseTab: tab }),
}));
