# Plugin vs Core: Chat Feature Analysis

**Audience:** OSS team
**Date:** 2026-03-10
**Branch:** `plugin/chat-ui`

---

## Context

We built a full chat UI as a Paperclip plugin (`paperclip-chat`) to test whether the plugin system can support primary user-facing features. This document captures what worked, what didn't, and the hard boundaries we hit — so the team can make an informed build-vs-plugin decision for chat and similar features.

## The Core Problem

Chat and Paperclip agents are fundamentally different interaction models. Chat is synchronous, conversational, and user-driven — the user sends a message, the model responds, back and forth. Paperclip agents are autonomous, task-oriented, and system-driven — they receive a goal, execute multi-step plans, call tools, and report back when done. An agent session doesn't distinguish between "answer this question" and "go execute this task." It runs the same pipeline either way: full tool access, multi-step reasoning, autonomous execution. There's no "just respond to this message" mode.

This means a simple question like "what's 2+2?" goes through the same execution path as "create a sprint plan and assign tasks to all agents" — the overhead is identical, and the plugin has no way to tell the agent to behave differently.

The plugin system has no direct LLM access. A chat plugin's only path to an LLM is `ctx.agents.sessions.*` — which creates conversational sessions with **existing agents**. This creates a hard dependency chain:

1. An operator must manually create a compatible agent outside the plugin (e.g., "Chat Assistant")
2. The plugin discovers that agent by name or role using fragile heuristics (`agents.list()` → filter by adapter type → match by hardcoded name)
3. The plugin creates a session with that agent and sends messages through it
4. The agent runs in its full task-execution mode regardless of whether the user asked a simple question
5. The plugin cannot create agents, configure their instructions, select models, or control any aspect of the LLM interaction

**The plugin doesn't talk to a model. It talks to an agent that happens to talk to a model.** This indirection means the chat experience is entirely outside the plugin's control — it depends on how the agent was configured, what tools it has, and what system prompt it was given. The plugin is a UI wrapper around someone else's agent setup.

A core chat page would have direct adapter access — pick a model, provide a system prompt, send messages, stream the response. No agent abstraction, no pre-configuration dependency, no fragile name matching.

---

## Plugin System Capabilities (What Plugins CAN Do)

The plugin SDK (`PluginContext`) exposes these APIs to worker code:

| API | Purpose | Capabilities Required |
|-----|---------|----------------------|
| `ctx.config` | Read operator config | — |
| `ctx.state` | Key-value storage (company/instance/user scoped) | `plugin.state.read/write` |
| `ctx.events` | Subscribe to / emit domain events | `events.subscribe/emit` |
| `ctx.jobs` | Register scheduled jobs | `jobs.schedule` |
| `ctx.http` | Outbound HTTP requests | `http.outbound` |
| `ctx.secrets` | Resolve secret references | `secrets.read-ref` |
| `ctx.assets` | Read/write file assets | `assets.read/write` |
| `ctx.activity` | Write activity log entries | `activity.log.write` |
| `ctx.entities` | CRUD plugin-owned entity records | — |
| `ctx.projects` | Read project/workspace metadata | `projects.read` |
| `ctx.companies` | Read company metadata | `companies.read` |
| `ctx.issues` | Read/write issues and comments | issue capabilities |
| `ctx.agents` | List/get/pause/resume/invoke agents | `agents.read/pause/resume/invoke` |
| `ctx.agents.sessions` | Create sessions, send messages, stream events | `agent.sessions.*` |
| `ctx.goals` | Read/mutate goals | `goals.read/create/update` |
| `ctx.data` | Register `getData` handlers for UI | — |
| `ctx.actions` | Register `performAction` handlers for UI | — |
| `ctx.streams` | Push real-time events to UI via SSE | — |
| `ctx.tools` | Register agent tool handlers | `agent.tools.register` |
| `ctx.metrics` | Write plugin metrics | `metrics.write` |
| `ctx.logger` | Structured logging | — |
| `ctx.launchers` | Register launcher UI entry points | — |

The UI bridge exposes these hooks to plugin frontend code:

| Hook | Purpose | Status |
|------|---------|--------|
| `usePluginData(key)` | Fetch data from worker `getData` handler | Working |
| `usePluginAction(key)` | Call worker `performAction` handler | Working |
| `useHostContext()` | Get company/project/user IDs | Working |
| `usePluginStream(channel)` | Subscribe to SSE stream from worker | **Declared but not implemented** |

