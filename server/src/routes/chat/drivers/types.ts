export interface ChatSpawnOpts {
  model: string;
  sessionId: string | null;
  systemPrompt: string;
  cwd: string;
  env: Record<string, string>;
}

export interface ChatEvent {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "error" | "session_init" | "result";
  text?: string;
  name?: string;
  input?: unknown;
  content?: string;
  isError?: boolean;
  sessionId?: string;
  toolUseId?: string;
  usage?: { input_tokens: number; output_tokens: number };
  costUsd?: number;
}

export interface ChatDriver {
  /** Matches adapter registry type: "claude_local", "codex_local", "opencode_local" */
  type: string;
  /** CLI binary name: "claude", "codex", "opencode" */
  command: string;
  /** Display label: "Claude", "Codex", "OpenCode" */
  label: string;
  /** Build CLI args for spawning the process */
  buildArgs(opts: ChatSpawnOpts): string[];
  /** Parse a single JSONL line into zero or more normalized chat events */
  parseEvent(line: string): ChatEvent[];
  /** Detect unknown session errors from stdout/stderr */
  isUnknownSessionError(stdout: string, stderr: string): boolean;
}
