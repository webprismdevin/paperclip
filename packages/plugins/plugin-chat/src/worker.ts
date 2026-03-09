import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { AgentSessionEvent, PluginContext } from "@paperclipai/plugin-sdk";
import type {
  ChatThread,
  ChatMessage,
  ChatStreamEvent,
  ChatAdapterInfo,
} from "./types.js";

const PLUGIN_NAME = "paperclip-chat";

// ---------------------------------------------------------------------------
// State key helpers — all chat data lives in plugin.state
// ---------------------------------------------------------------------------

function threadListKey(companyId: string) {
  return `threads:${companyId}`;
}

function threadKey(threadId: string) {
  return `thread:${threadId}`;
}

function messagesKey(threadId: string) {
  return `messages:${threadId}`;
}

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

async function getThread(ctx: PluginContext, threadId: string): Promise<ChatThread | null> {
  const raw = await ctx.state.get({
    scopeKind: "instance",
    scopeId: "global",
    stateKey: threadKey(threadId),
  });
  return (raw as ChatThread) ?? null;
}

async function saveThread(ctx: PluginContext, thread: ChatThread): Promise<void> {
  await ctx.state.set({
    scopeKind: "instance",
    scopeId: "global",
    stateKey: threadKey(thread.id),
    value: thread as unknown as Record<string, unknown>,
  });
}

async function getThreadList(ctx: PluginContext, companyId: string): Promise<string[]> {
  const raw = await ctx.state.get({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: threadListKey(companyId),
  });
  return (raw as string[]) ?? [];
}

async function saveThreadList(ctx: PluginContext, companyId: string, ids: string[]): Promise<void> {
  await ctx.state.set({
    scopeKind: "company",
    scopeId: companyId,
    stateKey: threadListKey(companyId),
    value: ids as unknown as Record<string, unknown>,
  });
}

async function getMessages(ctx: PluginContext, threadId: string): Promise<ChatMessage[]> {
  const raw = await ctx.state.get({
    scopeKind: "instance",
    scopeId: "global",
    stateKey: messagesKey(threadId),
  });
  return (raw as ChatMessage[]) ?? [];
}

async function saveMessages(ctx: PluginContext, threadId: string, msgs: ChatMessage[]): Promise<void> {
  await ctx.state.set({
    scopeKind: "instance",
    scopeId: "global",
    stateKey: messagesKey(threadId),
    value: msgs as unknown as Record<string, unknown>,
  });
}

function generateId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Map AgentSessionEvent → ChatStreamEvent
// ---------------------------------------------------------------------------

