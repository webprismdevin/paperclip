# Chat Plugin Testing Guide

**Branch:** `plugin/chat-ui`
**Plugin:** `@paperclipai/plugin-chat`

---

## Prerequisites

1. A running Paperclip instance (Docker or local)
2. A company/workspace created
3. At least one agent with `adapterType: "claude_local"` — the plugin looks for this to route messages. The plugin will prefer an agent named **"Chat Assistant"**, then fall back to any agent with role `"general"`, then fall back to the first match.

**Important:** The plugin cannot create agents. If no compatible agent exists, sending a message will fail with "No agent found with adapter type claude_local."

---

## Setup

### Install the plugin

The chat plugin is part of the monorepo at `packages/plugins/plugin-chat/`. It's registered via the plugin manager in the Paperclip settings UI.

1. Navigate to **Settings > Plugins** in the Paperclip UI
2. If the Chat plugin isn't listed, install it using the **+ Install Plugin** button (package name: `@paperclipai/plugin-chat`)
3. Verify the plugin shows status **ready** in the Plugin Manager

### Build (development)

```bash
cd packages/plugins/plugin-chat
npm run build
```

This produces:
- `dist/worker.js` — plugin worker (runs server-side)
- `dist/ui/index.js` — plugin UI bundle (served to browser)

### Docker deployment

If running in Docker, the built UI bundle needs to be copied into the container:

```bash
docker cp packages/plugins/plugin-chat/dist/ui/index.js paperclip-plugin-chat-server-1:/app/packages/plugins/plugin-chat/dist/ui/index.js
```

The server caches UI bundles with ETags — hard refresh the browser after deploying.

---

## What to Test

### Welcome Screen

- [ ] Plugin loads at `/:companyPrefix/plugins/:pluginId`
- [ ] Welcome screen shows "What can I help with?" with chat icon
- [ ] Input field with "Ask Paperclip anything..." placeholder
- [ ] Send button (paper plane icon) disabled when input is empty
- [ ] Quick action chips: "Check in on issues", "Review goal progress", "Plan an initiative", "Agent status"
- [ ] Recent threads section shows up to 3 recent threads with timestamps
- [ ] "View all" link appears when >3 threads exist
- [ ] Clicking a recent thread opens it

### Sending Messages

- [ ] Typing a message and pressing Enter (or clicking send) creates a thread and sends the message
- [ ] User message appears in the chat within ~300ms (early refresh)
- [ ] "Thinking..." indicator shows while waiting for agent response
- [ ] Agent response streams in (token by token if SSE is wired, or via polling)
- [ ] Response renders markdown: headings, bold, tables, code blocks, lists, links
- [ ] Tool usage shows as collapsible "Used N tools" with expand/collapse

### Quick Actions

- [ ] Clicking a quick action chip creates a thread and sends the associated prompt
- [ ] User message appears promptly (not after agent completes)
- [ ] Thread appears in sidebar with auto-generated title

### Slash Commands

- [ ] Typing `/` in the input shows the command menu
- [ ] Arrow keys navigate the menu, Enter/Tab selects
- [ ] Escape dismisses the menu
- [ ] Available commands: `/tasks`, `/dashboard`, `/agents`, `/create`, `/projects`, `/costs`, `/activity`, `/blocked`, `/plan`, `/handoff`

### Thread Management

- [ ] "+ New Chat" button in sidebar returns to the welcome screen
- [ ] Selecting a thread in the sidebar loads its messages
- [ ] Double-clicking a thread title enables inline rename
- [ ] Clicking the "x" button on a thread shows "Delete?" confirmation (3s timeout)
- [ ] Clicking "Delete?" again permanently deletes the thread

### Sidebar

- [ ] Sidebar toggle button (panel icon, top-left of content area) shows/hides the sidebar
- [ ] Thread list shows chat icon, truncated title, and absolute timestamp (e.g., "10:28 AM")
- [ ] Running threads show a green pulsing dot

### Streaming

- [ ] During agent execution, the streaming message shows tool activity
- [ ] Text streams in with a blinking cursor
- [ ] Stop button appears during streaming, clicking it stops the agent run
- [ ] After completion, the full response is persisted and visible on page refresh

### Follow-up Messages

- [ ] Sending a follow-up in an existing thread works
- [ ] The agent receives conversation history (session is resumed, not recreated)

### Adapter/Model Display

- [ ] Below the input, the adapter label shows (e.g., "Claude")
- [ ] If multiple adapter types exist among agents, a dropdown appears
- [ ] "Shift+Enter for new line" hint shows on the right
- [ ] Note: Model selection is non-functional — see plugin-vs-core-chat.md for details

---

## Known Limitations

These are documented in detail in `docs/specs/plugin-vs-core-chat.md`:

- **No direct LLM access** — all messages go through agent sessions. A compatible agent must exist.
- **No model selection** — the model is determined by the agent's adapter config, not the plugin.
- **No agent creation** — the plugin can't provision its own agents.
- **Polling fallback** — `usePluginStream()` SSE hook is not yet implemented in the host bridge. Streaming works via early refresh + polling, not true SSE.
- **No deep linking** — thread selection is component state, lost on page refresh.
- **No toast/dialog** — errors go to console only, no user-visible feedback.
- **Host page chrome** — breadcrumbs ("Plugins > Chat") and "Back" button are rendered by the host and can't be hidden.
- **User avatar** — shows a generic person icon (no user name/email available via plugin SDK).

---

## Plugin Settings

Navigate to **Settings > Plugins > Chat** (gear icon) to configure:

- **Default Adapter** — which adapter type to use for new threads (`claude_local`, `codex_local`, `opencode_local`)
- **System Prompt Override** — custom text appended to chat sessions (note: this is stored in plugin config but not yet passed through to agent sessions)

---

## Troubleshooting

### "No agent found with adapter type claude_local"
Create an agent with `adapterType: "claude_local"`. The plugin prefers one named "Chat Assistant."

### Messages not appearing after send
Hard refresh the browser — the server may be serving a cached UI bundle.

### Agent responds with generic greeting instead of answering the question
This is an agent instruction problem, not a plugin issue. Check the agent's `agents.md` for system prompt configuration.

### Follow-up messages stuck on "Thinking..."
The agent session may have failed to resume. Check server logs for errors. The thread may need to be deleted and recreated.

### UI changes not reflecting after build
If running in Docker, you need to `docker cp` the built bundle into the container. The server's dev-watcher may also restart the worker when it detects the file change, causing a brief 502.
