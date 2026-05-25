import { useEffect, useRef, useState } from "react";
import { useRequestStore } from "../store/useRequestStore";

export function WsPanel() {
  const activeRequest = useRequestStore((s) => s.activeRequest);
  const wsConnected = useRequestStore((s) => s.wsConnected);
  const wsMessages = useRequestStore((s) => s.wsMessages);
  const wsConnect = useRequestStore((s) => s.wsConnect);
  const wsSend = useRequestStore((s) => s.wsSend);
  const wsClose = useRequestStore((s) => s.wsClose);

  const [text, setText] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const id = activeRequest?.id;
  const connected = id ? !!wsConnected[id] : false;
  const messages = (id ? wsMessages[id] : undefined) ?? [];

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages.length]);

  if (!activeRequest) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2 flex items-center gap-2 border-b border-border-light">
        <span
          className={`w-2 h-2 rounded-full ${connected ? "bg-success" : "bg-text-tertiary"}`}
        />
        <span className="text-[12px] text-text-secondary">
          {connected ? "Connected" : "Disconnected"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {!connected ? (
            <button
              onClick={() => wsConnect()}
              disabled={!activeRequest.url}
              className="btn-send !py-1 !px-3 !text-[12px]"
            >
              Connect
            </button>
          ) : (
            <button
              onClick={() => wsClose()}
              className="px-3 py-1 bg-error text-white font-medium rounded-apple text-[12px] hover:bg-error/90 active:scale-[0.97] transition-all"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      <div ref={logRef} className="flex-1 overflow-auto p-3 space-y-1 bg-surface-secondary/40">
        {messages.length === 0 && (
          <div className="text-center py-12 text-[12px] text-text-tertiary">
            No messages yet. Connect and start sending.
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex items-start gap-2 px-2 py-1.5 rounded text-[12px] font-mono ${
              m.direction === "sent"
                ? "bg-accent/10 text-accent"
                : m.direction === "received"
                ? "bg-surface text-text-primary"
                : "bg-transparent text-text-tertiary italic"
            }`}
          >
            <span className="text-[10px] shrink-0 opacity-60">
              {new Date(m.ts).toLocaleTimeString()}
            </span>
            <span className="text-[10px] shrink-0 uppercase opacity-60 w-12">
              {m.direction}
            </span>
            <span className="flex-1 whitespace-pre-wrap break-all">{m.text}</span>
          </div>
        ))}
      </div>

      <div className="p-3 border-t border-border-light flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (text.trim()) {
                wsSend(text);
                setText("");
              }
            }
          }}
          placeholder="Type a message... (Cmd/Ctrl+Enter to send)"
          className="input-apple flex-1 font-mono text-[12px] resize-none h-14"
          disabled={!connected}
        />
        <button
          onClick={() => {
            if (text.trim()) {
              wsSend(text);
              setText("");
            }
          }}
          disabled={!connected || !text.trim()}
          className="btn-send"
        >
          Send
        </button>
      </div>
    </div>
  );
}
