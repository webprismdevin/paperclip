import type { PluginPageProps } from "@paperclipai/plugin-sdk/ui";
import { usePluginData, usePluginAction, useHostContext } from "@paperclipai/plugin-sdk/ui";
import { useState, useEffect, useRef, useCallback } from "react";
import type {
  ChatThread,
  ChatMessage,
  ChatSegment,
  ChatAdapterInfo,
} from "../types.js";

// ---------------------------------------------------------------------------
// ChatPage — full-page chat interface rendered in the plugin page slot
// ---------------------------------------------------------------------------

export function ChatPage(_props: PluginPageProps) {
  const { companyId } = useHostContext();

  // Thread state
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedAdapter, setSelectedAdapter] = useState("claude_local");
  const [selectedModel, setSelectedModel] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Bridge hooks
  const { data: threads, refresh: refreshThreads } = usePluginData<ChatThread[]>("threads", {
    companyId,
  });
  const { data: messages, refresh: refreshMessages } = usePluginData<ChatMessage[]>("messages", {
    threadId: selectedThreadId,
  });
  const { data: adapters } = usePluginData<ChatAdapterInfo[]>("adapters", {});
  const createThread = usePluginAction("createThread");
  const deleteThread = usePluginAction("deleteThread");
  const sendMessage = usePluginAction("sendMessage");
  const stopThread = usePluginAction("stopThread");

  // Derived state
  const availableAdapters = adapters?.filter((a) => a.available) ?? [];
  const currentAdapter = availableAdapters.find((a) => a.type === selectedAdapter) ?? availableAdapters[0];
  const currentModels = currentAdapter?.models ?? [];
  const selectedThread = threads?.find((t) => t.id === selectedThreadId) ?? null;
  const isStreaming = selectedThread?.status === "running";

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Poll for messages while streaming (until SSE bridge lands)
  useEffect(() => {
    if (!isStreaming || !selectedThreadId) return;
    const interval = setInterval(() => {
      refreshMessages();
      refreshThreads();
    }, 1000);
    return () => clearInterval(interval);
  }, [isStreaming, selectedThreadId, refreshMessages, refreshThreads]);

  // Lock adapter on existing thread
  useEffect(() => {
    if (selectedThread) {
      setSelectedAdapter(selectedThread.adapterType);
      setSelectedModel(selectedThread.model);
    }
  }, [selectedThread]);

  // Default model to first available when adapter changes
  useEffect(() => {
    if (currentModels.length > 0 && !currentModels.find((m) => m.id === selectedModel)) {
      setSelectedModel(currentModels[0]!.id);
    }
  }, [currentModels, selectedModel]);

  // ── Handlers ────────────────────────────────────────────────────

  const handleNewThread = useCallback(async () => {
    const thread = await createThread({
      companyId,
      adapterType: selectedAdapter,
      model: selectedModel,
      title: "New Chat",
    }) as ChatThread;
    setSelectedThreadId(thread.id);
    refreshThreads();
  }, [companyId, selectedAdapter, selectedModel, createThread, refreshThreads]);

  const handleDeleteThread = useCallback(async (threadId: string) => {
    await deleteThread({ threadId, companyId });
    if (selectedThreadId === threadId) setSelectedThreadId(null);
    refreshThreads();
  }, [companyId, deleteThread, selectedThreadId, refreshThreads]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    let threadId = selectedThreadId;

    // Auto-create thread if none selected
    if (!threadId) {
      const thread = await createThread({
        companyId,
        adapterType: selectedAdapter,
        model: selectedModel,
      }) as ChatThread;
      threadId = thread.id;
      setSelectedThreadId(threadId);
    }

    setSending(true);
    setInput("");

    try {
      await sendMessage({
        threadId,
        message: trimmed,
        companyId,
      });
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setSending(false);
      refreshMessages();
      refreshThreads();
    }
  }, [input, sending, selectedThreadId, companyId, selectedAdapter, selectedModel, createThread, sendMessage, refreshMessages, refreshThreads]);

  const handleStop = useCallback(async () => {
    if (!selectedThreadId) return;
    await stopThread({ threadId: selectedThreadId, companyId });
    refreshThreads();
  }, [selectedThreadId, companyId, stopThread, refreshThreads]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Thread sidebar */}
      <div style={{
        width: 240,
        borderRight: "1px solid var(--border, #e2e8f0)",
        display: "flex",
        flexDirection: "column",
        background: "var(--card, #fff)",
      }}>
        <div style={{ padding: "12px", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
          <button
            onClick={handleNewThread}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 6,
              border: "none",
              background: "var(--primary, #2563eb)",
              color: "var(--primary-foreground, #fff)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            + New Chat
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {threads?.map((thread) => (
            <div
              key={thread.id}
              onClick={() => setSelectedThreadId(thread.id)}
              style={{
                padding: "10px 12px",
                cursor: "pointer",
                borderBottom: "1px solid var(--border, #e2e8f0)",
                background: thread.id === selectedThreadId ? "var(--accent, #f1f5f9)" : "transparent",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13,
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--foreground, #1e293b)",
                }}>
                  {thread.title}
                </div>
                <div style={{ fontSize: 10, color: "var(--muted-foreground, #94a3b8)", marginTop: 2 }}>
                  {thread.adapterType.replace("_local", "")} {thread.status === "running" ? "..." : ""}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleDeleteThread(thread.id); }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--muted-foreground, #94a3b8)",
                  fontSize: 14,
                  padding: "2px 4px",
                }}
                title="Delete thread"
              >
                x
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Messages */}
        <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
          {!selectedThreadId && (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--muted-foreground, #94a3b8)",
              fontSize: 14,
            }}>
              Select a thread or start a new chat
            </div>
          )}
          {messages?.map((msg) => (
            <div key={msg.id} style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: msg.role === "user" ? "var(--primary, #2563eb)" : "var(--muted-foreground, #94a3b8)",
                marginBottom: 4,
              }}>
                {msg.role}
              </div>
              <div style={{
                fontSize: 14,
                lineHeight: 1.6,
                color: "var(--foreground, #1e293b)",
                whiteSpace: "pre-wrap",
              }}>
                {msg.content}
              </div>
              {/* Render tool segments */}
              {msg.metadata?.segments
                ?.filter((s: ChatSegment) => s.kind === "tool")
                .map((seg: ChatSegment, i: number) => {
                  if (seg.kind !== "tool") return null;
                  return (
                    <div key={i} style={{
                      marginTop: 8,
                      padding: "8px 12px",
                      borderRadius: 6,
                      background: "var(--accent, #f1f5f9)",
                      fontSize: 12,
                      fontFamily: "monospace",
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        {seg.name}
                      </div>
                      {seg.result && (
                        <div style={{
                          color: seg.isError ? "var(--destructive, #ef4444)" : "var(--muted-foreground, #94a3b8)",
                          maxHeight: 120,
                          overflow: "auto",
                        }}>
                          {seg.result}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div style={{
          borderTop: "1px solid var(--border, #e2e8f0)",
          padding: "12px 24px",
          background: "var(--card, #fff)",
        }}>
          <div style={{ display: "flex", gap: 8 }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedThreadId ? "Type a message..." : "Start a new chat..."}
              rows={2}
              style={{
                flex: 1,
                resize: "none",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border, #e2e8f0)",
                fontSize: 14,
                fontFamily: "inherit",
                background: "var(--background, #fff)",
                color: "var(--foreground, #1e293b)",
                outline: "none",
              }}
            />
            {isStreaming ? (
              <button
                onClick={handleStop}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--destructive, #ef4444)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                  alignSelf: "flex-end",
                }}
              >
                Stop
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "var(--primary, #2563eb)",
                  color: "var(--primary-foreground, #fff)",
                  cursor: input.trim() && !sending ? "pointer" : "not-allowed",
                  opacity: input.trim() && !sending ? 1 : 0.4,
                  fontSize: 13,
                  fontWeight: 500,
                  alignSelf: "flex-end",
                }}
              >
                {sending ? "..." : "Send"}
              </button>
            )}
          </div>

          {/* Adapter / model selector */}
          <div style={{
            display: "flex",
            gap: 8,
            marginTop: 8,
            fontSize: 11,
            color: "var(--muted-foreground, #94a3b8)",
          }}>
            {availableAdapters.length > 1 && (
              <select
                value={selectedAdapter}
                onChange={(e) => setSelectedAdapter(e.target.value)}
                disabled={!!selectedThread}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  fontSize: "inherit",
                  cursor: selectedThread ? "not-allowed" : "pointer",
                  opacity: selectedThread ? 0.5 : 1,
                }}
              >
                {availableAdapters.map((a) => (
                  <option key={a.type} value={a.type}>{a.label}</option>
                ))}
              </select>
            )}
            {currentModels.length > 0 && (
              <>
                {availableAdapters.length > 1 && <span>/</span>}
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "inherit",
                    fontSize: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {currentModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </>
            )}
            <span style={{ marginLeft: "auto" }}>Shift+Enter for new line</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatSidebarPanel — compact sidebar entry point
// ---------------------------------------------------------------------------

export function ChatSidebarPanel() {
  return (
    <div style={{ padding: 12, fontSize: 13, color: "var(--muted-foreground, #94a3b8)" }}>
      Open Chat from the sidebar to start a conversation.
    </div>
  );
}
