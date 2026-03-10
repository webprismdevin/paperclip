import type { PluginPageProps } from "@paperclipai/plugin-sdk/ui";
import { usePluginData, usePluginAction, useHostContext, usePluginStream } from "@paperclipai/plugin-sdk/ui";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ChatThread,
  ChatMessage,
  ChatSegment,
  ChatAdapterInfo,
  ChatStreamEvent,
} from "../types.js";

// ---------------------------------------------------------------------------
// Markdown link component — open links in new tab
// ---------------------------------------------------------------------------

const mdComponents: Record<string, React.ComponentType<any>> = {
  a: ({ href, children, ...props }: any) => (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
  ),
};

// ---------------------------------------------------------------------------
// CHAT_STYLES — CSS animations, markdown prose, scrollbar styling
// ---------------------------------------------------------------------------

const CHAT_STYLES = `
  .chat-msg-enter {
    animation: chatMsgSlide 380ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  @keyframes chatMsgSlide {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .chat-cursor::after {
    content: "▊";
    display: inline;
    animation: cursorBlink 800ms steps(2) infinite;
    color: var(--primary, #2563eb);
    font-weight: 400;
    margin-left: 1px;
  }
  @keyframes cursorBlink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
  .chat-tool-pulse {
    animation: toolPulse 1.8s ease-in-out infinite;
  }
  @keyframes toolPulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
  .chat-input-glow:focus-within {
    box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.3), 0 0 12px rgba(37, 99, 235, 0.08);
  }
  .chat-markdown h1, .chat-markdown h2, .chat-markdown h3 {
    font-weight: 600;
    margin-top: 1em;
    margin-bottom: 0.4em;
    line-height: 1.3;
  }
  .chat-markdown h1 { font-size: 1.15em; }
  .chat-markdown h2 { font-size: 1.05em; }
  .chat-markdown h3 { font-size: 0.95em; }
  .chat-markdown p { margin: 0.4em 0; }
  .chat-markdown ul, .chat-markdown ol { margin: 0.4em 0; padding-left: 1.5em; }
  .chat-markdown ul { list-style-type: disc; }
  .chat-markdown ol { list-style-type: decimal; }
  .chat-markdown li { margin: 0.15em 0; }
  .chat-markdown li::marker { color: rgba(100, 116, 139, 0.6); }
  .chat-markdown code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.88em;
    padding: 0.15em 0.35em;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.15);
  }
  .chat-markdown pre {
    margin: 0.6em 0;
    padding: 0.75em 1em;
    border-radius: 4px;
    overflow-x: auto;
    background: rgba(0, 0, 0, 0.2) !important;
    border: 1px solid rgba(0, 0, 0, 0.15);
  }
  .chat-markdown pre code {
    padding: 0;
    background: none;
    font-size: 0.85em;
    line-height: 1.5;
  }
  .chat-markdown a {
    color: var(--primary, #2563eb);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .chat-markdown blockquote {
    border-left: 2px solid rgba(0, 0, 0, 0.15);
    padding-left: 0.75em;
    margin: 0.5em 0;
    color: rgba(100, 116, 139, 0.8);
  }
  .chat-markdown table {
    border-collapse: collapse;
    margin: 0.5em 0;
    font-size: 0.9em;
  }
  .chat-markdown th, .chat-markdown td {
    border: 1px solid rgba(0, 0, 0, 0.15);
    padding: 0.35em 0.6em;
    text-align: left;
  }
  .chat-markdown th {
    background: rgba(0, 0, 0, 0.1);
    font-weight: 600;
  }
  .chat-scroll::-webkit-scrollbar { width: 4px; }
  .chat-scroll::-webkit-scrollbar-track { background: transparent; }
  .chat-scroll::-webkit-scrollbar-thumb {
    background: rgba(100, 116, 139, 0.3);
    border-radius: 2px;
  }
  .chat-scroll::-webkit-scrollbar-thumb:hover { background: rgba(100, 116, 139, 0.5); }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .chat-msg-enter { animation: none; }
    .chat-cursor::after { animation: none; }
    .chat-tool-pulse { animation: none; opacity: 1; }
  }
`;

