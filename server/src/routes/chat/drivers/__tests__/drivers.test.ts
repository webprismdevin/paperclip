import { describe, expect, it } from "vitest";
import { claudeDriver } from "../claude.js";
import { codexDriver } from "../codex.js";
import { openCodeDriver } from "../opencode.js";
import type { ChatSpawnOpts } from "../types.js";

/* ---------- helpers ---------- */

function baseOpts(overrides: Partial<ChatSpawnOpts> = {}): ChatSpawnOpts {
  return {
    model: "claude-sonnet-4-5",
    sessionId: null,
    systemPrompt: "You are a helpful assistant.",
    cwd: "/tmp",
    env: {},
    ...overrides,
  };
}

/* ================================================================
   Claude driver
   ================================================================ */
describe("claudeDriver", () => {
  /* ---------- buildArgs ---------- */
  describe("buildArgs", () => {
    it("produces basic args with model, no session", () => {
      const args = claudeDriver.buildArgs(baseOpts());
      expect(args).toContain("--model");
      expect(args).toContain("claude-sonnet-4-5");
      expect(args).toContain("--output-format");
      expect(args).toContain("stream-json");
      expect(args).not.toContain("--resume");
    });

    it("adds --resume when sessionId is provided", () => {
      const args = claudeDriver.buildArgs(baseOpts({ sessionId: "sess-1" }));
      expect(args).toContain("--resume");
      expect(args).toContain("sess-1");
    });

    it("omits --model when model is empty", () => {
      const args = claudeDriver.buildArgs(baseOpts({ model: "" }));
      expect(args).not.toContain("--model");
    });

    it("passes system prompt via --append-system-prompt", () => {
      const args = claudeDriver.buildArgs(baseOpts({ systemPrompt: "Be concise." }));
      const idx = args.indexOf("--append-system-prompt");
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(args[idx + 1]).toBe("Be concise.");
    });
  });

  /* ---------- parseEvent ---------- */
  describe("parseEvent", () => {
    it("parses system init event", () => {
      const line = JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "abc-123",
        model: "claude-sonnet-4-5",
      });
      expect(claudeDriver.parseEvent(line)).toEqual([
        { type: "session_init", sessionId: "abc-123" },
      ]);
    });

    it("parses assistant text block", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello world" }] },
      });
      expect(claudeDriver.parseEvent(line)).toEqual([
        { type: "text", text: "Hello world" },
      ]);
    });

    it("parses assistant thinking block", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "thinking", thinking: "Let me think..." }] },
      });
      expect(claudeDriver.parseEvent(line)).toEqual([
        { type: "thinking", text: "Let me think..." },
      ]);
    });

    it("parses assistant tool_use block", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Read", input: { path: "/foo" } }],
        },
      });
      expect(claudeDriver.parseEvent(line)).toEqual([
        { type: "tool_use", name: "Read", input: { path: "/foo" } },
      ]);
    });

    it("parses user tool_result block", () => {
      const line = JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-1",
              content: "file contents",
              is_error: false,
            },
          ],
        },
      });
      expect(claudeDriver.parseEvent(line)).toEqual([
        { type: "tool_result", toolUseId: "tu-1", content: "file contents", isError: false },
      ]);
    });

    it("parses result event", () => {
      const line = JSON.stringify({
        type: "result",
        session_id: "abc-123",
        usage: { input_tokens: 100, output_tokens: 50 },
        total_cost_usd: 0.001,
      });
      expect(claudeDriver.parseEvent(line)).toEqual([
        {
          type: "result",
          sessionId: "abc-123",
          usage: { input_tokens: 100, output_tokens: 50 },
          costUsd: 0.001,
          isError: false,
        },
      ]);
    });

    it("returns [] for invalid JSON", () => {
      expect(claudeDriver.parseEvent("not json")).toEqual([]);
    });

    it("parses multiple content blocks in a single message", () => {
      const line = JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "Hmm" },
            { type: "text", text: "Answer" },
          ],
        },
      });
      const events = claudeDriver.parseEvent(line);
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "thinking", text: "Hmm" });
      expect(events[1]).toEqual({ type: "text", text: "Answer" });
    });
  });

  /* ---------- buildStdinMessage ---------- */
  describe("buildStdinMessage", () => {
    it("returns only the user message (system prompt goes via CLI flag)", () => {
      const result = claudeDriver.buildStdinMessage("hello", baseOpts());
      expect(result).toBe("hello");
    });
  });

  /* ---------- isUnknownSessionError ---------- */
  describe("isUnknownSessionError", () => {
    it("detects 'no conversation found with session id'", () => {
      expect(
        claudeDriver.isUnknownSessionError("", "No conversation found with session id abc"),
      ).toBe(true);
    });

    it("detects 'unknown session'", () => {
      expect(claudeDriver.isUnknownSessionError("Unknown session", "")).toBe(true);
    });

    it("detects 'session X not found'", () => {
      expect(
        claudeDriver.isUnknownSessionError("", "session abc-123 not found"),
      ).toBe(true);
    });

    it("returns false for unrelated errors", () => {
      expect(claudeDriver.isUnknownSessionError("rate limit exceeded", "")).toBe(false);
    });
  });
});

