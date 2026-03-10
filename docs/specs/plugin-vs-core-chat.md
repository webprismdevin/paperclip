# Plugin vs Core: Chat Feature Analysis

**Audience:** OSS team
**Date:** 2026-03-10
**Branch:** `plugin/chat-ui`

---

## Context

We built a full chat UI as a Paperclip plugin (`paperclip-chat`) to test whether the plugin system can support primary user-facing features. This document captures what worked, what didn't, and the hard boundaries we hit — so the team can make an informed build-vs-plugin decision for chat and similar features.

## Recommendation

**Build chat as a plugin.** The plugin system developer is actively adding the two features that were the biggest blockers — direct LLM access and model discovery. With those incoming, the plugin approach is viable for production.

**Resolved or in progress:**
- Direct LLM access with model selection — generic LLM session API (in progress)
- Token streaming — SSE via `usePluginStream()` (resolved)
- Design system — host CSS vars for tokens, plugin should bundle its own Tailwind (see below)
- Agent-specific chat — system prompt override per-session (in progress)

**Still missing (but livable):**
- First-class routing and deep linking — thread state is component-only, no shareable URLs
- User identity — UUID only, "U" avatar
- Host page chrome control — back button + breadcrumbs on all page slots
- Bridge UI component stubs — plugins bundle their own markdown renderer, spinner, etc.

**Fallback:** If the SDK additions stall or the API doesn't meet our needs, the plugin implementation ports cleanly to a core `Chat.tsx` page. The UX patterns (thread CRUD, slash commands, streaming, sidebar) transfer directly.

---

## What We're Building

Two-mode chat plugin:

1. **Generic chat** — direct LLM access via `ctx.llm.sessions.*`, plugin-controlled system prompt, user-selectable provider/model. Primary use cases: quick Q&A, drafting, inspecting agent run failures, improving agent instructions, creating/reviewing issues.

2. **Agent chat** — talk to specific Paperclip agents (CEO, Engineer, QA) via `ctx.agents.sessions.*` with `systemPromptOverride` for conversational behavior. Primary use cases: ask the CEO about strategy, review work with QA, get engineering context — without triggering autonomous task execution.

Both modes share the same UI: thread list, message stream, slash commands, streaming. The mode is selected by the user when starting a new thread (pick a model vs. pick an agent).

### Generic Chat — "I want to use Claude"

A general-purpose conversational interface. Users pick a provider/model, ask questions, get responses. No agent abstraction — the plugin controls the system prompt and model directly.

**Status:** Blocked on the new generic LLM session API. Currently routes through agent sessions as a workaround (fragile "Chat Assistant" name-match heuristic). Once `ctx.llm.sessions.*` (or equivalent) lands, this becomes first-class.

**Use cases:** Quick Q&A, drafting, brainstorming, inspecting where agent runs fail, improving agent instructions, reviewing issues.

### Agent-Specific Chat — "I want to talk to the CEO"

Chat with a specific Paperclip agent (CEO, Engineer, QA, etc.) where the agent's full context (tools, knowledge, system prompt) is available, but the interaction mode is conversational rather than autonomous task execution.

**Status:** Blocked on system prompt override per-session. The plugin can mechanically create a session with any agent today, but the agent runs in full task-execution mode — there's no way to inject "respond conversationally, don't autonomously execute tasks."

**Use cases:** Ask the CEO agent about strategy, ask the Engineer about a codebase decision, review work with QA — all without kicking off autonomous task runs.

**The plugin system developer is actively designing both session types** and will update PR #432.

---

## SDK Requirements for Chat Plugin

This is what we need from the plugin SDK to make both chat modes work. Ordered by priority.

### Required — Generic LLM Session API

The new API needs to support at minimum:

```typescript
// 1. Discover available providers and models
const providers = await ctx.llm.listProviders();
// Returns: [{ type: "claude_local", displayName: "Claude", models: [{ id: "claude-sonnet-4-20250514", name: "Sonnet" }, ...] }, ...]

// 2. Create a generic LLM session with provider/model/system prompt
const session = await ctx.llm.sessions.create({
  companyId,
  provider: "claude_local",
  model: "claude-sonnet-4-20250514",
  systemPrompt: "You are a helpful assistant for Paperclip. You can reference issues with #123 syntax.",
});

// 3. Send a message and get a stream back
await ctx.llm.sessions.sendMessage({
  sessionId: session.id,
  message: "What's the status of our open issues?",
});
// Stream events arrive via ctx.streams (existing SSE pipeline)

// 4. Message history for multi-turn conversation
const history = await ctx.llm.sessions.getMessages({ sessionId: session.id });
```

**Key points:**
- `listProviders()` must return models per provider — this makes the model picker functional
- `systemPrompt` on session creation — the plugin controls the persona, not the agent's `agents.md`
- Streaming via the existing `ctx.streams` pipeline — no new transport needed
- Session persistence — multi-turn conversations need message history

**Capability:** `llm.sessions.create`, `llm.sessions.send`, `llm.sessions.read` (or similar)

### Required — Agent Session System Prompt Override

For agent-specific chat, the existing `ctx.agents.sessions.create()` needs one addition:

```typescript
const session = await ctx.agents.sessions.create({
  agentId: "ceo-agent-id",
  companyId,
  systemPromptOverride: "You are in a conversational chat session. Respond to the user's messages directly. Do not autonomously execute tasks or run tools unless the user explicitly asks.",
});
```

**Key points:**
- `systemPromptOverride` appends to (or replaces) the agent's default system prompt for this session only
- Does not modify the agent's persistent config — session-scoped only
- Lets the plugin differentiate "chat mode" from "task mode" per-session
- The agent's context (knowledge, tools) remains available, just the interaction style changes

### Required — Agent List with Metadata

`ctx.agents.list()` already works, but the chat plugin needs enough metadata to build a useful agent picker:

```typescript
const agents = await ctx.agents.list({ companyId });
// Each agent needs: id, name, role, adapterType, status, description/avatar (nice-to-have)
```

This already mostly works. The missing piece is surfacing agent descriptions or roles in a way the chat UI can display ("Talk to CEO", "Talk to Engineer").

### Nice-to-Have — User Display Info

`useHostContext()` returns `userId` as a UUID. Chat needs:

```typescript
const { userId, userName, userEmail, userAvatarUrl } = useHostContext();
```

Without this, chat shows "U" as the user avatar. Not a blocker, but makes the experience impersonal.

### Nice-to-Have — Plugin Page Chrome Control

Allow `page` slots to opt out of the host's breadcrumbs + back button:

```typescript
// In manifest
ui: {
  slots: [{
    type: "page",
    id: "chat-page",
    chrome: "none", // or "minimal" — suppress breadcrumbs and back button
  }]
}
```

Accepted as-is for now — not a blocker.

---

## The Original Problem (largely resolved)