// ---------------------------------------------------------------------------
// Segment grouping — collapses consecutive tool/thinking segments
// ---------------------------------------------------------------------------

type GroupedSegment =
  | { type: "text"; content: string; index: number }
  | { type: "error"; content: string; index: number }
  | { type: "activity"; segments: ChatSegment[]; startIndex: number };

function groupSegments(segments: ChatSegment[]): GroupedSegment[] {
  const groups: GroupedSegment[] = [];
  let activityBuf: ChatSegment[] = [];
  let activityStart = 0;

  const flushActivity = () => {
    if (activityBuf.length > 0) {
      groups.push({ type: "activity", segments: [...activityBuf], startIndex: activityStart });
      activityBuf = [];
    }
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind === "tool" || seg.kind === "thinking") {
      if (activityBuf.length === 0) activityStart = i;
      activityBuf.push(seg);
    } else if (seg.kind === "text") {
      flushActivity();
      groups.push({ type: "text", content: seg.content, index: i });
    }
  }
  flushActivity();
  return groups;
}

function summarizeTools(segments: ChatSegment[]): string {
  const tools = segments.filter((s) => s.kind === "tool");
  if (tools.length === 0) return "Thinking";
  const counts = new Map<string, number>();
  for (const t of tools) {
    if (t.kind === "tool") counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [name, count] of counts) {
    parts.push(count > 1 ? `${name} \u00d7${count}` : name);
  }
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Sub-components — ThinkingBlock, ToolCallDetail, ActivityGroup
// ---------------------------------------------------------------------------

function ThinkingBlock({ content, isLive }: { content: string; isLive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="chat-msg-enter" style={{ margin: "6px 0" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          color: "var(--muted-foreground, #94a3b8)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          opacity: 0.6,
        }}
      >
        <span style={{ fontSize: 10 }}>{expanded ? "\u25BC" : "\u25B6"}</span>
        <span>{isLive ? "Thinking\u2026" : "Thought process"}</span>
        {isLive && <span className="chat-tool-pulse" style={{ color: "var(--primary, #2563eb)" }}>{"\u25CF"}</span>}
      </button>
      {expanded && (
        <div style={{
          marginTop: 4,
          paddingLeft: 20,
          fontSize: 12,
          color: "var(--muted-foreground, #94a3b8)",
          opacity: 0.5,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          borderLeft: "2px solid var(--border, #e2e8f0)",
          marginLeft: 6,
        }}>
          {content}
        </div>
      )}
    </div>
  );
}

function ToolCallDetail({ seg, isLive }: { seg: Extract<ChatSegment, { kind: "tool" }>; isLive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = seg.result !== undefined;
  return (
    <div style={{ margin: "2px 0" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: 11,
          color: "var(--muted-foreground, #94a3b8)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "2px 0",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          opacity: 0.7,
        }}
      >
        <span style={{ fontSize: 9 }}>{expanded ? "\u25BC" : "\u25B6"}</span>
        <span>{seg.name}</span>
        {!hasResult && isLive && <span className="chat-tool-pulse" style={{ color: "#f59e0b", fontSize: 8 }}>{"\u25CF"}</span>}
        {hasResult && seg.isError && <span style={{ color: "#ef4444", fontSize: 10 }}>{"\u2715"}</span>}
        {hasResult && !seg.isError && <span style={{ color: "#22c55e", fontSize: 10 }}>{"\u2713"}</span>}
      </button>
      {expanded && (
        <div style={{
          marginLeft: 16,
          fontSize: 11,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        }}>
          {seg.input != null && (
            <div style={{
              padding: "4px 8px",
              background: "rgba(0,0,0,0.06)",
              borderRadius: 3,
              marginBottom: 4,
              maxHeight: 100,
              overflow: "auto",
              color: "var(--muted-foreground, #94a3b8)",
            }}>
              {typeof seg.input === "string" ? seg.input : JSON.stringify(seg.input, null, 2)}
            </div>
          )}
          {seg.result && (
            <div style={{
              padding: "4px 8px",
              background: seg.isError ? "rgba(239,68,68,0.08)" : "rgba(0,0,0,0.04)",
              borderRadius: 3,
              maxHeight: 120,
              overflow: "auto",
              color: seg.isError ? "#ef4444" : "var(--muted-foreground, #94a3b8)",
            }}>
              {seg.result}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityGroup({ segments, isLive }: { segments: ChatSegment[]; isLive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const toolCount = segments.filter((s) => s.kind === "tool").length;
  const hasErrors = segments.some((s) => s.kind === "tool" && (s as any).isError);
  const allDone = segments
    .filter((s) => s.kind === "tool")
    .every((s) => (s as any).result !== undefined);
  const activeTool = isLive
    ? segments.filter((s) => s.kind === "tool").reverse().find((s) => (s as any).result === undefined)
    : undefined;

  return (
    <div style={{ margin: "2px 0", opacity: 0.5 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          color: "var(--muted-foreground, #94a3b8)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "2px 0",
          opacity: 0.8,
        }}
      >
        <span style={{ fontSize: 9 }}>{expanded ? "\u25BC" : "\u25B6"}</span>
        {isLive && activeTool && activeTool.kind === "tool" ? (
          <span>
            Running <span style={{ fontFamily: "monospace" }}>{activeTool.name}</span>
            {toolCount > 1 && <span style={{ opacity: 0.6 }}>{" \u00B7 "}{toolCount} tools</span>}
          </span>
        ) : (
          <span>
            Used {toolCount} tool{toolCount !== 1 ? "s" : ""}
            <span style={{ opacity: 0.5, marginLeft: 4 }}>{summarizeTools(segments)}</span>
          </span>
        )}
        {isLive && !allDone && (
          <span className="chat-tool-pulse" style={{ color: "#f59e0b", fontSize: 8 }}>{"\u25CF"}</span>
        )}
        {!isLive && hasErrors && (
          <span style={{ color: "rgba(239,68,68,0.5)", fontSize: 10 }}>has errors</span>
        )}
      </button>
      {expanded && (
        <div style={{
          marginLeft: 16,
          marginTop: 2,
          borderLeft: "1px solid var(--border, rgba(0,0,0,0.1))",
          paddingLeft: 10,
        }}>
          {segments.map((seg, i) => {
            if (seg.kind === "tool") {
              return <ToolCallDetail key={i} seg={seg} isLive={isLive} />;
            }
            if (seg.kind === "thinking") {
              return <ThinkingBlock key={i} content={seg.content} isLive={isLive && i === segments.length - 1} />;
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// formatTime — relative time display
// ---------------------------------------------------------------------------

function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// MessageRow — renders a single persisted message
// ---------------------------------------------------------------------------

function MessageRow({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  const storedSegments = msg.metadata?.segments;
  const hasSegments = storedSegments && storedSegments.length > 0;

  return (
    <div className="chat-msg-enter" style={{
      display: "flex",
      gap: 12,
      padding: "12px 16px",
      background: isUser ? "rgba(0,0,0,0.02)" : "transparent",
    }}>
      <div style={{
        width: 24,
        height: 24,
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 600,
        flexShrink: 0,
        marginTop: 2,
        background: isUser ? "var(--primary, #2563eb)" : "rgba(37, 99, 235, 0.15)",
        color: isUser ? "#fff" : "var(--primary, #2563eb)",
      }}>
        {isUser ? "Y" : "P"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground, #1e293b)" }}>
            {isUser ? "You" : "Paperclip"}
          </span>
          <span style={{ fontSize: 10, color: "var(--muted-foreground, #94a3b8)", opacity: 0.6 }}>
            {formatTime(msg.createdAt)}
          </span>
        </div>
        <div style={{ fontSize: 14, color: "var(--foreground, #1e293b)", opacity: 0.9, lineHeight: 1.6 }}>
          {isUser ? (
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{msg.content}</p>
          ) : hasSegments ? (
            groupSegments(storedSegments).map((group, i) => {
              if (group.type === "text") {
                return (
                  <div key={i} className="chat-markdown">
                    <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{group.content}</Markdown>
                  </div>
                );
              }
              if (group.type === "activity") {
                return <ActivityGroup key={i} segments={group.segments} isLive={false} />;
              }
              if (group.type === "error") {
                return (
                  <div key={i} style={{ margin: "4px 0", fontSize: 14, color: "#ef4444" }}>
                    {group.content}
                  </div>
                );
              }
              return null;
            })
          ) : (
            <div className="chat-markdown">
              <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{msg.content}</Markdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StreamingMessage — renders the live assistant response
// ---------------------------------------------------------------------------

function StreamingMessage({
  segments,
  streamingText,
  streamingThinking,
  isActive,
}: {
  segments: ChatSegment[];
  streamingText: string;
  streamingThinking: string;
  isActive: boolean;
}) {
  // Build a combined segment list from stored segments + live streaming text
  const allSegments: ChatSegment[] = [...segments];
  if (streamingThinking) {
    allSegments.push({ kind: "thinking", content: streamingThinking });
  }
  if (streamingText) {
    allSegments.push({ kind: "text", content: streamingText });
  }

  const grouped = groupSegments(allSegments);
  const hasAnyContent = allSegments.length > 0;

  // Find the last text group index for cursor placement
  let lastTextIdx = -1;
  for (let i = grouped.length - 1; i >= 0; i--) {
    if (grouped[i].type === "text") { lastTextIdx = i; break; }
  }

  return (
    <div className="chat-msg-enter" style={{
      display: "flex",
      gap: 12,
      padding: "12px 16px",
    }}>
      <div style={{
        width: 24,
        height: 24,
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        fontWeight: 600,
        flexShrink: 0,
        marginTop: 2,
        background: "rgba(37, 99, 235, 0.15)",
        color: "var(--primary, #2563eb)",
      }}>
        P
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground, #1e293b)" }}>Paperclip</span>
          <span style={{ fontSize: 10, color: "var(--muted-foreground, #94a3b8)", opacity: 0.6 }}>now</span>
        </div>
        <div style={{ fontSize: 14, color: "var(--foreground, #1e293b)", opacity: 0.9, lineHeight: 1.6 }}>
          {!hasAnyContent && isActive && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted-foreground, #94a3b8)" }}>
              <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>&#x27F3;</span>
              <span style={{ fontSize: 12 }}>Thinking&#x2026;</span>
            </div>
          )}

          {grouped.map((group, gi) => {
            if (group.type === "text") {
              const isLastText = gi === lastTextIdx && isActive;
              return (
                <div key={gi} className={`chat-markdown ${isLastText ? "chat-cursor" : ""}`}>
                  <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{group.content}</Markdown>
                </div>
              );
            }
            if (group.type === "activity") {
              return <ActivityGroup key={gi} segments={group.segments} isLive={isActive} />;
            }
            if (group.type === "error") {
              return (
                <div key={gi} style={{ margin: "4px 0", fontSize: 14, color: "#ef4444" }}>
                  {group.content}
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

interface SlashCommand {
  name: string;
  description: string;
  prompt: string;
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "tasks", description: "List all active tasks", prompt: "Show me all active tasks (todo, in_progress, blocked) in my workspace. Include status, priority, and assignee for each." },
  { name: "dashboard", description: "Show workspace dashboard", prompt: "Show me the company dashboard — health summary, agent status, task counts, and spend." },
  { name: "agents", description: "List all agents and their status", prompt: "List all agents in my workspace with their current status, role, and budget usage." },
  { name: "create", description: "Create a new task", prompt: "Help me create a new task. Ask me for the title, description, priority, and assignee." },
  { name: "projects", description: "List all projects", prompt: "Show me all projects in my workspace with their status and any associated workspaces." },
  { name: "costs", description: "Show cost breakdown", prompt: "Show me the cost summary for my workspace — total spend, breakdown by agent, and by project." },
  { name: "activity", description: "Show recent activity", prompt: "Show me the recent activity log for my workspace." },
  { name: "blocked", description: "Show blocked tasks", prompt: "Show me all blocked tasks and what's blocking them. Include comments explaining the blockers." },
  { name: "plan", description: "Plan and break down work", prompt: "Help me plan work. I'll describe what I need done and you'll help break it into tasks, assign them, and set priorities." },
  { name: "handoff", description: "Hand off work to an agent", prompt: "I want to hand off work to an agent. Which agent should I assign this to, and what's the task? List available agents so I can pick one." },
];

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
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmDeleteId) return;
    const timer = setTimeout(() => setConfirmDeleteId(null), 3000);
    return () => clearTimeout(timer);
  }, [confirmDeleteId]);

  // Bridge hooks
  const { data: threads, refresh: refreshThreads } = usePluginData<ChatThread[]>("threads", {
    companyId,
  });
  const { data: messages, refresh: refreshMessages } = usePluginData<ChatMessage[]>("messages", {
    threadId: selectedThreadId,
  });
  const { data: adapters } = usePluginData<ChatAdapterInfo[]>("adapters", { companyId });
  const createThread = usePluginAction("createThread");
  const deleteThread = usePluginAction("deleteThread");
  const sendMessage = usePluginAction("sendMessage");
  const stopThread = usePluginAction("stopThread");
  const updateThreadTitle = usePluginAction("updateThreadTitle");

  // SSE stream — subscribe to real-time events for the selected thread
  const streamChannel = selectedThreadId ? `chat:${selectedThreadId}` : "";
  const { events: streamEvents, connected: streamConnected } = usePluginStream<ChatStreamEvent>(
    streamChannel,
    { companyId: companyId ?? undefined },
  );

  // Derived state
  const availableAdapters = adapters?.filter((a) => a.available) ?? [];
  const currentAdapter = availableAdapters.find((a) => a.type === selectedAdapter) ?? availableAdapters[0];
  const currentModels = currentAdapter?.models ?? [];
  const selectedThread = threads?.find((t) => t.id === selectedThreadId) ?? null;
  const isStreaming = selectedThread?.status === "running" || sending;

  // Slash command detection
  const slashMatch = input.match(/^\/(\w*)$/);
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : null;
  const filteredCommands = slashQuery !== null
    ? BUILTIN_COMMANDS.filter((c) => c.name.startsWith(slashQuery))
    : [];
  const showSlashMenu = slashQuery !== null && filteredCommands.length > 0 && !isStreaming;

  // Process stream events into live text
  const lastProcessedCount = useRef(0);
  useEffect(() => {
    if (streamEvents.length <= lastProcessedCount.current) return;

    const newEvents = streamEvents.slice(lastProcessedCount.current);
    lastProcessedCount.current = streamEvents.length;

    for (const evt of newEvents) {
      if (evt.type === "text" && evt.text) {
        setStreamingText((prev) => prev + evt.text);
      }
      if (evt.type === "thinking" && evt.text) {
        setStreamingThinking((prev) => prev + evt.text);
      }
      if (evt.type === "title_updated") {
        refreshThreads();
      }
      if (evt.type === "done") {
        // Stream complete — refresh persisted messages and reset streaming state
        refreshMessages();
        refreshThreads();
        setStreamingText("");
        setStreamingThinking("");
        lastProcessedCount.current = 0;
      }
    }
  }, [streamEvents, refreshMessages, refreshThreads]);

  // Auto-scroll on new messages or streaming text
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

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

  // Reset streaming state when switching threads
  useEffect(() => {
    setStreamingText("");
    setStreamingThinking("");
    lastProcessedCount.current = 0;
  }, [selectedThreadId]);

  // Reset slash menu index when query changes
  useEffect(() => {
    setSlashMenuIndex(0);
  }, [slashQuery]);

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
    setStreamingText("");
    setStreamingThinking("");
    lastProcessedCount.current = 0;

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
    setStreamingText("");
    setStreamingThinking("");
  }, [selectedThreadId, companyId, stopThread, refreshThreads]);

  const selectCommand = useCallback(async (cmd: SlashCommand) => {
    setInput("");
    // Directly send the command's prompt
    let threadId = selectedThreadId;
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
    setStreamingText("");
    setStreamingThinking("");
    lastProcessedCount.current = 0;
    try {
      await sendMessage({ threadId, message: cmd.prompt, companyId });
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setSending(false);
      refreshMessages();
      refreshThreads();
    }
  }, [selectedThreadId, companyId, selectedAdapter, selectedModel, createThread, sendMessage, refreshMessages, refreshThreads]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashMenuIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashMenuIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectCommand(filteredCommands[slashMenuIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setInput("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend, showSlashMenu, filteredCommands, slashMenuIndex, selectCommand]);

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", height: "100%", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style dangerouslySetInnerHTML={{ __html: CHAT_STYLES }} />
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
        <div className="chat-scroll" style={{ flex: 1, overflow: "auto" }}>
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
                {editingThreadId === thread.id ? (
                  <input
                    autoFocus
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={async () => {
                      const trimmed = editingTitle.trim();
                      if (trimmed && trimmed !== thread.title) {
                        await updateThreadTitle({ threadId: thread.id, title: trimmed });
                        refreshThreads();
                      }
                      setEditingThreadId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditingThreadId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      width: "100%",
                      background: "transparent",
                      border: "1px solid var(--border, #e2e8f0)",
                      borderRadius: 4,
                      padding: "1px 4px",
                      color: "var(--foreground, #1e293b)",
                      outline: "none",
                    }}
                  />
                ) : (
                  <div
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingThreadId(thread.id);
                      setEditingTitle(thread.title || "New Chat");
                    }}
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--foreground, #1e293b)",
                    }}
                  >
                    {thread.title || "New Chat"}
                  </div>
                )}
                <div style={{ fontSize: 10, color: "var(--muted-foreground, #94a3b8)", marginTop: 2 }}>
                  {thread.adapterType.replace("_local", "")} {thread.status === "running" ? "..." : ""}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirmDeleteId === thread.id) {
                    handleDeleteThread(thread.id);
                    setConfirmDeleteId(null);
                  } else {
                    setConfirmDeleteId(thread.id);
                  }
                }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: confirmDeleteId === thread.id ? "#ef4444" : "var(--muted-foreground, #94a3b8)",
                  fontSize: confirmDeleteId === thread.id ? 11 : 14,
                  padding: "2px 4px",
                  fontWeight: confirmDeleteId === thread.id ? 600 : 400,
                  transition: "color 150ms",
                  whiteSpace: "nowrap",
                }}
                title={confirmDeleteId === thread.id ? "Click again to confirm" : "Delete thread"}
              >
                {confirmDeleteId === thread.id ? "Delete?" : "×"}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main chat area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Messages */}
        <div className="chat-scroll" style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
          {!selectedThreadId && (
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 16,
              padding: "0 24px",
            }}>
              <div style={{
                fontSize: 28,
                marginBottom: 4,
              }}>
                💬
              </div>
              <h2 style={{
                fontSize: 18,
                fontWeight: 600,
                color: "var(--foreground, #1e293b)",
                margin: 0,
              }}>
                Paperclip Chat
              </h2>
              <p style={{
                fontSize: 13,
                color: "var(--muted-foreground, #94a3b8)",
                margin: 0,
              }}>
                What would you like to do?
              </p>
              <div style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: 8,
                maxWidth: 480,
              }}>
                {[
                  { label: "Check in on issues", prompt: "Check in on all active issues — show me status, what's blocked, and what needs attention." },
                  { label: "Review goal progress", prompt: "Review progress on all active goals. Summarize where each stands and flag anything off track." },
                  { label: "Plan an initiative", prompt: "I want to plan a new initiative. Help me break it down into tasks and assign them to the right agents." },
                  { label: "Agent status", prompt: "Show me the status of all agents — who's active, idle, what they're working on, and any budget concerns." },
                ].map((trigger) => (
                  <button
                    key={trigger.label}
                    onClick={async () => {
                      // Auto-create thread and send
                      const thread = await createThread({
                        companyId,
                        adapterType: selectedAdapter,
                        model: selectedModel,
                      }) as ChatThread;
                      setSelectedThreadId(thread.id);
                      setSending(true);
                      setStreamingText("");
                      setStreamingThinking("");
                      lastProcessedCount.current = 0;
                      try {
                        await sendMessage({ threadId: thread.id, message: trigger.prompt, companyId });
                      } catch (err) {
                        console.error("Send failed:", err);
                      } finally {
                        setSending(false);
                        refreshMessages();
                        refreshThreads();
                      }
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      borderRadius: 8,
                      border: "1px solid var(--border, #e2e8f0)",
                      padding: "8px 14px",
                      fontSize: 12,
                      color: "var(--muted-foreground, #94a3b8)",
                      background: "transparent",
                      cursor: "pointer",
                      transition: "all 150ms",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--foreground, #1e293b)";
                      e.currentTarget.style.borderColor = "var(--foreground, rgba(30,41,59,0.2))";
                      e.currentTarget.style.background = "var(--accent, #f1f5f9)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--muted-foreground, #94a3b8)";
                      e.currentTarget.style.borderColor = "var(--border, #e2e8f0)";
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    {trigger.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages?.map((msg) => (
            <MessageRow key={msg.id} msg={msg} />
          ))}

          {/* Live streaming message */}
          {isStreaming && (
            <StreamingMessage
              segments={[]}
              streamingText={streamingText}
              streamingThinking={streamingThinking}
              isActive={true}
            />
          )}

          {/* Idle, no content placeholder */}
          {selectedThreadId && !isStreaming && (!messages || messages.length === 0) && (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--muted-foreground, #94a3b8)",
              fontSize: 14,
            }}>
              Send a message to get started
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div style={{
          borderTop: "1px solid var(--border, #e2e8f0)",
          padding: "12px 24px",
          background: "var(--card, #fff)",
        }}>
          <div style={{ display: "flex", gap: 8, position: "relative" }}>
            {showSlashMenu && (
              <div style={{
                position: "absolute",
                bottom: "100%",
                left: 0,
                right: 0,
                marginBottom: 4,
                background: "var(--card, #fff)",
                border: "1px solid var(--border, #e2e8f0)",
                borderRadius: 8,
                boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                overflow: "hidden",
                zIndex: 50,
              }}>
                <div style={{
                  padding: "6px 12px",
                  borderBottom: "1px solid var(--border, #e2e8f0)",
                }}>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--muted-foreground, #94a3b8)",
                    opacity: 0.6,
                  }}>
                    Commands
                  </span>
                </div>
                <div className="chat-scroll" style={{ maxHeight: 240, overflowY: "auto", padding: "4px 0" }}>
                  {filteredCommands.map((cmd, i) => (
                    <button
                      key={cmd.name}
                      onClick={() => selectCommand(cmd)}
                      onMouseEnter={() => setSlashMenuIndex(i)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 12px",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        border: "none",
                        background: i === slashMenuIndex ? "var(--accent, #f1f5f9)" : "transparent",
                        color: "var(--foreground, #1e293b)",
                        cursor: "pointer",
                        fontSize: 13,
                        transition: "background 100ms",
                      }}
                    >
                      <span style={{
                        fontWeight: 600,
                        color: "var(--primary, #2563eb)",
                        fontFamily: "monospace",
                        fontSize: 12,
                      }}>
                        /{cmd.name}
                      </span>
                      <span style={{
                        color: "var(--muted-foreground, #94a3b8)",
                        fontSize: 12,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}>
                        {cmd.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
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
