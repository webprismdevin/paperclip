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
// SVG Icons — match core chat UI icons
// ---------------------------------------------------------------------------

function IconChat({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function IconSend({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function IconSidebar({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  );
}

function IconPlus({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconUser({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconStop({ size = 16, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function IconChevron({ size = 10, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

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
    content: "\\25CA";
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
    border-color: var(--primary, #2563eb) !important;
    box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.15);
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
    background: var(--code-bg, rgba(0, 0, 0, 0.08));
  }
  .chat-markdown pre {
    margin: 0.6em 0;
    padding: 0.75em 1em;
    border-radius: 6px;
    overflow-x: auto;
    background: var(--code-block-bg, rgba(0, 0, 0, 0.06)) !important;
    border: 1px solid var(--border, rgba(0, 0, 0, 0.1));
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
    border-left: 2px solid var(--border, rgba(0, 0, 0, 0.15));
    padding-left: 0.75em;
    margin: 0.5em 0;
    color: var(--muted-foreground, rgba(100, 116, 139, 0.8));
  }
  .chat-markdown table {
    border-collapse: collapse;
    margin: 0.5em 0;
    font-size: 0.9em;
  }
  .chat-markdown th, .chat-markdown td {
    border: 1px solid var(--border, rgba(0, 0, 0, 0.1));
    padding: 0.35em 0.6em;
    text-align: left;
  }
  .chat-markdown th {
    background: var(--accent, rgba(0, 0, 0, 0.06));
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
  .chat-sidebar-thread:hover {
    background: var(--accent, rgba(0, 0, 0, 0.04));
  }
  .chat-sidebar-thread.active {
    background: var(--accent, rgba(0, 0, 0, 0.06));
  }
  .chat-action-chip:hover {
    color: var(--foreground, #1e293b) !important;
    border-color: var(--foreground, rgba(30,41,59,0.2)) !important;
    background: var(--accent, #f1f5f9) !important;
  }
  .chat-recent-thread:hover {
    background: var(--accent, #f1f5f9) !important;
    border-color: var(--foreground, rgba(30,41,59,0.1)) !important;
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
// formatTime — absolute time display matching core UI (e.g. "08:22 PM")
// ---------------------------------------------------------------------------

function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
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
      padding: "16px 0",
    }}>
      <div style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        marginTop: 1,
        background: isUser ? "var(--muted-foreground, #94a3b8)" : "rgba(37, 99, 235, 0.12)",
        color: isUser ? "#fff" : "var(--primary, #2563eb)",
      }}>
        {isUser ? <IconUser size={15} /> : <span style={{ fontSize: 13, fontWeight: 700 }}>P</span>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground, #1e293b)" }}>
            {isUser ? "You" : "Paperclip"}
          </span>
          <span style={{ fontSize: 11, color: "var(--muted-foreground, #94a3b8)", opacity: 0.6 }}>
            {formatTime(msg.createdAt)}
          </span>
        </div>
        <div style={{ fontSize: 14, color: "var(--foreground, #1e293b)", lineHeight: 1.6 }}>
          {isUser ? (
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}><IssueLinkedText text={msg.content} /></p>
          ) : hasSegments ? (
            groupSegments(storedSegments).map((group, i) => {
              if (group.type === "text") {
                return (
                  <div key={i} className="chat-markdown">
                    <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{linkifyIssues(group.content)}</Markdown>
                  </div>
                );
              }
              if (group.type === "activity") {
                return <ActivityGroup key={i} segments={group.segments} isLive={false} />;
              }
              if (group.type === "error") {
                return (
                  <div key={i} className="chat-msg-enter" style={{
                    margin: "6px 0",
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: "rgba(239, 68, 68, 0.08)",
                    border: "1px solid rgba(239, 68, 68, 0.15)",
                    fontSize: 13,
                    color: "#ef4444",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                  }}>
                    <span style={{ flexShrink: 0, marginTop: 1, fontSize: 12 }}>!</span>
                    <span style={{ whiteSpace: "pre-wrap" }}>{group.content}</span>
                  </div>
                );
              }
              return null;
            })
          ) : (
            <div className="chat-markdown">
              <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{linkifyIssues(msg.content)}</Markdown>
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
  streamingError,
  isActive,
}: {
  segments: ChatSegment[];
  streamingText: string;
  streamingThinking: string;
  streamingError: string;
  isActive: boolean;
}) {
  const allSegments: ChatSegment[] = [...segments];
  if (streamingThinking) {
    allSegments.push({ kind: "thinking", content: streamingThinking });
  }
  if (streamingText) {
    allSegments.push({ kind: "text", content: streamingText });
  }

  const grouped = groupSegments(allSegments);
  const hasAnyContent = allSegments.length > 0;

  let lastTextIdx = -1;
  for (let i = grouped.length - 1; i >= 0; i--) {
    if (grouped[i].type === "text") { lastTextIdx = i; break; }
  }

  return (
    <div className="chat-msg-enter" style={{
      display: "flex",
      gap: 12,
      padding: "16px 0",
    }}>
      <div style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        marginTop: 1,
        background: "rgba(37, 99, 235, 0.12)",
        color: "var(--primary, #2563eb)",
      }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>P</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground, #1e293b)" }}>Paperclip</span>
          <span style={{ fontSize: 11, color: "var(--muted-foreground, #94a3b8)", opacity: 0.6 }}>now</span>
        </div>
        <div style={{ fontSize: 14, color: "var(--foreground, #1e293b)", lineHeight: 1.6 }}>
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
                  <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{linkifyIssues(group.content)}</Markdown>
                </div>
              );
            }
            if (group.type === "activity") {
              return <ActivityGroup key={gi} segments={group.segments} isLive={isActive} />;
            }
            if (group.type === "error") {
              return (
                <div key={gi} className="chat-msg-enter" style={{
                  margin: "6px 0",
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "rgba(239, 68, 68, 0.08)",
                  border: "1px solid rgba(239, 68, 68, 0.15)",
                  fontSize: 13,
                  color: "#ef4444",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                }}>
                  <span style={{ flexShrink: 0, marginTop: 1, fontSize: 12 }}>!</span>
                  <span style={{ whiteSpace: "pre-wrap" }}>{group.content}</span>
                </div>
              );
            }
            return null;
          })}
          {streamingError && (
            <div className="chat-msg-enter" style={{
              margin: "6px 0",
              padding: "8px 12px",
              borderRadius: 6,
              background: "rgba(239, 68, 68, 0.08)",
              border: "1px solid rgba(239, 68, 68, 0.15)",
              fontSize: 13,
              color: "#ef4444",
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
            }}>
              <span style={{ flexShrink: 0, marginTop: 1, fontSize: 12 }}>!</span>
              <span style={{ whiteSpace: "pre-wrap" }}>{streamingError}</span>
            </div>
          )}
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
// Issue reference helpers — auto-detect #PROJ-123 patterns
// ---------------------------------------------------------------------------

function IssueLinkedText({ text }: { text: string }) {
  const parts = text.split(/(#[A-Z][A-Z0-9]*-\d+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^#[A-Z][A-Z0-9]*-\d+$/.test(part) ? (
          <span key={i} style={{
            color: "var(--primary, #2563eb)",
            fontWeight: 500,
          }}>
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function linkifyIssues(text: string): string {
  return text.replace(/(#[A-Z][A-Z0-9]*-\d+)/g, "**$1**");
}

// ---------------------------------------------------------------------------
// Quick action chips for welcome screen
// ---------------------------------------------------------------------------

const QUICK_ACTIONS = [
  { label: "Check in on issues", prompt: "Check in on all active issues — show me status, what's blocked, and what needs attention." },
  { label: "Review goal progress", prompt: "Review progress on all active goals. Summarize where each stands and flag anything off track." },
  { label: "Plan an initiative", prompt: "I want to plan a new initiative. Help me break it down into tasks and assign them to the right agents." },
  { label: "Agent status", prompt: "Show me the status of all agents — who's active, idle, what they're working on, and any budget concerns." },
];

// ---------------------------------------------------------------------------
// ChatInput — unified input container matching core UI
// ---------------------------------------------------------------------------

function ChatInput({
  input,
  setInput,
  onSend,
  onStop,
  onKeyDown,
  isStreaming,
  sending,
  placeholder,
  textareaRef,
  adjustTextareaHeight,
  showSlashMenu,
  filteredCommands,
  slashMenuIndex,
  setSlashMenuIndex,
  selectCommand,
  availableAdapters,
  selectedAdapter,
  setSelectedAdapter,
  selectedThread,
  currentModels,
  selectedModel,
  setSelectedModel,
}: {
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  isStreaming: boolean;
  sending: boolean;
  placeholder: string;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  adjustTextareaHeight: () => void;
  showSlashMenu: boolean;
  filteredCommands: SlashCommand[];
  slashMenuIndex: number;
  setSlashMenuIndex: (i: number) => void;
  selectCommand: (cmd: SlashCommand) => void;
  availableAdapters: ChatAdapterInfo[];
  selectedAdapter: string;
  setSelectedAdapter: (v: string) => void;
  selectedThread: ChatThread | null;
  currentModels: { id: string; label: string }[];
  selectedModel: string;
  setSelectedModel: (v: string) => void;
}) {
  return (
    <div style={{ position: "relative" }}>
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
                ref={i === slashMenuIndex ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
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

      {/* Unified input container */}
      <div
        className="chat-input-glow"
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 0,
          border: "1px solid var(--border, #e2e8f0)",
          borderRadius: 12,
          background: "var(--background, #fff)",
          padding: "4px 4px 4px 12px",
          transition: "border-color 150ms, box-shadow 150ms",
        }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            adjustTextareaHeight();
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={1}
          style={{
            flex: 1,
            resize: "none",
            padding: "6px 8px",
            border: "none",
            fontSize: 14,
            fontFamily: "inherit",
            background: "transparent",
            color: "var(--foreground, #1e293b)",
            outline: "none",
            minHeight: 32,
            height: 32,
            lineHeight: "20px",
          }}
        />
        {isStreaming ? (
          <button
            onClick={onStop}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "none",
              background: "var(--destructive, #ef4444)",
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
            title="Stop"
          >
            <IconStop size={14} />
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!input.trim() || sending}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "none",
              background: input.trim() && !sending ? "var(--primary, #2563eb)" : "var(--muted-foreground, #94a3b8)",
              color: "#fff",
              cursor: input.trim() && !sending ? "pointer" : "not-allowed",
              opacity: input.trim() && !sending ? 1 : 0.3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "opacity 150ms, background 150ms",
            }}
            title="Send"
          >
            <IconSend size={14} />
          </button>
        )}
      </div>

      {/* Adapter / model selector row */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        marginTop: 6,
        fontSize: 11,
        color: "var(--muted-foreground, #94a3b8)",
        padding: "0 4px",
      }}>
        {availableAdapters.length > 0 && (
          <span style={{ cursor: selectedThread ? "default" : "pointer", opacity: selectedThread ? 0.5 : 0.7 }}>
            {availableAdapters.length > 1 && !selectedThread ? (
              <select
                value={selectedAdapter}
                onChange={(e) => setSelectedAdapter(e.target.value)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  fontSize: "inherit",
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: "inherit",
                }}
              >
                {availableAdapters.map((a) => (
                  <option key={a.type} value={a.type}>{a.label}</option>
                ))}
              </select>
            ) : (
              <span>{availableAdapters.find((a) => a.type === selectedAdapter)?.label ?? "Claude"}</span>
            )}
          </span>
        )}
        {currentModels.length > 0 && (
          <>
            <span style={{ opacity: 0.4 }}>/</span>
            <span style={{ opacity: 0.7 }}>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "inherit",
                  fontSize: "inherit",
                  cursor: "pointer",
                  padding: 0,
                  fontFamily: "inherit",
                }}
              >
                {currentModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </span>
          </>
        )}
        <span style={{ marginLeft: "auto", opacity: 0.4 }}>Shift+Enter for new line</span>
      </div>
    </div>
  );
}

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
  const [streamingError, setStreamingError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const adjustTextareaHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 144) + "px";
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

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

  // SSE stream
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

  // Process stream events
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
      if (evt.type === "error" && evt.text) {
        const errText = evt.text;
        setStreamingError((prev) => prev ? prev + "\n" + errText : errText);
      }
      if (evt.type === "title_updated") {
        refreshThreads();
      }
      if (evt.type === "done") {
        refreshMessages();
        refreshThreads();
        setStreamingText("");
        setStreamingThinking("");
        setStreamingError("");
        lastProcessedCount.current = 0;
      }
    }
  }, [streamEvents, refreshMessages, refreshThreads]);

  // Auto-scroll
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

  // Default model
  useEffect(() => {
    if (currentModels.length > 0 && !currentModels.find((m) => m.id === selectedModel)) {
      setSelectedModel(currentModels[0]!.id);
    }
  }, [currentModels, selectedModel]);

  // Reset streaming on thread switch
  useEffect(() => {
    setStreamingText("");
    setStreamingThinking("");
    setStreamingError("");
    lastProcessedCount.current = 0;
  }, [selectedThreadId]);

  // Reset slash menu
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
    setStreamingError("");
    lastProcessedCount.current = 0;

    // Refresh early so the user message appears while the agent is working
    setTimeout(() => { refreshMessages(); refreshThreads(); }, 300);

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
    setStreamingError("");
  }, [selectedThreadId, companyId, stopThread, refreshThreads]);

  const selectCommand = useCallback(async (cmd: SlashCommand) => {
    setInput("");
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
    setStreamingError("");
    lastProcessedCount.current = 0;
    setTimeout(() => { refreshMessages(); refreshThreads(); }, 300);
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

  const handleQuickAction = useCallback(async (prompt: string) => {
    const thread = await createThread({
      companyId,
      adapterType: selectedAdapter,
      model: selectedModel,
    }) as ChatThread;
    setSelectedThreadId(thread.id);
    setSending(true);
    setStreamingText("");
    setStreamingThinking("");
    setStreamingError("");
    lastProcessedCount.current = 0;
    setTimeout(() => { refreshMessages(); refreshThreads(); }, 300);
    try {
      await sendMessage({ threadId: thread.id, message: prompt, companyId });
    } catch (err) {
      console.error("Send failed:", err);
    } finally {
      setSending(false);
      refreshMessages();
      refreshThreads();
    }
  }, [companyId, selectedAdapter, selectedModel, createThread, sendMessage, refreshMessages, refreshThreads]);

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

  const inputProps = {
    input,
    setInput,
    onSend: handleSend,
    onStop: handleStop,
    onKeyDown: handleKeyDown,
    isStreaming,
    sending,
    textareaRef: textareaRef as React.RefObject<HTMLTextAreaElement>,
    adjustTextareaHeight,
    showSlashMenu,
    filteredCommands,
    slashMenuIndex,
    setSlashMenuIndex,
    selectCommand,
    availableAdapters,
    selectedAdapter,
    setSelectedAdapter,
    selectedThread,
    currentModels,
    selectedModel,
    setSelectedModel,
  };

  return (
    <div style={{ display: "flex", height: "calc(100vh - 8rem)", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style dangerouslySetInnerHTML={{ __html: CHAT_STYLES }} />

      {/* ── Sidebar ── */}
      <div style={{
        width: sidebarCollapsed ? 0 : 220,
        borderRight: sidebarCollapsed ? "none" : "1px solid var(--border, #e2e8f0)",
        display: "flex",
        flexDirection: "column",
        background: "var(--card, #fff)",
        transition: "width 200ms ease",
        overflow: "hidden",
        flexShrink: 0,
      }}>
        {/* New Chat button */}
        <div style={{ padding: "12px" }}>
          <button
            onClick={() => { setSelectedThreadId(null); setInput(""); }}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--border, #e2e8f0)",
              background: "transparent",
              color: "var(--foreground, #1e293b)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <IconPlus size={14} />
            New Chat
          </button>
        </div>

        {/* Thread list */}
        <div className="chat-scroll" style={{ flex: 1, overflow: "auto" }}>
          {threads?.map((thread) => (
            <div
              key={thread.id}
              className={`chat-sidebar-thread ${thread.id === selectedThreadId ? "active" : ""}`}
              onClick={() => setSelectedThreadId(thread.id)}
              style={{
                padding: "10px 12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                background: thread.id === selectedThreadId ? "var(--accent, rgba(0,0,0,0.06))" : "transparent",
                transition: "background 100ms",
              }}
            >
              <span style={{ flexShrink: 0, marginTop: 2, color: "var(--muted-foreground, #94a3b8)", opacity: 0.5 }}>
                <IconChat size={14} />
              </span>
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
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "var(--foreground, #1e293b)",
                    }}
                  >
                    {thread.title || "New Chat"}
                  </div>
                )}
                <div style={{
                  fontSize: 10,
                  color: "var(--muted-foreground, #94a3b8)",
                  marginTop: 2,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}>
                  <span>{formatTime(thread.updatedAt)}</span>
                  {thread.status === "running" && (
                    <span
                      className="chat-tool-pulse"
                      style={{
                        display: "inline-block",
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#22c55e",
                      }}
                    />
                  )}
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
                  fontSize: confirmDeleteId === thread.id ? 10 : 14,
                  padding: "2px 4px",
                  fontWeight: confirmDeleteId === thread.id ? 600 : 400,
                  transition: "color 150ms",
                  whiteSpace: "nowrap",
                  opacity: 0.5,
                  marginTop: 1,
                }}
                title={confirmDeleteId === thread.id ? "Click again to confirm" : "Delete thread"}
              >
                {confirmDeleteId === thread.id ? "Delete?" : "\u00d7"}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

        {/* ── Messages area ── */}
        <div className="chat-scroll" style={{ flex: 1, overflow: "auto", padding: "0 32px", position: "relative" }}>
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{
              position: "sticky",
              top: 8,
              left: 0,
              zIndex: 10,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--muted-foreground, #94a3b8)",
              padding: 4,
              display: "flex",
              alignItems: "center",
              opacity: 0.4,
              marginBottom: -28,
            }}
            title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          >
            <IconSidebar size={16} />
          </button>
          {/* Welcome screen */}
          {!selectedThreadId && (
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 20,
              padding: "0 24px",
            }}>
              <div style={{ color: "var(--muted-foreground, #94a3b8)", opacity: 0.3 }}>
                <IconChat size={32} />
              </div>
              <h2 style={{
                fontSize: 18,
                fontWeight: 600,
                color: "var(--foreground, #1e293b)",
                margin: 0,
              }}>
                What can I help with?
              </h2>

              {/* Input on welcome screen */}
              <div style={{ width: "100%", maxWidth: 520 }}>
                <ChatInput
                  {...inputProps}
                  placeholder="Ask Paperclip anything..."
                />
              </div>

              {/* Quick action chips */}
              <div style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: 8,
                maxWidth: 520,
              }}>
                {QUICK_ACTIONS.map((trigger) => (
                  <button
                    key={trigger.label}
                    className="chat-action-chip"
                    onClick={() => handleQuickAction(trigger.prompt)}
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
                  >
                    {trigger.label}
                  </button>
                ))}
              </div>

              {/* Recent threads */}
              {threads && threads.length > 0 && (
                <div style={{ width: "100%", maxWidth: 520, marginTop: 8 }}>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 8,
                    padding: "0 4px",
                  }}>
                    <span style={{
                      fontSize: 11,
                      color: "var(--muted-foreground, #94a3b8)",
                      opacity: 0.5,
                      fontWeight: 500,
                    }}>
                      Recent
                    </span>
                    {threads.length > 3 && (
                      <button
                        onClick={() => setSidebarCollapsed(false)}
                        style={{
                          fontSize: 11,
                          color: "var(--muted-foreground, #94a3b8)",
                          opacity: 0.5,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        View all
                      </button>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {threads.slice(0, 3).map((thread) => (
                      <button
                        key={thread.id}
                        className="chat-recent-thread"
                        onClick={() => setSelectedThreadId(thread.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          borderRadius: 8,
                          border: "1px solid var(--border, #e2e8f0)",
                          padding: "10px 12px",
                          textAlign: "left",
                          background: "transparent",
                          cursor: "pointer",
                          transition: "all 150ms",
                          width: "100%",
                        }}
                      >
                        <span style={{
                          flexShrink: 0,
                          color: "var(--muted-foreground, #94a3b8)",
                          opacity: 0.3,
                        }}>
                          <IconChat size={14} />
                        </span>
                        <span style={{
                          fontSize: 13,
                          color: "var(--foreground, #1e293b)",
                          opacity: 0.7,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                        }}>
                          {thread.title || "New Chat"}
                        </span>
                        <span style={{
                          fontSize: 10,
                          color: "var(--muted-foreground, #94a3b8)",
                          opacity: 0.3,
                          flexShrink: 0,
                        }}>
                          {formatTime(thread.updatedAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Thread messages */}
          {selectedThreadId && messages?.map((msg) => (
            <MessageRow key={msg.id} msg={msg} />
          ))}

          {/* Live streaming message */}
          {selectedThreadId && isStreaming && (
            <StreamingMessage
              segments={[]}
              streamingText={streamingText}
              streamingThinking={streamingThinking}
              streamingError={streamingError}
              isActive={true}
            />
          )}

          {/* Empty thread placeholder */}
          {selectedThreadId && !isStreaming && (!messages || messages.length === 0) && (
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--muted-foreground, #94a3b8)",
              fontSize: 14,
              opacity: 0.5,
            }}>
              Send a message to get started
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* ── Bottom input (only when in a thread) ── */}
        {selectedThreadId && (
          <div style={{
            borderTop: "1px solid var(--border, #e2e8f0)",
            padding: "12px 32px",
            background: "var(--card, #fff)",
          }}>
            <ChatInput
              {...inputProps}
              placeholder="Ask Paperclip anything..."
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatSidebarPanel — compact sidebar entry point
// ---------------------------------------------------------------------------

export function ChatSidebarPanel() {
  return null;
}
