import { useState, useEffect, useRef } from "react";
import {
  Plus,
  Clock,
  FolderOpen,
  Trash2,
  FolderPlus,
  Search,
  X,
  Moon,
  Sun,
  Pencil,
  Globe,
  Cookie,
  Settings as SettingsIcon,
  Upload,
  Download,
  ChevronDown,
  KeyRound,
  Play,
} from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";
import { EnvironmentPanel } from "./EnvironmentPanel";
import { CookiesPanel } from "./CookiesPanel";
import { SettingsPanel } from "./SettingsPanel";
import { collectionToPostman, postmanToCollection } from "../utils/postman";
import { openapiToCollection } from "../utils/openapi";
import { insomniaToCollections } from "../utils/insomnia";
import { harToCollection } from "../utils/har";
import { httpFileToCollection } from "../utils/http-file";
import { CollectionAuthModal } from "./CollectionAuthModal";
import { CollectionRunnerModal } from "./CollectionRunnerModal";

/** Heuristic format sniffers used by `handleImportFile`. */
function isHar(d: unknown): boolean {
  const r = d as { log?: { version?: unknown; entries?: unknown } } | null;
  return !!r && typeof r.log === "object" && Array.isArray(r.log?.entries);
}
function isOpenApi(d: unknown): boolean {
  const r = d as { openapi?: string; swagger?: string; paths?: unknown } | null;
  return !!r && (typeof r.openapi === "string" || typeof r.swagger === "string") && typeof r.paths === "object";
}
function isInsomnia(d: unknown): boolean {
  const r = d as { _type?: string; resources?: unknown } | null;
  return !!r && r._type === "export" && Array.isArray(r.resources);
}
function isPostman(d: unknown): boolean {
  const r = d as { info?: { schema?: string } } | null;
  return !!r && typeof r.info?.schema === "string" && r.info.schema.includes("postman");
}