/* ================================================================
   Codex driver
   ================================================================ */
describe("codexDriver", () => {
  /* ---------- buildArgs ---------- */
  describe("buildArgs", () => {
    it("produces basic args with model, no session", () => {
      const args = codexDriver.buildArgs(baseOpts());
      expect(args).toContain("exec");
      expect(args).toContain("--json");
      expect(args).toContain("--model");
      expect(args).toContain("claude-sonnet-4-5");
      expect(args[args.length - 1]).toBe("-");
    });

    it("adds resume + sessionId when sessionId provided", () => {
      const args = codexDriver.buildArgs(baseOpts({ sessionId: "th-456" }));
      expect(args).toContain("resume");
      expect(args).toContain("th-456");
      expect(args[args.length - 1]).toBe("-");
    });

    it("omits --model when model is empty", () => {
      const args = codexDriver.buildArgs(baseOpts({ model: "" }));
      expect(args).not.toContain("--model");
    });
  });

  /* ---------- parseEvent ---------- */
  describe("parseEvent", () => {
    it("parses thread.started event", () => {
      const line = JSON.stringify({ type: "thread.started", thread_id: "th-456" });
      expect(codexDriver.parseEvent(line)).toEqual([
        { type: "session_init", sessionId: "th-456" },
      ]);
    });

    it("parses item.completed agent_message with content array", () => {
      const line = JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          content: [{ type: "text", text: "Codex says hello" }],
        },
      });
      expect(codexDriver.parseEvent(line)).toEqual([
        { type: "text", text: "Codex says hello" },
      ]);
    });

    it("parses item.completed agent_message with text field", () => {
      const line = JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Direct text" },
      });
      expect(codexDriver.parseEvent(line)).toEqual([
        { type: "text", text: "Direct text" },
      ]);
    });

    it("parses turn.completed with usage", () => {
      const line = JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 200, output_tokens: 80 },
      });
      expect(codexDriver.parseEvent(line)).toEqual([
        { type: "result", usage: { input_tokens: 200, output_tokens: 80 } },
      ]);
    });

    it("parses error event", () => {
      const line = JSON.stringify({ type: "error", message: "something broke" });
      expect(codexDriver.parseEvent(line)).toEqual([
        { type: "error", text: "something broke" },
      ]);
    });

    it("parses error event with no message", () => {
      const line = JSON.stringify({ type: "error" });
      expect(codexDriver.parseEvent(line)).toEqual([
        { type: "error", text: "Unknown codex error" },
      ]);
    });

    it("returns [] for invalid JSON", () => {
      expect(codexDriver.parseEvent("{broken")).toEqual([]);
    });

    it("parses item.completed function_call", () => {
      const line = JSON.stringify({
        type: "item.completed",
        item: { type: "function_call", name: "shell", arguments: { cmd: "ls" } },
      });
      expect(codexDriver.parseEvent(line)).toEqual([
        { type: "tool_use", name: "shell", input: { cmd: "ls" } },
      ]);
    });

    it("parses item.completed function_call_output", () => {
      const line = JSON.stringify({
        type: "item.completed",
        item: { type: "function_call_output", output: "file.txt" },
      });
      expect(codexDriver.parseEvent(line)).toEqual([
        { type: "tool_result", content: "file.txt", isError: false },
      ]);
    });
  });

  /* ---------- buildStdinMessage ---------- */
  describe("buildStdinMessage", () => {
    it("prepends system prompt on new session", () => {
      const result = codexDriver.buildStdinMessage("hello", baseOpts());
      expect(result).toContain("<system>");
      expect(result).toContain("You are a helpful assistant.");
      expect(result).toContain("hello");
    });

    it("returns only user message when resuming", () => {
      const result = codexDriver.buildStdinMessage("hello", baseOpts({ sessionId: "sess-1" }));
      expect(result).toBe("hello");
    });
  });

  /* ---------- isUnknownSessionError ---------- */
  describe("isUnknownSessionError", () => {
    it("detects 'unknown session'", () => {
      expect(codexDriver.isUnknownSessionError("unknown session", "")).toBe(true);
    });

    it("detects 'session X not found'", () => {
      expect(codexDriver.isUnknownSessionError("", "session th-456 not found")).toBe(true);
    });

    it("detects 'missing rollout path for thread'", () => {
      expect(
        codexDriver.isUnknownSessionError("", "Missing rollout path for thread th-456"),
      ).toBe(true);
    });

    it("returns false for unrelated errors", () => {
      expect(codexDriver.isUnknownSessionError("timeout", "connection refused")).toBe(false);
    });
  });
});

/* ================================================================
   OpenCode driver
   ================================================================ */
