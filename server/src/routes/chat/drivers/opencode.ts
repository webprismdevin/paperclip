import type { ChatDriver, ChatEvent, ChatSpawnOpts } from "./types.js";

export const openCodeDriver: ChatDriver = {
  type: "opencode_local",
  command: "opencode",
  label: "OpenCode",

  buildArgs(opts: ChatSpawnOpts): string[] {
    const args = ["run", "--format", "json"];
    if (opts.model) {
      args.push("--model", opts.model);
    }
    if (opts.sessionId) {
      args.push("--session", opts.sessionId);
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

    if (event.sessionID) {
      events.push({ type: "session_init", sessionId: event.sessionID });
    }

    if (event.type === "text" && event.part?.text) {
      events.push({ type: "text", text: event.part.text });
    }

    if (event.type === "tool_use") {
      const toolName = event.part?.tool ?? event.part?.name ?? "tool";
      const state = event.part?.state;
      events.push({
        type: "tool_use",
        name: toolName,
        input: state?.input ?? event.part?.input ?? event.part?.arguments,
      });
      if (state?.status === "completed" && state.output != null) {
        events.push({
          type: "tool_result",
          content: typeof state.output === "string" ? state.output : JSON.stringify(state.output),
          isError: false,
        });
      } else if (state?.status === "error") {
        events.push({
          type: "tool_result",
          content: state.error ?? "Tool error",
          isError: true,
        });
      }
    }

    if (event.type === "step_finish" && event.part) {
      const tokens = event.part.tokens;
      if (tokens) {
        events.push({
          type: "result",
          usage: {
            input_tokens: (tokens.input ?? 0) + (tokens.cache?.read ?? 0),
            output_tokens: (tokens.output ?? 0) + (tokens.reasoning ?? 0),
          },
          costUsd: event.part.cost ?? undefined,
        });
      }
    }

    if (event.type === "error") {
      const msg = event.error ?? event.message ?? "Unknown opencode error";
      events.push({ type: "error", text: typeof msg === "string" ? msg : JSON.stringify(msg) });
    }

    return events;
  },

  buildStdinMessage(userMessage: string, opts: ChatSpawnOpts): string {
    // OpenCode has no system-prompt flag; prepend instructions to the user message
    if (opts.sessionId) return userMessage; // resuming — system prompt already in context
    return `<system>\n${opts.systemPrompt}\n</system>\n\n${userMessage}`;
  },

  isUnknownSessionError(stdout: string, stderr: string): boolean {
    const combined = `${stdout}\n${stderr}`.toLowerCase();
    return /unknown session|session .* not found|resource not found.*session|notfounderror/.test(combined);
  },
};