UI components (`MetricCard`, `StatusBadge`, `MarkdownBlock`, `Spinner`, etc.) are registered as **non-functional stubs** — they render placeholder `<div>` elements.

---

## Hard Boundaries (What Plugins CANNOT Do)

### 1. No Agent Creation

Plugins can interact with existing agents (`list`, `get`, `pause`, `resume`, `invoke`) and create conversational sessions with them (`sessions.create`, `sessions.sendMessage`). But there is **no `agents.create()` API** — agents must be created outside the plugin system.

The core `agentService.create()` exists server-side but is not wired to the plugin JSON-RPC protocol.

**Impact on chat:** The chat plugin requires a pre-existing "Chat Assistant" agent. It can't programmatically provision or configure agents per-workspace.

### 2. No Direct LLM / Adapter Access

There is no `ctx.chat`, `ctx.llm`, or `ctx.adapters` API. All LLM access goes through agent sessions, which are designed for task execution:

- Every message creates or resumes an agent session with its own `agents.md` system prompt
- No way to select models, set temperature, or customize system prompts per-thread
- The agent abstraction adds indirection that doesn't fit conversational chat

**What chat actually needs:** `ctx.chat.stream(adapterType, model, messages)` — pick a model, send messages, get a stream back.

### 3. No Process Execution

There is no `ctx.exec()`, `ctx.spawn()`, or any shell/process API. Plugins cannot:

- Run CLI tools (Claude CLI, Codex, OpenCode, etc.)
- Spawn background processes
- Execute arbitrary binaries

The only way to run an LLM process is through the host's agent adapter system, which the plugin has no control over.

### 4. No Design System Access

Plugin UI bundles run in an isolated ESM scope. Bridge components are stubs:

```
MetricCard    → renders [MetricCard]
StatusBadge   → renders [StatusBadge]
MarkdownBlock → renders [MarkdownBlock]
Spinner       → renders [Spinner]
```

The chat plugin had to rewrite its entire UI with inline styles — no design tokens, no Tailwind, no `lucide-react` icons, no theme consistency with the host app. We use CSS custom properties (`var(--border)`, `var(--accent)`, etc.) that happen to inherit from the host, but this is fragile and undocumented.

### 5. No Host UI APIs

| API | What it enables | Plugin access |
|-----|-----------------|---------------|
| `useToast()` | Success/error notifications | None |
| `useDialog()` | Confirmation modals | None |
| `useRouter()` | Navigate to issues/projects/agents | None |
| `useBreadcrumbs()` | "Chat > Thread Name" navigation | None |
| `useSidebar()` | Collapse host sidebar for full-width chat | None |

### 6. No Sub-Routes or Deep Linking

Plugin pages route to `/:companyPrefix/plugins/:pluginId` (UUID). There is no sub-routing — no `/chat/thread/:threadId` URLs.

- Refreshing the page loses the selected thread
- Users can't share links to specific conversations
- Browser back/forward doesn't work within the plugin

### 7. Streaming Bridge Not Wired

The SSE backend is fully implemented (`ctx.streams.open/emit/close`, stream bus, SSE endpoint). The `usePluginStream()` hook is declared in the SDK and registered in `bridge-init.ts`, but has **no concrete implementation** in `bridge.ts`. This is ~60 lines of code to fix.

**Impact today:** Chat plugin polls every 1.5s for new messages. Users see chunked text instead of token-by-token streaming.

### 8. UUID-Only User Identity

`useHostContext()` provides `userId` as a UUID. No user name, email, or avatar URL. The chat plugin shows "U" as the user avatar because it has no way to get the user's display name.

### 9. No Agent Configuration Access

The plugin SDK exposes no API for reading or writing agent instructions, system prompts, adapter config, or model selection. `ctx.agents` only provides read-only metadata (`list`, `get`) and control operations (`pause`, `resume`, `invoke`). This means:

- The plugin can't customize the agent's behavior per-thread or per-conversation
- No way to set a system prompt like "You are a helpful chat assistant" — the agent's `agents.md` takes over entirely
- No model picker — agents have a single `adapterType` with no exposed model list, and `sessions.sendMessage()` has no model override parameter
- The chat experience is entirely dependent on how the agent was manually configured outside the plugin

