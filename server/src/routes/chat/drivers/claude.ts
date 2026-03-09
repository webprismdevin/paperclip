import type { ChatDriver, ChatEvent, ChatSpawnOpts } from "./types.js";

export const claudeDriver: ChatDriver = {
  type: "claude_local",
  command: "claude",
  label: "Claude",

  buildArgs(opts: ChatSpawnOpts): string[] {
    const args = [
      "--print", "-",
      "--output-format", "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--append-system-prompt", opts.systemPrompt,
    ];
    if (opts.model) {
      args.push("--model", opts.model);
    }
    if (opts.sessionId) {
      args.push("--resume", opts.sessionId);
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

    if (event.type === "system" && event.subtype === "init" && event.session_id) {
      events.push({ type: "session_init", sessionId: event.session_id });
    }

    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "thinking" && block.thinking) {
          events.push({ type: "thinking", text: block.thinking });
        }
        if (block.type === "text" && block.text) {
          events.push({ type: "text", text: block.text });
        }
        if (block.type === "tool_use") {
          events.push({ type: "tool_use", name: block.name, input: block.input });
        }
      }
    }

    if (event.type === "user" && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === "tool_result") {
          const resultContent = typeof block.content === "string"
            ? block.content
            : JSON.stringify(block.content);
          events.push({
            type: "tool_result",
            toolUseId: block.tool_use_id,
            content: resultContent,
            isError: block.is_error ?? false,
          });
        }
      }
    }

    if (event.type === "result") {
      events.push({
        type: "result",
        sessionId: event.session_id ?? undefined,
        usage: event.usage ?? undefined,
        costUsd: event.total_cost_usd ?? undefined,
        isError: event.is_error ?? false,
      });
    }

    return events;
  },

  isUnknownSessionError(stdout: string, stderr: string): boolean {
    const combined = `${stdout}\n${stderr}`.toLowerCase();
    return /no conversation found with session id|unknown session|session .* not found/.test(combined);
  },
};