> **Update (2026-03-10):** The plugin system developer has agreed to add a **generic LLM session** API alongside the existing agent session API, plus a **system prompt override** on agent sessions. This addresses the core problem described below. See [SDK Requirements](#sdk-requirements-for-chat-plugin) for the exact API surface.

~~Chat and Paperclip agents are fundamentally different interaction models. Chat is synchronous, conversational, and user-driven. Paperclip agents are autonomous, task-oriented, and system-driven. An agent session doesn't distinguish between "answer this question" and "go execute this task." It runs the same pipeline either way.~~

~~The plugin system has no direct LLM access. A chat plugin's only path to an LLM is `ctx.agents.sessions.*` — which creates conversational sessions with **existing agents**. This creates a hard dependency chain:~~

1. ~~An operator must manually create a compatible agent outside the plugin~~
2. ~~The plugin discovers that agent by name or role using fragile heuristics~~
3. ~~The plugin creates a session with that agent and sends messages through it~~
4. ~~The agent runs in its full task-execution mode regardless of whether the user asked a simple question~~
5. ~~The plugin cannot create agents, configure their instructions, select models, or control any aspect of the LLM interaction~~

~~**The plugin doesn't talk to a model. It talks to an agent that happens to talk to a model.**~~

With the incoming dual session types, the plugin will talk directly to a model (generic LLM session) OR intentionally talk to an agent with conversational behavior (agent session with override). The indirection problem goes away.

---

## Plugin System Capabilities (What Plugins CAN Do)

The plugin SDK (`PluginContext`) exposes these APIs to worker code:

| API | Purpose | Capabilities Required | Status |
|-----|---------|----------------------|--------|
| `ctx.config` | Read operator config | — | Working |
| `ctx.state` | Key-value storage (company/instance/user scoped) | `plugin.state.read/write` | Working |
| `ctx.events` | Subscribe to / emit domain events | `events.subscribe/emit` | Working |
| `ctx.jobs` | Register scheduled jobs | `jobs.schedule` | Working |
| `ctx.http` | Outbound HTTP requests | `http.outbound` | Working |
| `ctx.secrets` | Resolve secret references | `secrets.read-ref` | Working |
| `ctx.assets` | Read/write file assets | `assets.read/write` | Working |
| `ctx.activity` | Write activity log entries | `activity.log.write` | Working |
| `ctx.entities` | CRUD plugin-owned entity records | — | Working |
| `ctx.projects` | Read project/workspace metadata | `projects.read` | Working |
| `ctx.companies` | Read company metadata | `companies.read` | Working |
| `ctx.issues` | Read/write issues and comments | issue capabilities | Working |
| `ctx.agents` | List/get/pause/resume/invoke agents | `agents.read/pause/resume/invoke` | Working |
| `ctx.agents.sessions` | Create sessions, send messages, stream events | `agent.sessions.*` | Working |
| `ctx.goals` | Read/mutate goals | `goals.read/create/update` | Working |
| `ctx.data` | Register `getData` handlers for UI | — | Working |
| `ctx.actions` | Register `performAction` handlers for UI | — | Working |
| `ctx.streams` | Push real-time events to UI via SSE | — | Working |
| `ctx.tools` | Register agent tool handlers | `agent.tools.register` | Working |
| `ctx.metrics` | Write plugin metrics | `metrics.write` | Working |
| `ctx.logger` | Structured logging | — | Working |
| `ctx.launchers` | Register launcher UI entry points | — | Working |
| `ctx.llm.sessions` | Generic LLM sessions (provider/model/system prompt) | `llm.sessions.*` (TBD) | **Coming** |
| `ctx.llm.listProviders` | Discover available providers and models | `llm.sessions.*` (TBD) | **Coming** |

The UI bridge exposes these hooks to plugin frontend code:

| Hook | Purpose | Status |
|------|---------|--------|
| `usePluginData(key)` | Fetch data from worker `getData` handler | Working |
| `usePluginAction(key)` | Call worker `performAction` handler | Working |
| `useHostContext()` | Get company/project/user IDs | Working |
| `usePluginStream(channel)` | Subscribe to SSE stream from worker | Working |

UI components (`MetricCard`, `StatusBadge`, `MarkdownBlock`, `Spinner`, etc.) are registered as **non-functional stubs** — they render placeholder `<div>` elements. Plugins bundle their own equivalents.

---

## Hard Boundaries

### Resolved or Being Addressed

#### 1. ~~No Agent Creation~~ — No Longer Needed

~~Plugins cannot create agents — only interact with existing ones.~~

With the generic LLM session API coming, the chat plugin doesn't need to create agents. Generic chat creates LLM sessions directly. Agent-specific chat uses existing agents via `ctx.agents.sessions.*` with a system prompt override.

#### 2. ~~No Direct LLM / Adapter Access~~ — Being Addressed

~~There is no `ctx.llm` or `ctx.adapters` API. All LLM access goes through agent sessions.~~

The plugin system developer is adding `ctx.llm.sessions.*` — a generic LLM session API with direct provider/model access and system prompt control. See [SDK Requirements](#sdk-requirements-for-chat-plugin).

#### 4. ~~No Design System Access~~ — Largely Resolved

**Design tokens:** The host exposes CSS custom properties (`--foreground`, `--background`, `--card`, `--border`, `--accent`, `--muted-foreground`, `--destructive`, etc.) that plugins inherit automatically. These are the source of truth for colors and theming. Dark mode is detected via `document.documentElement.classList.contains("dark")`.

**Tailwind classes:** Currently our plugin inherits the host's Tailwind stylesheet, which works because we ship with the host and our classes are in its purge/content list. The file browser example works the same way. **However, this is fragile for standalone plugins** — if the host tree-shakes its CSS or changes its Tailwind config, plugin classes could disappear. Standalone plugins should bundle their own Tailwind output, referencing the host's CSS variables for token values.

**What this means for our build:**
- Bundle our own Tailwind CSS in the plugin's UI build step (`build-ui.mjs`)
- Configure Tailwind to use the host's CSS variable names for colors (e.g., `--foreground`, `--border`)
- The plugin becomes self-contained: its own utility classes, host's design tokens
- Dark mode, responsive breakpoints, and theme matching all work the same way

**Still missing:** Bridge UI component stubs (plugins bundle their own `react-markdown`, spinner, etc.) and no `useToast()`/`useDialog()`. Not a blocker.

#### 7. ~~Streaming Bridge Not Wired~~ — Resolved

Full SSE pipeline implemented end-to-end on `feature/plugins-clean`:
- Server: `plugin-stream-bus.ts` (in-memory pub/sub) + SSE route
- Worker: `ctx.streams.emit/open/close` via JSON-RPC notifications
- Bridge: `usePluginStream()` implemented in `bridge.ts` using `EventSource`
- SDK: `PluginStreamResult<T>` type exported

Our plugin uses this correctly — worker emits via `ctx.streams.emit()`, UI consumes via `usePluginStream<ChatStreamEvent>()`.

#### 9. ~~No Agent Configuration Access~~ — Being Addressed

**What's coming:**
- **Generic LLM sessions** (`ctx.llm.sessions.*`) — the plugin controls the system prompt and model directly, bypassing agents entirely
- **System prompt override** on `ctx.agents.sessions.create()` — for agent-specific chat, inject conversational behavior per-session
- **Model discovery** (`ctx.llm.listProviders()`) — returns available providers with their model lists

#### 10. ~~Agent Sessions Are Task-Oriented, Not Conversational~~ — Being Addressed

~~The plugin's only path to LLM access is `ctx.agents.sessions.*`, which creates sessions designed for task execution.~~

**What's coming:** Dual session types:
1. **Generic LLM session** — "I want to use Claude" — direct provider/model, plugin-controlled system prompt, no agent overhead
2. **Agent session with override** — "I want to talk to the CEO" — agent's full context available, but conversational behavior injected via `systemPromptOverride`

### Remaining Limitations (Livable)

#### 3. No Process Execution

There is no `ctx.exec()`, `ctx.spawn()`, or any shell/process API. Not needed for chat — the generic LLM session API handles LLM access without shell access.

#### 5. No Host UI APIs

| API | What it enables | Plugin access |
|-----|-----------------|---------------|
| `useToast()` | Success/error notifications | None |
| `useDialog()` | Confirmation modals | None |
| `useRouter()` | Navigate to issues/projects/agents | None |
| `useBreadcrumbs()` | "Chat > Thread Name" navigation | None |
| `useSidebar()` | Collapse host sidebar for full-width chat | None |

#### 6. No Sub-Routes or Deep Linking

Plugin pages route to `/:companyPrefix/plugins/:pluginId` (UUID). No sub-routing — no `/chat/thread/:threadId` URLs. Refreshing the page loses the selected thread. Users can't share links to specific conversations.

#### 8. UUID-Only User Identity

`useHostContext()` provides `userId` as a UUID. No user name, email, or avatar URL. The chat plugin shows "U" as the user avatar.

#### 11. No Plugin Page Chrome Control

The host's `PluginPage.tsx` wraps all plugin pages with breadcrumbs and a "Back" button. No manifest option to suppress this. **Accepted as-is** — the file browser example avoids it by using `detailTab` slots, but chat is a top-level feature and `page` is the correct slot type.

---

## What We Had to Build Around

| Gap | Workaround | Status |
|-----|-----------|--------|
| ~~No streaming~~ | ~~Poll `getData` every 1.5s~~ → SSE via `usePluginStream()` | **Resolved** |
| ~~No direct LLM access~~ | ~~Route through agent sessions~~ → Generic LLM session API | **Coming** |
| ~~No model discovery~~ | ~~Model picker is dead code~~ → `ctx.llm.listProviders()` | **Coming** |
| ~~Task-oriented sessions only~~ | ~~Agent runs in full execution mode for Q&A~~ → Dual mode | **Coming** |
| ~~No agent config access~~ | ~~Hardcode "Chat Assistant" name~~ → `systemPromptOverride` | **Coming** |
| ~~No design system~~ | Host CSS vars for tokens; plugin should bundle its own Tailwind | **Resolved** — need to add Tailwind build step |
| ~~No agent creation~~ | ~~Pre-provision agent manually~~ | **No longer needed** |
| No markdown renderer | Bundle `react-markdown` + `remark-gfm` | Livable |
| No toast API | Silent failures, `console.error` only | Livable |
| No sub-routes | Thread selection is component state | Livable |
| No user identity | Show "U" avatar, no display name | Livable |
| No deep linking | Thread IDs stored in plugin state only | Livable |
| Host page chrome | Can't hide breadcrumbs or back button | Accepted |

---

## What Would Still Need to Change

### Nice-to-have improvements
1. **Implement bridge UI components** — replace stubs with real `MarkdownBlock`, `Spinner`, `DataTable`. Plugins currently bundle their own. Nice-to-have.
2. **Add `useToast()` and `useDialog()` to the bridge** — plugins handle errors silently. Nice-to-have.
3. **Expose user display info** in `useHostContext()` (name, email, avatar URL) — chat shows "U" avatar. Nice-to-have.
4. **Plugin page chrome control** — allow plugins to opt out of breadcrumbs/back button. Accepted as-is.

### Navigation improvements
5. **Route by plugin key** — `PluginPage.tsx` should match by key or UUID. Plugin URLs are fragile UUIDs that break on reinstall.
6. **Plugin sub-routes** — `/plugins/:id/*` with plugin-controlled routing. No deep linking, no shareable thread URLs, no browser back/forward.

---

## Side-by-Side Comparison

| Capability | Plugin Chat | Core Chat Page |
|------------|------------|----------------|
| Token streaming | SSE via `usePluginStream()` (resolved) | Native SSE |
| LLM access | Generic LLM sessions (coming) | Direct adapter API |
| Design system | Bundled Tailwind + host CSS vars for tokens | Full component library |
| Model selection | `listProviders()` (coming) | Direct model picker |
| Agent chat | `systemPromptOverride` (coming) | Full control |
| Markdown rendering | Bundled `react-markdown` + `remark-gfm` | Host's `MarkdownBlock` |
| Error feedback | `console.error` | Toast notifications |
| Navigation | Plugin slot | Link to issues, projects, agents |
| Routing | `/plugins/:uuid` | `/chat`, `/chat/:threadId` |
| User identity | UUID only, "U" avatar | Full user profile, avatar |
| State persistence | Plugin key-value store | Dedicated DB tables |
| Thread sharing | No deep links | Shareable URLs |
| Page chrome | Back button + breadcrumbs (accepted) | Full layout control |

---

## What the Plugin Experiment Validated

These patterns are proven and will carry forward:

- Thread CRUD model (create, list, rename, delete, archive)
- Slash command system with keyboard navigation
- Message streaming via SSE (`usePluginStream`) and incremental rendering
- Welcome screen → thread → message flow
- Collapsible sidebar with thread search
- Auto-resize textarea input
- Error segment rendering in message streams
- Issue reference linking in messages (`#123` → issue link)
- Host CSS variables for design tokens + bundled Tailwind for utility classes
- Utility hooks from the file browser example (`useIsDarkMode`, `useIsMobile`, `useAvailableHeight`)

**The plugin is no longer just a prototype.** With the incoming SDK additions (generic LLM sessions, model discovery, system prompt override), the plugin becomes a viable production path. The remaining gaps (routing, user identity, page chrome) are UX polish that can be addressed incrementally.