function mapSessionEvent(event: AgentSessionEvent): ChatStreamEvent | null {
  switch (event.eventType) {
    case "chunk": {
      const payload = event.payload ?? {};
      // The host delivers parsed adapter output in payload
      const chunkType = (payload.type as string) ?? "text";
      if (chunkType === "thinking") {
        return { type: "thinking", text: event.message ?? "" };
      }
      if (chunkType === "tool_use") {
        return {
          type: "tool_use",
          name: (payload.name as string) ?? "tool",
          input: payload.input,
        };
      }
      if (chunkType === "tool_result") {
        return {
          type: "tool_result",
          content: event.message ?? "",
          isError: (payload.isError as boolean) ?? false,
          toolUseId: payload.toolUseId as string | undefined,
        };
      }
      // Default: text chunk
      return { type: "text", text: event.message ?? "" };
    }
    case "status":
      // Session status change — could carry session ID
      if (event.payload?.sessionId) {
        return { type: "session_init", sessionId: event.payload.sessionId as string };
      }
      return null;
    case "done":
      return {
        type: "result",
        usage: event.payload?.usage as ChatStreamEvent["usage"],
        costUsd: event.payload?.costUsd as number | undefined,
      };
    case "error":
      return { type: "error", text: event.message ?? "Unknown error" };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info(`${PLUGIN_NAME} plugin setup`);

    // ── Data: list threads ──────────────────────────────────────────
    ctx.data.register("threads", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      if (!companyId) return [];
      const ids = await getThreadList(ctx, companyId);
      const threads: ChatThread[] = [];
      for (const id of ids) {
        const thread = await getThread(ctx, id);
        if (thread) threads.push(thread);
      }
      // Sort by updatedAt descending
      threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return threads;
    });

    // ── Data: get messages for a thread ─────────────────────────────
    ctx.data.register("messages", async (params: Record<string, unknown>) => {
      const threadId = params.threadId as string;
      if (!threadId) return [];
      return getMessages(ctx, threadId);
    });

    // ── Data: list available adapters ───────────────────────────────
    ctx.data.register("adapters", async (_params: Record<string, unknown>) => {
      // Query the host's agent registry to discover available adapters
      // TODO: The host needs to expose adapter discovery through agents.list or a dedicated API
      // For now, return a static list that the host will validate at session creation time
      const adapters: ChatAdapterInfo[] = [
        { type: "claude_local", label: "Claude", available: true, models: [] },
        { type: "codex_local", label: "Codex", available: true, models: [] },
        { type: "opencode_local", label: "OpenCode", available: true, models: [] },
      ];
      return adapters;
    });

    // ── Action: create thread ───────────────────────────────────────
    ctx.actions.register("createThread", async (params: Record<string, unknown>) => {
      const companyId = params.companyId as string;
      const adapterType = (params.adapterType as string) ?? "claude_local";
      const model = (params.model as string) ?? "";
      const title = (params.title as string) ?? "New Chat";
      if (!companyId) throw new Error("companyId is required");

      const thread: ChatThread = {
        id: generateId(),
        companyId,
        title,
        sessionId: null,
        adapterType,
        model,
        status: "idle",
        createdBy: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await saveThread(ctx, thread);
      const ids = await getThreadList(ctx, companyId);
      ids.unshift(thread.id);
      await saveThreadList(ctx, companyId, ids);

      return thread;
    });

    // ── Action: delete thread ───────────────────────────────────────
    ctx.actions.register("deleteThread", async (params: Record<string, unknown>) => {
      const threadId = params.threadId as string;
      const companyId = params.companyId as string;
      if (!threadId || !companyId) throw new Error("threadId and companyId required");

      // Remove from thread list
      const ids = await getThreadList(ctx, companyId);
      const filtered = ids.filter((id) => id !== threadId);
      await saveThreadList(ctx, companyId, filtered);

      // Delete thread and messages state
      await ctx.state.delete({
        scopeKind: "instance",
        scopeId: "global",
        stateKey: threadKey(threadId),
      });
      await ctx.state.delete({
        scopeKind: "instance",
        scopeId: "global",
        stateKey: messagesKey(threadId),
      });

      return { ok: true };
    });

    // ── Action: update thread title ─────────────────────────────────
    ctx.actions.register("updateThreadTitle", async (params: Record<string, unknown>) => {
      const threadId = params.threadId as string;
      const title = params.title as string;
      if (!threadId || !title) throw new Error("threadId and title required");

      const thread = await getThread(ctx, threadId);
      if (!thread) throw new Error("Thread not found");

      thread.title = title;
      thread.updatedAt = new Date().toISOString();
      await saveThread(ctx, thread);
      return thread;
    });

    // ── Action: send message (starts streaming) ─────────────────────
    ctx.actions.register("sendMessage", async (params: Record<string, unknown>) => {
      const threadId = params.threadId as string;
      const message = params.message as string;
      const companyId = params.companyId as string;
      if (!threadId || !message || !companyId) {
        throw new Error("threadId, message, and companyId required");
      }

      const thread = await getThread(ctx, threadId);
      if (!thread) throw new Error("Thread not found");

      // Save user message
      const msgs = await getMessages(ctx, threadId);
      const userMsg: ChatMessage = {
        id: generateId(),
        threadId,
        role: "user",
        content: message,
        metadata: null,
        createdAt: new Date().toISOString(),
      };
      msgs.push(userMsg);
      await saveMessages(ctx, threadId, msgs);

      // Mark thread as running
      thread.status = "running";
      thread.updatedAt = new Date().toISOString();

      // Auto-generate title from first user message
      if (thread.title === "New Chat") {
        const shortTitle = message.length > 60
          ? message.slice(0, 57).replace(/\s+\S*$/, "") + "..."
          : message;
        const titleLine = shortTitle.split("\n")[0] ?? shortTitle;
        thread.title = titleLine;
        // TODO: emit title_updated via stream
      }
      await saveThread(ctx, thread);

      // Create or resume agent session
      let sessionId = thread.sessionId;
      if (!sessionId) {
        // TODO: Map adapterType to an agent ID in the host's registry
        // For now, use a convention: the agent ID matches the adapter type
        const agentId = thread.adapterType;
        const session = await ctx.agentSessions.create(agentId, companyId, {
          reason: "Chat plugin: new conversation",
        });
        sessionId = session.sessionId;
        thread.sessionId = sessionId;
        await saveThread(ctx, thread);
      }

      // Collect response segments for persistence
      const segments: ChatMessage["metadata"] = { segments: [] };
      let fullResponse = "";

      // Send message and stream events
      // The onEvent callback receives AgentSessionEvent objects in real-time
      // via JSON-RPC notifications from the host
      const { runId } = await ctx.agentSessions.sendMessage(sessionId, companyId, {
        prompt: message,
        reason: "Chat plugin: user message",
        onEvent: (event: AgentSessionEvent) => {
          const chatEvent = mapSessionEvent(event);
          if (!chatEvent) return;

          // Accumulate for persistence
          if (chatEvent.type === "text" && chatEvent.text) {
            fullResponse += chatEvent.text;
            const last = segments.segments[segments.segments.length - 1];
            if (last && last.kind === "text") {
              last.content += chatEvent.text;
            } else {
              segments.segments.push({ kind: "text", content: chatEvent.text });
            }
          }
          if (chatEvent.type === "thinking" && chatEvent.text) {
            const last = segments.segments[segments.segments.length - 1];
            if (last && last.kind === "thinking") {
              last.content += chatEvent.text;
            } else {
              segments.segments.push({ kind: "thinking", content: chatEvent.text });
            }
          }
          if (chatEvent.type === "tool_use") {
            segments.segments.push({
              kind: "tool",
              name: chatEvent.name ?? "tool",
              input: chatEvent.input,
            });
          }
          if (chatEvent.type === "tool_result") {
            // Match to last unresolved tool segment
            for (let i = segments.segments.length - 1; i >= 0; i--) {
              const seg = segments.segments[i];
              if (seg && seg.kind === "tool" && seg.result === undefined) {
                seg.result = chatEvent.content ?? "";
                seg.isError = chatEvent.isError ?? false;
                break;
              }
            }
          }
          if (chatEvent.type === "session_init" && chatEvent.sessionId) {
            // Update session ID if the host provides a new one
            thread.sessionId = chatEvent.sessionId;
          }

          // TODO: Push event to UI via ctx.streams.emit() (SSE bridge — issue #440)
          // For now, events accumulate and the full response is saved on completion.
          // Once the SSE bridge lands, add:
          //   ctx.streams.emit(`chat:${threadId}`, chatEvent);
        },
      });

      // Stream complete — save assistant message
      if (fullResponse || segments.segments.length > 0) {
        const assistantMsg: ChatMessage = {
          id: generateId(),
          threadId,
          role: "assistant",
          content: fullResponse,
          metadata: segments,
          createdAt: new Date().toISOString(),
        };
        const updatedMsgs = await getMessages(ctx, threadId);
        updatedMsgs.push(assistantMsg);
        await saveMessages(ctx, threadId, updatedMsgs);
      }

      // Mark thread idle
      thread.status = "idle";
      thread.updatedAt = new Date().toISOString();
      await saveThread(ctx, thread);

      ctx.logger.info(`Chat message completed`, { threadId, runId });

      return { ok: true, runId };
    });

    // ── Action: stop a running response ─────────────────────────────
    ctx.actions.register("stopThread", async (params: Record<string, unknown>) => {
      const threadId = params.threadId as string;
      const companyId = params.companyId as string;
      if (!threadId || !companyId) throw new Error("threadId and companyId required");

      const thread = await getThread(ctx, threadId);
      if (!thread || !thread.sessionId) return { ok: true, stopped: false };

      await ctx.agentSessions.close(thread.sessionId, companyId);
      thread.status = "idle";
      thread.sessionId = null; // Force new session on next message
      thread.updatedAt = new Date().toISOString();
      await saveThread(ctx, thread);

      return { ok: true, stopped: true };
    });
  },

  async onHealth() {
    return { status: "ok", message: `${PLUGIN_NAME} ready` };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