const METHOD_BADGE: Record<string, string> = {
  GET: "bg-success/15 text-success",
  POST: "bg-orange/15 text-orange",
  PUT: "bg-accent/15 text-accent",
  PATCH: "bg-purple/15 text-purple",
  DELETE: "bg-error/15 text-error",
  HEAD: "bg-text-tertiary/15 text-text-secondary",
  OPTIONS: "bg-text-tertiary/15 text-text-secondary",
};

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<"history" | "collections">("history");
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [showEnvPanel, setShowEnvPanel] = useState(false);
  const [showCookies, setShowCookies] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [renamingCollection, setRenamingCollection] = useState<string | null>(null);
  const [renamingRequest, setRenamingRequest] = useState<{ colId: string; reqId: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showEnvDropdown, setShowEnvDropdown] = useState(false);
  const [editingAuthCollectionId, setEditingAuthCollectionId] = useState<string | null>(null);
  const [runnerCollectionId, setRunnerCollectionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  };

  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      setDark(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  // Close the environment dropdown when clicking outside of it
  useEffect(() => {
    if (!showEnvDropdown) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-env-dropdown]")) {
        setShowEnvDropdown(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showEnvDropdown]);

  const {
    history,
    collections,
    environments,
    workspace,
    createNewRequest,
    loadFromHistory,
    deleteRequestFromHistory,
    clearAllHistory,
    searchHistory,
    addCollection,
    deleteCollection,
    renameCollection,
    renameRequestInCollection,
    loadRequestFromCollection,
    deleteRequestFromCollection,
    addRequestToCollection,
    reorderHistory,
    reorderCollections,
    reorderRequestsInCollection,
    importPostmanCollection,
    importCollections,
    setActiveEnvironment,
    activeRequestId,
  } = useRequestStore();

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      searchHistory(query.trim());
    } else {
      useRequestStore.getState().initialize();
    }
  };

  const handleAddCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    await addCollection(name);
    setNewCollectionName("");
    setShowNewCollection(false);
  };

  const startRenameCollection = (id: string, currentName: string) => {
    setRenamingCollection(id);
    setRenameValue(currentName);
  };

  const commitRenameCollection = async () => {
    const n = renameValue.trim();
    if (renamingCollection && n) {
      await renameCollection(renamingCollection, n);
    }
    setRenamingCollection(null);
    setRenameValue("");
  };

  const startRenameRequest = (colId: string, reqId: string, currentName: string) => {
    setRenamingRequest({ colId, reqId });
    setRenameValue(currentName);
  };

  const commitRenameRequest = async () => {
    const n = renameValue.trim();
    if (renamingRequest && n) {
      await renameRequestInCollection(renamingRequest.colId, renamingRequest.reqId, n);
    }
    setRenamingRequest(null);
    setRenameValue("");
  };

  const activeEnv = environments.find((e) => e.id === workspace?.active_environment_id);

  /**
   * Auto-detect the import format from the file name and contents. We try in
   * descending order of specificity so e.g. an OpenAPI YAML doesn't get
   * misclassified as a Postman JSON.
   */
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const name = file.name.toLowerCase();

      if (name.endsWith(".http") || name.endsWith(".rest")) {
        await importCollections([httpFileToCollection(text, file.name)]);
      } else if (name.endsWith(".yaml") || name.endsWith(".yml")) {
        await importCollections([openapiToCollection(text)]);
      } else {
        // JSON-based formats: sniff the contents.
        const data = JSON.parse(text);
        if (isHar(data)) {
          await importCollections([harToCollection(data)]);
        } else if (isOpenApi(data)) {
          await importCollections([openapiToCollection(data)]);
        } else if (isInsomnia(data)) {
          await importCollections(insomniaToCollections(data));
        } else if (isPostman(data)) {
          await importPostmanCollection(data);
        } else {
          // Fall back to Postman so legacy files still work — postmanToCollection
          // is lenient enough to wrap any item-shaped object.
          await importCollections(postmanToCollection(data));
        }
      }
    } catch (err) {
      alert(`Failed to import collection: ${String(err)}`);
    } finally {
      e.target.value = "";
    }
  };

  const exportPostman = (colId: string) => {
    const col = collections.find((c) => c.id === colId);
    if (!col) return;
    const data = collectionToPostman(col);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${col.name.replace(/[^a-z0-9-_ ]/gi, "_")}.postman_collection.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-64 bg-sidebar backdrop-blur-xl border-r border-border-light flex flex-col h-full">
      {/* Drag region + title */}
      <div className="pt-5 px-4 pb-3">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-[15px] font-semibold text-text-primary tracking-tight">API Client</h1>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setShowCookies(true)}
              className="relative z-10 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
              title="Cookies"
            >
              <Cookie size={14} className="text-text-secondary" />
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="relative z-10 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
              title="Settings"
            >
              <SettingsIcon size={14} className="text-text-secondary" />
            </button>
            <button
              onClick={toggleDark}
              className="relative z-10 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
              title={dark ? "Light mode" : "Dark mode"}
            >
              {dark ? <Sun size={14} className="text-text-secondary" /> : <Moon size={14} className="text-text-secondary" />}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                createNewRequest();
              }}
              className="relative z-10 w-7 h-7 flex items-center justify-center rounded-lg bg-accent/10 hover:bg-accent/20 active:scale-95 transition-all cursor-pointer"
              title="New Request"
            >
              <Plus size={15} className="text-accent" strokeWidth={2.2} />
            </button>
          </div>
        </div>

        {/* Environment selector */}
        <div className="relative mb-3" data-env-dropdown>
          <button
            onClick={() => setShowEnvDropdown((v) => !v)}
            className="w-full flex items-center justify-between gap-1.5 px-2.5 py-1.5 bg-surface-secondary hover:bg-surface-secondary/70 rounded-lg text-[12px] text-text-secondary transition-colors"
          >
            <span className="flex items-center gap-1.5 truncate">
              <Globe size={12} className="text-accent shrink-0" />
              <span className="truncate">{activeEnv ? activeEnv.name : "No environment"}</span>
            </span>
            <ChevronDown size={11} className="text-text-tertiary shrink-0" />
          </button>
          {showEnvDropdown && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-surface rounded-apple shadow-apple-lg border border-border-light z-30 overflow-hidden">
              <button
                onClick={() => {
                  setActiveEnvironment(null);
                  setShowEnvDropdown(false);
                }}
                className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-surface-secondary transition-colors ${!activeEnv ? "text-accent" : "text-text-secondary"}`}
              >
                No environment
              </button>
              {environments.map((env) => (
                <button
                  key={env.id}
                  onClick={() => {
                    setActiveEnvironment(env.id);
                    setShowEnvDropdown(false);
                  }}
                  className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-surface-secondary transition-colors ${env.id === activeEnv?.id ? "text-accent" : "text-text-primary"}`}
                >
                  {env.name}
                </button>
              ))}
              <button
                onClick={() => {
                  setShowEnvPanel(true);
                  setShowEnvDropdown(false);
                }}
                className="block w-full text-left px-3 py-1.5 text-[12px] text-accent hover:bg-accent/10 transition-colors border-t border-border-light"
              >
                Manage environments…
              </button>
            </div>
          )}
        </div>

        {/* Segmented Control */}
        <div className="segmented-control w-full">
          <button
            onClick={() => setActiveTab("history")}
            className={`segment flex-1 ${activeTab === "history" ? "segment-active" : ""}`}
          >
            History
          </button>
          <button
            onClick={() => setActiveTab("collections")}
            className={`segment flex-1 ${activeTab === "collections" ? "segment-active" : ""}`}
          >
            Collections
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {activeTab === "history" && (
          <div>
            {/* Search bar */}
            <div className="px-0.5 pb-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search history..."
                  className="input-apple w-full text-[12px] py-[5px] pl-8 pr-7"
                />
                {searchQuery && (
                  <button
                    onClick={() => handleSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-secondary"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-0.5">
              {history.length === 0 && (
                <div className="text-center py-12">
                  <Clock size={28} className="mx-auto text-text-tertiary mb-2" strokeWidth={1.5} />
                  <p className="text-text-tertiary text-[12px]">
                    {searchQuery ? "No results found" : "No requests yet"}
                  </p>
                </div>
              )}
              {history.map((item) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => setDraggingId(item.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggingId) reorderHistory(draggingId, item.id);
                    setDraggingId(null);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                  className={`group flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg hover:bg-black/[0.04] active:bg-black/[0.06] cursor-pointer transition-colors ${activeRequestId === item.id ? "bg-accent/[0.07]" : ""}`}
                  onClick={() => loadFromHistory(item.id)}
                >
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 ${METHOD_BADGE[item.method] || ""}`}
                  >
                    {item.method}
                  </span>
                  <span className="text-[12px] text-text-secondary truncate flex-1">
                    {(() => {
                      try { return new URL(item.url).pathname; } catch { return item.url || "Untitled"; }
                    })()}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteRequestFromHistory(item.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-error/10 rounded-md transition-all"
                  >
                    <Trash2 size={12} className="text-error/70" />
                  </button>
                </div>
              ))}
            </div>

            {history.length > 0 && !searchQuery && (
              <button
                onClick={() => clearAllHistory()}
                className="mt-3 w-full text-center text-[11px] text-text-tertiary hover:text-error transition-colors py-1.5"
              >
                Clear All History
              </button>
            )}
          </div>
        )}

        {activeTab === "collections" && (
          <div>
            {/* Add / import */}
            <div className="px-0.5 pb-2">
              {showNewCollection ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddCollection();
                      if (e.key === "Escape") setShowNewCollection(false);
                    }}
                    placeholder="Collection name"
                    className="input-apple flex-1 text-[12px] py-[5px]"
                    autoFocus
                  />
                  <button
                    onClick={handleAddCollection}
                    className="text-[11px] text-accent font-medium px-2 py-1 hover:bg-accent/10 rounded-md transition-colors"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => setShowNewCollection(false)}
                    className="p-1 hover:bg-black/5 rounded-md transition-colors"
                  >
                    <X size={12} className="text-text-tertiary" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setShowNewCollection(true)}
                    className="flex items-center gap-1.5 text-[12px] text-accent hover:text-accent-hover transition-colors py-1"
                  >
                    <FolderPlus size={13} strokeWidth={2} />
                    New Collection
                  </button>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent transition-colors"
                    title="Import Postman / OpenAPI / Insomnia / HAR / .http file"
                  >
                    <Upload size={11} />
                    Import
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.yaml,.yml,.har,.http,.rest,application/json,text/yaml"
                    className="hidden"
                    onChange={handleImportFile}
                  />
                </div>
              )}
            </div>

            <div className="space-y-1">
              {collections.length === 0 && !showNewCollection && (
                <div className="text-center py-12">
                  <FolderOpen size={28} className="mx-auto text-text-tertiary mb-2" strokeWidth={1.5} />
                  <p className="text-text-tertiary text-[12px]">No collections yet</p>
                </div>
              )}
              {collections.map((collection) => (
                <div
                  key={collection.id}
                  draggable={!renamingCollection && !renamingRequest}
                  onDragStart={() => setDraggingId(collection.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggingId) reorderCollections(draggingId, collection.id);
                    setDraggingId(null);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                >
                  <div className="group flex items-center gap-2 px-2.5 py-2 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                    <FolderOpen size={13} strokeWidth={1.8} />
                    {renamingCollection === collection.id ? (
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRenameCollection}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRenameCollection();
                          if (e.key === "Escape") {
                            setRenamingCollection(null);
                            setRenameValue("");
                          }
                        }}
                        className="flex-1 bg-surface text-text-primary px-1.5 py-0.5 rounded text-[11px] normal-case font-normal tracking-normal"
                        autoFocus
                      />
                    ) : (
                      <span
                        className="truncate flex-1"
                        onDoubleClick={() => startRenameCollection(collection.id, collection.name)}
                        title="Double-click to rename"
                      >
                        {collection.name}
                      </span>
                    )}
                    <span className="text-text-tertiary bg-surface-secondary px-1.5 py-0.5 rounded-md text-[10px]">
                      {collection.requests.length}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startRenameCollection(collection.id, collection.name);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent/10 rounded-md transition-all"
                      title="Rename collection"
                    >
                      <Pencil size={11} className="text-text-tertiary" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingAuthCollectionId(collection.id);
                      }}
                      className={`opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent/10 rounded-md transition-all ${collection.auth && collection.auth.auth_type !== "none" ? "!opacity-100" : ""}`}
                      title={
                        collection.auth && collection.auth.auth_type !== "none"
                          ? `Edit collection auth (currently ${collection.auth.auth_type})`
                          : "Set collection auth (inherited by requests with 'Inherit')"
                      }
                    >
                      <KeyRound
                        size={11}
                        className={collection.auth && collection.auth.auth_type !== "none" ? "text-accent" : "text-text-tertiary"}
                      />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRunnerCollectionId(collection.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent/10 rounded-md transition-all"
                      title="Run collection"
                    >
                      <Play size={11} className="text-text-tertiary" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        exportPostman(collection.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent/10 rounded-md transition-all"
                      title="Export as Postman v2.1"
                    >
                      <Download size={11} className="text-text-tertiary" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete collection "${collection.name}"?`)) {
                          deleteCollection(collection.id);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-error/10 rounded-md transition-all"
                      title="Delete collection"
                    >
                      <Trash2 size={11} className="text-error/70" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        addRequestToCollection(collection.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-accent/10 rounded-md transition-all"
                      title="Save current request to collection"
                    >
                      <Plus size={11} className="text-accent" />
                    </button>
                  </div>
                  {collection.requests.map((item) => (
                    <div
                      key={item.id}
                      draggable={!renamingRequest}
                      onDragStart={(e) => {
                        e.stopPropagation();
                        setDraggingId(`${collection.id}::${item.id}`);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (draggingId && draggingId.startsWith(`${collection.id}::`)) {
                          const [, fromId] = draggingId.split("::");
                          if (fromId) reorderRequestsInCollection(collection.id, fromId, item.id);
                        }
                        setDraggingId(null);
                      }}
                      className="group flex items-center gap-2.5 px-2.5 py-[7px] ml-2 rounded-lg hover:bg-black/[0.04] cursor-pointer transition-colors"
                      onClick={() => loadRequestFromCollection(collection.id, item.id)}
                    >
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 ${METHOD_BADGE[item.method] || ""}`}>
                        {item.method}
                      </span>
                      {renamingRequest?.colId === collection.id && renamingRequest?.reqId === item.id ? (
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={commitRenameRequest}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRenameRequest();
                            if (e.key === "Escape") {
                              setRenamingRequest(null);
                              setRenameValue("");
                            }
                          }}
                          className="flex-1 bg-surface text-text-primary px-1.5 py-0.5 rounded text-[12px]"
                          autoFocus
                        />
                      ) : (
                        <span
                          className="text-[12px] text-text-secondary truncate flex-1"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            startRenameRequest(collection.id, item.id, item.name);
                          }}
                          title="Double-click to rename"
                        >
                          {item.name || item.url || "Untitled"}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startRenameRequest(collection.id, item.id, item.name);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-accent/10 rounded-md transition-all"
                        title="Rename request"
                      >
                        <Pencil size={11} className="text-text-tertiary" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteRequestFromCollection(collection.id, item.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-error/10 rounded-md transition-all"
                      >
                        <Trash2 size={11} className="text-error/70" />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showEnvPanel && <EnvironmentPanel onClose={() => setShowEnvPanel(false)} />}
      {showCookies && <CookiesPanel onClose={() => setShowCookies(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      <CollectionAuthModal
        collectionId={editingAuthCollectionId}
        onClose={() => setEditingAuthCollectionId(null)}
      />
      {runnerCollectionId && (
        <CollectionRunnerModal
          collectionId={runnerCollectionId}
          onClose={() => setRunnerCollectionId(null)}
        />
      )}
    </div>
  );
}
