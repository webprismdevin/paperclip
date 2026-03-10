   # Chat Should Be a Core Feature, Not a Plugin

## Summary

After building a production chat plugin for Paperclip using the plugin SDK, we've identified fundamental limitations that prevent delivering a quality chat experience through the plugin system. Chat requires tight integration with the host's streaming infrastructure, design system, navigation, and LLM APIs — all of which the plugin sandbox deliberately restricts.

This document outlines what's broken, what's impossible, and what would need to change in the plugin system to make chat viable as a plugin. Our recommendation: integrate chat as a first-class core page.

---

## What We Built

A multi-adapter chat plugin (`paperclip-chat`) using `definePlugin()` with:

- Thread CRUD via `ctx.state.set/get` (key-value storage)
- LLM communication via `ctx.agents.sessions.create/sendMessage`
- UI via plugin page slot with `usePluginData` / `usePluginAction` bridge hooks
- Adapter discovery via `ctx.agents.list()`, deduplicated by adapter type

## What's Broken

### 1. SSE Streaming: Backend Done, Frontend Bridge Missing

Issue [#440](https://github.com/paperclipai/paperclip/issues/440) spec'd a full SSE bridge for worker-to-UI streaming. The **backend is 100% implemented**:

- SSE route: `GET /api/plugins/:pluginId/bridge/stream/:channel` — fully functional
- Stream bus: in-memory pub/sub (`createPluginStreamBus()`) with subscribe/publish — fully functional
- Worker RPC: `ctx.streams.open/emit/close` sends JSON-RPC notifications to host — fully functional
- Worker manager: forwards stream notifications to the bus, handles crash cleanup — fully functional

**What's missing is ~60 lines of frontend code:**

- `usePluginStream()` has no concrete implementation in `ui/src/plugins/bridge.ts` (the hook is declared in the SDK but the bridge runtime doesn't provide it)
- `usePluginStream` is not registered in the `sdkUi` object in `ui/src/plugins/bridge-init.ts`
- No API client helper to open EventSource connections

This is a small fix — implement the hook using `EventSource` pointing at the existing SSE endpoint, register it in the bridge init. The backend is ready.

**Impact today:** We poll every 1.5 seconds for new messages. Users see choppy, delayed text instead of token-by-token streaming.

### 2. All LLM Access Goes Through Agent Sessions

The plugin SDK only exposes `ctx.agents.sessions.*` for LLM communication. There is no direct adapter/chat API. This means:

- Every chat message creates or resumes an **agent session**, which is designed for task execution, not conversational chat
- We had to create a dedicated "Chat Assistant" agent just to be a pass-through LLM conduit
- The agent's `agents.md` system prompt overrides what should be a clean chat experience
- No way to let users select models, adjust temperature, or configure system prompts per-thread
- No streaming token delivery — `onEvent` callbacks fire in the worker but can't push to the UI in real-time

**What users actually want:** Direct adapter access — pick a model, send a message, stream the response. The agent session abstraction adds indirection that doesn't serve the chat use case.

### 3. Plugin UI Is Sandboxed From the Design System

Plugin UI bundles run in an isolated ESM module scope. The bridge provides stub components that render placeholder `<div>` elements with dashed borders:

```
MetricCard → [MetricCard]
StatusBadge → [StatusBadge]
MarkdownBlock → [MarkdownBlock]
Spinner → [Spinner]
```

**Impact:** The chat plugin can't use any host UI components. We wrote everything with inline styles — no design tokens, no theme support, no consistency with the rest of the app. The original Chat.tsx (1938 lines) used Tailwind, lucide-react icons, Markdown rendering, and the host's toast/dialog systems. The plugin version is a stripped-down approximation.

### 4. No Toast, Dialog, or Navigation APIs

Plugins can't access:

| API | What it enables | Plugin access |
|-----|----------------|---------------|
| `useToast()` | "Message sent", "Error: rate limited" | None |
| `useDialog()` | Confirm delete thread, settings modal | None |
| `useRouter()` | Navigate to referenced issues/projects | None |
| `useBreadcrumbs()` | Show "Chat > Thread Name" | None |
| `useSidebar()` | Collapse sidebar for full-width chat | None |

**Impact:** No user feedback on errors, no confirmation dialogs, no ability to link chat mentions to actual Paperclip entities.

### 5. Plugin Routing Is UUID-Only

Plugin pages route to `/:companyPrefix/plugins/:pluginId` where `pluginId` is a UUID. The manifest declares `target: "plugins/paperclip-chat"` (by key), but `PluginPage.tsx` only matches by UUID.

**Workaround:** We manually updated the DB manifest to use the UUID in the launcher target. This is fragile — reinstalling the plugin would break navigation.

**What's needed:** Route matching by plugin key, or a dedicated `/chat` route.

### 6. No Sub-Routes or Deep Linking

A chat page needs URLs like `/chat/thread/:threadId` so users can share links to conversations, bookmark threads, or navigate back. The plugin system provides a single page slot with no sub-routing.

**Impact:** All thread state is component-local. Refreshing the page loses the selected thread. No shareable URLs.

---

## What a First-Class Chat Page Gets

| Capability | Plugin Chat | Core Chat Page |
|-----------|-------------|----------------|
| Token streaming | 1.5s polling (bridge hook missing ~60 LOC fix) | Native SSE, token-by-token |
| LLM access | Agent sessions only | Direct adapter API with model selection |
| Design system | Inline styles, no theme | Full component library, design tokens |
| Error feedback | `console.error` | Toast notifications |
| Confirm dialogs | None | Native dialog system |
| Navigation | Trapped in plugin slot | Link to issues, projects, agents |
| Routing | `/plugins/:uuid` | `/chat`, `/chat/:threadId` |
| Breadcrumbs | None | "Chat > Thread Name" |
| Slash commands | Must reimplement from scratch | Can call host APIs directly |
| Markdown rendering | Must bundle own renderer | Host's `MarkdownBlock` component |
| Keyboard shortcuts | Limited to textarea | Global shortcut registration |
| State persistence | Plugin key-value store | Dedicated DB tables, proper queries |
| Thread sharing | No deep links | `/chat/thread/:id` URLs |

---

## What Would Need to Change to Make Plugin Chat Viable

If the goal is to keep chat as a plugin, these platform changes are required:

**Small fixes (< 1 day each):**

1. **Implement `usePluginStream()` in the UI bridge** — ~60 lines. The backend SSE infrastructure is complete ([#440](https://github.com/paperclipai/paperclip/issues/440)). Just needs the concrete React hook in `bridge.ts` and registration in `bridge-init.ts`.
2. **Route by plugin key** — `PluginPage.tsx` should match by key or UUID, not UUID only.

**Medium effort:**

3. **Implement bridge UI components** — replace stubs with real `MarkdownBlock`, `Spinner`, `DataTable`, etc. These are registered as placeholders today.
4. **Add `useToast()` and `useDialog()` to the bridge** — basic feedback and confirmation.
5. **Expose design tokens** — CSS custom properties or theme context through the bridge.

**Larger scope:**

6. **Support plugin sub-routes** — `/plugins/:id/*` with plugin-controlled routing.
7. **Add direct adapter/chat API to plugin SDK** — `ctx.chat.stream(adapterType, model, messages)` that bypasses agent sessions. This is the biggest gap — the agent session abstraction doesn't fit conversational chat.

---

## Recommendation

Chat is a core user interaction surface, not an optional extension. It needs:

- Tight integration with the adapter/LLM layer for streaming
- First-class routing and navigation
- Full access to the design system
- The ability to trigger workflows, reference entities, and navigate the app

Build it as a core page. The original `Chat.tsx` implementation (pre-plugin) had all of this working. The plugin system is the right home for third-party integrations (Linear sync, Slack notifications, custom dashboards) — not for primary user-facing features that need deep host integration.

---

## Platform Issues to Track

Regardless of where chat lives, these plugin system gaps should be addressed for other plugin developers:

- [ ] `usePluginStream()` — backend SSE bridge is complete, frontend hook missing (~60 LOC). See [#440](https://github.com/paperclipai/paperclip/issues/440).
- [ ] Bridge UI components are non-functional stubs (render `[ComponentName]` placeholders)
- [ ] Plugin page routing only matches by UUID, not plugin key
- [ ] No sub-route support for plugin pages
- [ ] No toast/dialog/navigation APIs in the bridge
