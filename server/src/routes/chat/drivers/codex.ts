import type { ChatDriver, ChatEvent, ChatSpawnOpts } from "./types.js";

export const codexDriver: ChatDriver = {
  type: "codex_local",
  command: "codex",
  label: "Codex",

  buildArgs(opts: ChatSpawnOpts): string[] {
    const args = ["exec", "--json"];
    if (opts.model) {
      args.push("--model", opts.model);
    }
    if (opts.sessionId) {
      args.push("resume", opts.sessionId, "-");
    } else {
      args.push("-");
    }
    return args;
  },

  parseEvent(line: string): ChatEvent[] {
    const events: ChatEvent[] = [];
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      return events;
    }

    if (event.type === "thread.started" && event.thread_id) {
      events.push({ type: "session_init", sessionId: event.thread_id });
    }

    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      const text = event.item.text ?? event.item.content?.[0]?.text;
      if (text) {
        events.push({ type: "text", text });
      }
    }

    if (event.type === "item.completed" && event.item?.type === "function_call") {
      events.push({
        type: "tool_use",
        name: event.item.name ?? "tool",
        input: event.item.arguments ?? event.item.input,
      });
    }

    if (event.type === "item.completed" && event.item?.type === "function_call_output") {
      events.push({
        type: "tool_result",
        content: event.item.output ?? "",
        isError: false,
      });
    }

    if (event.type === "turn.completed" && event.usage) {
      events.push({
        type: "result",
        usage: {
          input_tokens: event.usage.input_tokens ?? 0,
          output_tokens: event.usage.output_tokens ?? 0,
        },
      });
    }

    if (event.type === "error") {
      events.push({ type: "error", text: event.message ?? "Unknown codex error" });
    }

    return events;
  },

  isUnknownSessionError(stdout: string, stderr: string): boolean {
    const combined = `${stdout}\n${stderr}`.toLowerCase();
    return /unknown session|session .* not found|missing rollout path for thread/.test(combined);
  },
};