**Model selection is a dead feature in the plugin.** The `adapters` data handler calls `ctx.agents.list()`, deduplicates by `adapterType`, and returns adapter options — but always with `models: []` because there's no API to discover what models an adapter supports. The model is determined internally by the agent's adapter config (e.g., what's in `agents.md`). Even if we hardcoded a model list or made it operator-configurable via `instanceConfigSchema`, `sessions.sendMessage()` has no model parameter — the plugin can't pass a model choice through to the agent. The plugin settings page (auto-generated from `instanceConfigSchema`) could expose model options, but they'd be cosmetic only.

### 10. Agent Sessions Are Task-Oriented, Not Conversational

The plugin's only path to LLM access is `ctx.agents.sessions.*`, which creates sessions with existing agents. These sessions are designed for task execution (give an agent work, watch it run tools), not conversational chat. The mismatch shows up in practice:

**Current agent selection logic (fragile):**
1. List all agents in the company
2. Filter by `adapterType` matching the thread's adapter
3. Hardcoded preference: find agent named `"Chat Assistant"` → fallback to role `"general"` → fallback to first match
4. Create a session with that agent

**Problems:**
- Magic string dependency on an agent named "Chat Assistant" — breaks if renamed or deleted
- Every conversation routes to the same agent regardless of user intent
- The agent's autonomous execution mode (tool calls, multi-step reasoning) runs even for simple Q&A
- No way to differentiate "chat mode" from "task mode" — the agent behaves the same either way
- Letting users chat with specific agents (CEO, Engineer, etc.) is mechanically possible via the sessions API, but those agents are configured for task execution, not conversation — their system prompts, tools, and behavior don't adapt to a chat context

**What chat actually needs:** A lightweight conversational API — pick a model, provide a system prompt, send messages, stream the response. No agent abstraction, no task execution overhead, no dependency on pre-configured agents.

### 11. No Plugin Page Chrome Control

The host's `PluginPage.tsx` wraps all plugin pages with breadcrumbs ("Plugins > Chat") and a "Back" button. There is no manifest option or bridge API to suppress or customize this wrapper. Plugins that want a full-screen, immersive experience (like chat) are stuck with navigation chrome that doesn't fit.

---

## What We Had to Build Around

These are the workarounds we implemented in the plugin to compensate for missing platform features:

| Gap | Workaround | Cost |
|-----|-----------|------|
| No streaming | Poll `getData` every 1.5s, buffer chunks in worker state | Choppy UX, wasted requests |
| No design system | ~400 lines of inline CSS with `var()` fallbacks | Fragile, doesn't match host exactly |
| No markdown renderer | Bundle our own (basic regex-based) | Missing features vs host's `MarkdownBlock` |
| No toast API | Silent failures, `console.error` only | Users don't know when things break |
| No sub-routes | Thread selection is component state | Lost on refresh, no shareable URLs |
| No agent creation | Pre-provision a "Chat Assistant" agent manually | Can't self-configure on install |
| No user identity | Show "U" avatar, no display name | Impersonal chat experience |
| No deep linking | Thread IDs stored in plugin state only | No URL-based thread access |
| No agent config access | Hardcode agent name "Chat Assistant", hope it exists | Can't customize system prompt or behavior |
| Task-oriented sessions | Agent runs in full execution mode for simple Q&A | Unnecessary tool calls, slow responses |
| No model discovery | Model picker is dead code, always empty | Users can't choose models |
| Host page chrome | Can't hide breadcrumbs or back button | Wasted vertical space, non-immersive |

---

## Side-by-Side Comparison

| Capability | Plugin Chat (Current) | Core Chat Page |
|------------|----------------------|----------------|
| Token streaming | 1.5s polling | Native SSE, token-by-token |
| LLM access | Agent sessions only (indirect) | Direct adapter API, model selection |
| Process execution | None | Can spawn CLI tools directly |
| Design system | Inline styles, CSS var hacks | Full component library, design tokens |
| Error feedback | `console.error` | Toast notifications |
| Confirm dialogs | None | Native dialog system |
| Navigation | Trapped in plugin slot | Link to issues, projects, agents |
| Routing | `/plugins/:uuid` | `/chat`, `/chat/:threadId` |
| Breadcrumbs | None | "Chat > Thread Name" |
| Markdown rendering | Custom inline renderer | Host's `MarkdownBlock` |
| User identity | UUID only, "U" avatar | Full user profile, avatar |
| State persistence | Plugin key-value store | Dedicated DB tables, indexed queries |
| Thread sharing | No deep links | Shareable URLs |
| Agent provisioning | Manual, pre-existing agent required | Programmatic creation |
| Agent selection | Hardcoded name match ("Chat Assistant") | Direct adapter API, no agent needed |
| Agent configuration | No access to instructions/config | Full control over system prompt, tools |
| Model selection | Dead feature — no model discovery API | Direct model picker per-thread |
| Conversation vs task | Agent sessions (task-oriented) | Lightweight chat API |
| Page chrome | Host-controlled breadcrumbs + back button | Full layout control |
| Keyboard shortcuts | Limited to textarea | Global shortcut registration |

---

## What Would Need to Change to Keep Chat as a Plugin

Ordered by impact on the plugin's featureset:

### Unblocks real-time streaming
1. **Implement `usePluginStream()` in bridge.ts** — the SSE backend is complete, the frontend hook is missing. Without this, the plugin polls every 1.5s instead of streaming token-by-token.

### Unblocks native look-and-feel
2. **Implement bridge UI components** — replace stubs with real `MarkdownBlock`, `Spinner`, `DataTable`. Without this, every plugin rebuilds basic UI from scratch with inline styles.
3. **Add `useToast()` and `useDialog()` to the bridge** — without this, plugins have no way to show error feedback or confirmation prompts.
4. **Expose user display info** in `useHostContext()` (name, email, avatar URL) — without this, chat can't show real user identity.
5. **Expose design tokens** — document which CSS custom properties plugins can rely on. Without this, theme integration is guesswork.
6. **Plugin page chrome control** — allow plugins to opt out of the host's breadcrumbs/back button wrapper. Without this, immersive UIs like chat waste vertical space on navigation that doesn't fit.

### Unblocks proper navigation
7. **Route by plugin key** — `PluginPage.tsx` should match by key or UUID. Without this, plugin URLs are fragile UUIDs that break on reinstall.
8. **Plugin sub-routes** — `/plugins/:id/*` with plugin-controlled routing. Without this, no deep linking, no shareable thread URLs, no browser back/forward.

### Unblocks direct LLM access (changes the plugin security model)
9. **Direct adapter/chat API** — `ctx.chat.stream(adapter, model, messages)` bypassing agent sessions. Without this, all LLM access is mediated through task-oriented agent sessions with no control over model, system prompt, or behavior.
10. **Model discovery and passthrough** — expose available models per adapter and accept a model parameter on `sessions.sendMessage()`. Without this, the model selector is dead code.
11. **Agent creation API** — `ctx.agents.create()` so plugins can provision their own agents. Without this, plugins depend on manually pre-configured agents.
12. **Process execution API** — `ctx.exec()` for controlled CLI access. Without this, plugins can't use external LLM tools (Claude CLI, Codex, OpenCode).

Items 9-12 fundamentally change the plugin security model. They're not incremental fixes — they require design decisions about sandboxing, resource limits, and trust boundaries.

---

## Recommendation

Chat is a primary user interaction surface. The plugin system is designed for **extensions** — third-party integrations, custom dashboards, workflow automations. Chat needs:

- Direct LLM access with model selection and streaming
- Full design system integration
- First-class routing and navigation
- The ability to reference and link to entities across the app
- User identity for personalization

**Build chat as a core page.** The plugin implementation proved the UX works and validated the interaction model. Port the patterns (thread CRUD, slash commands, streaming, sidebar) into a core `Chat.tsx` page with full host access.

**Keep the plugin system for what it's good at:** Linear sync, Slack notifications, custom metric dashboards, third-party tool integrations — features that are additive and don't need deep host coupling.

---

## What the Plugin Experiment Validated

Not all the work is throwaway. These patterns transfer directly to a core implementation:

- Thread CRUD model (create, list, rename, delete, archive)
- Slash command system with keyboard navigation
- Message streaming and incremental rendering
- Welcome screen → thread → message flow
- Collapsible sidebar with thread search
- Auto-resize textarea input
- Error segment rendering in message streams
- Issue reference linking in messages (`#123` → issue link)

The plugin version is a working prototype. The core version inherits the UX and loses the workarounds.
