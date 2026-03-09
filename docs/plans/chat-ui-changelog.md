# Chat UI — Change Summary

**Branch:** `add-chat-ui` on `webprismdevin/paperclip`
**Base:** `master` on `paperclipai/paperclip`
**Files changed:** 15 (+2,761 lines)

---

## What this adds

A built-in conversational chat interface for Paperclip — lets users interact with their workspace through natural language. Think of it as a copilot that can query issues, delegate work to agents, check dashboards, and manage tasks, all from a chat window.

---

## Features

### Core chat
- Streaming AI responses via SSE with real-time text, thinking indicators, and tool-use activity
- Persistent threads stored in PostgreSQL (`chat_threads`, `chat_messages` tables)
- Background thread continuation — navigate away and come back to a running thread
- Thread polling with toast notifications when background threads complete
- Model switcher (Sonnet 4.5, Opus 4.6, Haiku 4.5)

### Input
- Slash commands (`/tasks`, `/status`, `/budget`, etc.) with autocomplete menu
- `@agent` mentions with autocomplete — triggers agent handoff skill
- `#issue` references with autocomplete — enriches messages with issue context
- Issue references render as clickable links in messages (both user and assistant)
- Custom slash command creation and persistence (localStorage)
- Quick-start trigger chips that populate the input

### Sidebar
- Thread list in a push sidebar (not overlay) with open/close toggle
- Recent threads shown on empty state
- Thread renaming (double-click) and deletion with confirmation
- Sidebar stays open during navigation between threads

### Chat copilot skills
- **Handoff** — `@Agent do X` creates properly structured tasks with full context
- **Agent Instructions** — view and edit agent instruction files (AGENTS.md, SOUL.md, etc.)
- **Diagnosing Agent Behavior** — investigate and fix agent workflow failures

### System prompt
- Task Readiness Checklist — verifies agent assignment, project, and status before claiming a task is ready
- Full API reference for Paperclip endpoints
- Issue lifecycle documentation
- Comment style guidelines

---

## Architecture

### Server (`server/src/routes/chat.ts`)
- Express router mounted at `/api/chat`
- Endpoints: CRUD for threads, messages, SSE streaming, slash commands
- Spawns `claude` CLI as child process with system prompt + skills
- Streams stdout as SSE events, parses JSON blocks for tool use and thinking
- Loads all skill `.md` files from `server/src/routes/chat/skills/` automatically

### Database (`packages/db/src/migrations/0026_chat_tables.sql`)
- `chat_threads` — id, company_id, title, session_id, status, timestamps
- `chat_messages` — id, thread_id, role, content, metadata (JSONB for segments)
- Conditional migration: renames from `plugin_chat_ui_*` tables if they exist (smooth upgrade for existing installs), otherwise creates fresh

### UI (`ui/src/pages/Chat.tsx`)
- Single-file React component (~1,800 lines)
- Uses React Query for data fetching/caching
- Scoped CSS animations and styles via inline `<style>` block
- Responsive: mobile-optimized with touch-friendly sizing

### Integration points
- `server/src/app.ts` — mounts chat routes and plugin loader
- `ui/src/App.tsx` — adds `/chat` and `/chat/*` routes
- `ui/src/components/Sidebar.tsx` — adds Chat nav item
- `ui/src/components/Layout.tsx` — removes padding/scroll for chat pages
- `ui/src/lib/company-routes.ts` — registers `chat` as a board route
- `ui/src/index.css` — full-height viewport fixes for mobile

### Plugin loader (`server/src/plugin-loader.ts`)
- Generic plugin system for future extensibility
- Scans `plugins/` directory for packages with server entry points
- Mounts plugin routes under `/api/plugins/{name}`

---

## How to test

1. Run migrations: `pnpm --filter @paperclipai/db migrate`
2. Start the server (dev or production)
3. Navigate to `/chat` in the sidebar
4. Try: "What's going on?" — should fetch dashboard and summarize
5. Try: `@AgentName write a blog post` — should trigger handoff skill
6. Try: `#ISSUE-ID` — should autocomplete and link issues
7. Open sidebar, switch threads — streaming state should not bleed between threads