describe("openCodeDriver", () => {
  /* ---------- buildArgs ---------- */
  describe("buildArgs", () => {
    it("produces basic args with model, no session", () => {
      const args = openCodeDriver.buildArgs(baseOpts());
      expect(args).toContain("run");
      expect(args).toContain("--format");
      expect(args).toContain("json");
      expect(args).toContain("--model");
      expect(args).toContain("claude-sonnet-4-5");
      expect(args).not.toContain("--session");
    });

    it("adds --session when sessionId provided", () => {
      const args = openCodeDriver.buildArgs(baseOpts({ sessionId: "sess-789" }));
      expect(args).toContain("--session");
      expect(args).toContain("sess-789");
    });

    it("omits --model when model is empty", () => {
      const args = openCodeDriver.buildArgs(baseOpts({ model: "" }));
      expect(args).not.toContain("--model");
    });
  });

  /* ---------- parseEvent ---------- */
  describe("parseEvent", () => {
    it("parses text event with sessionID (emits session_init + text)", () => {
      const line = JSON.stringify({
        sessionID: "sess-789",
        type: "text",
        part: { text: "OpenCode says hi" },
      });
      const events = openCodeDriver.parseEvent(line);
      expect(events).toEqual([
        { type: "session_init", sessionId: "sess-789" },
        { type: "text", text: "OpenCode says hi" },
      ]);
    });

    it("parses text event without sessionID", () => {
      const line = JSON.stringify({ type: "text", part: { text: "Just text" } });
      expect(openCodeDriver.parseEvent(line)).toEqual([
        { type: "text", text: "Just text" },
      ]);
    });

    it("parses tool_use event", () => {
      const line = JSON.stringify({
        type: "tool_use",
        part: { name: "Bash", input: { command: "ls" } },
      });
      expect(openCodeDriver.parseEvent(line)).toEqual([
        { type: "tool_use", name: "Bash", input: { command: "ls" } },
      ]);
    });

    it("parses tool_use with error state", () => {
      const line = JSON.stringify({
        type: "tool_use",
        part: {
          name: "Bash",
          input: { command: "bad" },
          state: { status: "error", error: "command failed" },
        },
      });
      const events = openCodeDriver.parseEvent(line);
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "tool_use", name: "Bash", input: { command: "bad" } });
      expect(events[1]).toEqual({ type: "tool_result", content: "command failed", isError: true });
    });

    it("parses step_finish event with tokens and cost", () => {
      const line = JSON.stringify({
        type: "step_finish",
        part: {
          tokens: { input: 150, output: 60, cache: { read: 0 }, reasoning: 0 },
          cost: 0.002,
        },
      });
      expect(openCodeDriver.parseEvent(line)).toEqual([
        {
          type: "result",
          usage: { input_tokens: 150, output_tokens: 60 },
          costUsd: 0.002,
        },
      ]);
    });

    it("parses step_finish with cache read and reasoning tokens", () => {
      const line = JSON.stringify({
        type: "step_finish",
        part: {
          tokens: { input: 100, output: 40, cache: { read: 50 }, reasoning: 20 },
          cost: 0.003,
        },
      });
      const events = openCodeDriver.parseEvent(line);
      expect(events[0]).toEqual({
        type: "result",
        usage: { input_tokens: 150, output_tokens: 60 },
        costUsd: 0.003,
      });
    });

    it("parses error event", () => {
      const line = JSON.stringify({ type: "error", message: "opencode failed" });
      expect(openCodeDriver.parseEvent(line)).toEqual([
        { type: "error", text: "opencode failed" },
      ]);
    });

    it("parses error event with error field", () => {
      const line = JSON.stringify({ type: "error", error: "something bad" });
      expect(openCodeDriver.parseEvent(line)).toEqual([
        { type: "error", text: "something bad" },
      ]);
    });

    it("returns [] for invalid JSON", () => {
      expect(openCodeDriver.parseEvent("garbage")).toEqual([]);
    });
  });

  /* ---------- buildStdinMessage ---------- */
  describe("buildStdinMessage", () => {
    it("prepends system prompt on new session", () => {
      const result = openCodeDriver.buildStdinMessage("hello", baseOpts());
      expect(result).toContain("<system>");
      expect(result).toContain("You are a helpful assistant.");
      expect(result).toContain("hello");
    });

    it("returns only user message when resuming", () => {
      const result = openCodeDriver.buildStdinMessage("hello", baseOpts({ sessionId: "sess-1" }));
      expect(result).toBe("hello");
    });
  });

  /* ---------- isUnknownSessionError ---------- */
  describe("isUnknownSessionError", () => {
    it("detects 'unknown session'", () => {
      expect(openCodeDriver.isUnknownSessionError("Unknown session", "")).toBe(true);
    });

    it("detects 'session X not found'", () => {
      expect(
        openCodeDriver.isUnknownSessionError("", "session sess-789 not found"),
      ).toBe(true);
    });

    it("detects 'resource not found.*session'", () => {
      expect(
        openCodeDriver.isUnknownSessionError("", "Resource not found: session abc"),
      ).toBe(true);
    });

    it("detects 'notfounderror'", () => {
      expect(openCodeDriver.isUnknownSessionError("NotFoundError", "")).toBe(true);
    });

    it("returns false for unrelated errors", () => {
      expect(openCodeDriver.isUnknownSessionError("api error", "500 internal")).toBe(false);
    });
  });
});
