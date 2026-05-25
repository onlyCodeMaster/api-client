import { useState, useEffect } from "react";
import { Plus, Clock, FolderOpen, Trash2, FolderPlus, Search, X, Moon, Sun } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";

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
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

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
  const {
    history,
    collections,
    createNewRequest,
    loadFromHistory,
    deleteRequestFromHistory,
    clearAllHistory,
    searchHistory,
    addCollection,
    deleteCollection,
    loadRequestFromCollection,
    deleteRequestFromCollection,
    addRequestToCollection,
    activeRequestId,
  } = useRequestStore();

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      searchHistory(query.trim());
    } else {
      // Reload full history
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

  return (
    <div className="w-64 bg-sidebar backdrop-blur-xl border-r border-border-light flex flex-col h-full">
      {/* Drag region + title */}
      <div className="pt-5 px-4 pb-3">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-[15px] font-semibold text-text-primary tracking-tight">API Client</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleDark}
              className="relative z-10 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
              title={dark ? "Light mode" : "Dark mode"}
            >
              {dark ? <Sun size={15} className="text-text-secondary" /> : <Moon size={15} className="text-text-secondary" />}
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
              <Plus size={16} className="text-accent" strokeWidth={2.2} />
            </button>
          </div>
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
            {/* Add collection button */}
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
                <button
                  onClick={() => setShowNewCollection(true)}
                  className="flex items-center gap-1.5 w-full text-[12px] text-accent hover:text-accent-hover transition-colors py-1"
                >
                  <FolderPlus size={13} strokeWidth={2} />
                  New Collection
                </button>
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
                <div key={collection.id}>
                  <div className="group flex items-center gap-2 px-2.5 py-2 text-[11px] font-semibold text-text-tertiary uppercase tracking-wider">
                    <FolderOpen size={13} strokeWidth={1.8} />
                    <span className="truncate flex-1">{collection.name}</span>
                    <span className="text-text-tertiary bg-surface-secondary px-1.5 py-0.5 rounded-md text-[10px]">
                      {collection.requests.length}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete collection "${collection.name}"?`)) {
                          deleteCollection(collection.id);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-error/10 rounded-md transition-all"
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
                      className="group flex items-center gap-2.5 px-2.5 py-[7px] ml-2 rounded-lg hover:bg-black/[0.04] cursor-pointer transition-colors"
                      onClick={() => loadRequestFromCollection(collection.id, item.id)}
                    >
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 ${METHOD_BADGE[item.method] || ""}`}>
                        {item.method}
                      </span>
                      <span className="text-[12px] text-text-secondary truncate flex-1">
                        {item.name || item.url || "Untitled"}
                      </span>
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
    </div>
  );
}
