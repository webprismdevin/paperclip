# @paperclipai/plugin-chat

Multi-adapter AI chat plugin for Paperclip. Supports Claude, Codex, and OpenCode with session persistence, tool visibility, and adapter/model selection.

## Status

**Scaffolded** — requires two dependencies before it's fully functional:

1. **Plugin system** (PR #432) — provides the SDK, bridge hooks, and agent session API
2. **SSE bridge** (issue #440) — enables real-time streaming from worker to plugin UI

Without the SSE bridge, the plugin falls back to polling for message updates (1s interval). Functional but not the intended UX.

## Architecture

```
Plugin UI (page slot)
  ↓ usePluginAction("sendMessage")
Plugin Worker
  ↓ ctx.agentSessions.sendMessage(sessionId, companyId, { onEvent })
Host (agent session → adapter → CLI spawn)
  ↓ AgentSessionEvent notifications
Plugin Worker onEvent callback
  ↓ ctx.streams.emit() [future: SSE bridge]
Plugin UI (real-time updates)
```

## Plugin Capabilities

- `ui.page.register` — full chat page at `/:prefix/plugins/paperclip-chat`
- `agent.sessions.*` — create, send, close agent sessions for streaming chat
- `plugin.state.*` — thread and message persistence in scoped key-value store
- `agents.read` — discover available adapters and models

## Development

```bash
pnpm --filter @paperclipai/plugin-chat build
```

## Configuration

Operators can configure via the plugin settings UI:

- **Default Adapter**: Which adapter to use for new threads (claude_local, codex_local, opencode_local)
- **System Prompt Override**: Custom system prompt appended to all sessions
