import { useEffect, useMemo, useState } from "react";
import { X, Trash2, Cookie, Search } from "lucide-react";
import { useRequestStore } from "../store/useRequestStore";

export function CookiesPanel({ onClose }: { onClose: () => void }) {
  const cookies = useRequestStore((s) => s.cookies);
  const refreshCookies = useRequestStore((s) => s.refreshCookies);
  const deleteCookie = useRequestStore((s) => s.deleteCookie);
  const clearCookiesByDomain = useRequestStore((s) => s.clearCookiesByDomain);
  const [query, setQuery] = useState("");

  useEffect(() => {
    refreshCookies();
  }, [refreshCookies]);

  const grouped = useMemo(() => {
    const filtered = cookies.filter((c) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        c.domain.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.value.toLowerCase().includes(q)
      );
    });
    const byDomain: Record<string, typeof cookies> = {};
    for (const c of filtered) {
      (byDomain[c.domain] ??= []).push(c);
    }
    return Object.entries(byDomain).sort(([a], [b]) => a.localeCompare(b));
  }, [cookies, query]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-surface rounded-apple-lg shadow-apple-lg w-[720px] max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-light">
          <div className="flex items-center gap-2">
            <Cookie size={18} className="text-accent" />
            <h2 className="text-[15px] font-semibold text-text-primary">Cookies</h2>
            <span className="text-[11px] text-text-tertiary">
              {cookies.length} total
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-secondary transition-colors"
          >
            <X size={16} className="text-text-tertiary" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border-light">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cookies by domain, name, value..."
              className="input-apple w-full text-[12px] py-[5px] pl-8"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-3 space-y-3">
          {grouped.length === 0 && (
            <div className="text-center py-12 text-[12px] text-text-tertiary">
              {cookies.length === 0 ? "No cookies stored" : "No matches"}
            </div>
          )}
          {grouped.map(([domain, list]) => (
            <div key={domain} className="bg-surface-secondary rounded-apple p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] font-semibold text-text-primary truncate">
                  {domain}
                </span>
                <button
                  onClick={() => clearCookiesByDomain(domain)}
                  className="text-[11px] text-error hover:text-error/80 transition-colors"
                >
                  Clear domain
                </button>
              </div>
              <div className="space-y-1">
                {list.map((c) => (
                  <div
                    key={c.id}
                    className="group grid grid-cols-[1fr_2fr_auto] items-center gap-2 px-2 py-1.5 bg-surface rounded text-[11px]"
                  >
                    <span className="font-mono text-text-primary truncate">{c.name}</span>
                    <span className="font-mono text-text-secondary truncate">{c.value}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-text-tertiary">{c.path}</span>
                      {c.secure && (
                        <span className="text-success text-[10px]">secure</span>
                      )}
                      {c.http_only && (
                        <span className="text-orange text-[10px]">http-only</span>
                      )}
                      <button
                        onClick={() => deleteCookie(c.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-error/10 rounded transition-all"
                      >
                        <Trash2 size={11} className="text-error/70" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
