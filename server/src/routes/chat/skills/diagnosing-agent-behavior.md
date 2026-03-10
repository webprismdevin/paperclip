## Skill: Diagnosing Agent Behavior

Investigate why an agent or the chat copilot behaved incorrectly, find the instruction gap, and fix it.

### When to trigger

- User reports an agent didn't do something it should have (missed assignment, failed delegation, wrong status)
- User says "why didn't it...", "agent failed to...", "what went wrong with..."
- User references a thread or issue where behavior was unexpected
- User asks to investigate a run, check a thread, or diagnose a workflow problem
- **Self-correction:** The user corrects YOUR behavior in the current conversation (e.g., "you should have done X", "why didn't you do Y", "that's not what I asked for"). This means your own instructions have a gap — diagnose and fix it the same way you would for any other agent

### Step 1: Pull the evidence

Get the thread or activity that shows the problem:

```bash
# Chat copilot thread — fetch messages via API
curl -s "$PAPERCLIP_API_URL/api/chat/threads/<THREAD_ID>/messages" \
  -H "Origin: $PAPERCLIP_API_URL" \
  ${PAPERCLIP_SESSION_COOKIE:+-H "Cookie: $PAPERCLIP_SESSION_COOKIE"}

# Agent activity on an issue
curl -s "$PAPERCLIP_API_URL/api/issues/<ID>/comments" \
  -H "Origin: $PAPERCLIP_API_URL" \
  ${PAPERCLIP_SESSION_COOKIE:+-H "Cookie: $PAPERCLIP_SESSION_COOKIE"}
```

### Step 2: Build a timeline

Walk through the conversation/activity chronologically. For each step, note:
- What the agent **did**
- What it **should have done**
- The exact moment the mistake happened

### Step 3: Find the instruction source

| Problem origin | Where to look |
|---------------|---------------|
| Chat copilot | `server/src/routes/chat/system-prompt.md` and `server/src/routes/chat/skills/*.md` |
| Autonomous agent | Agent's instruction files: `AGENTS.md`, `HEARTBEAT.md`, `SOUL.md`, `TOOLS.md` |

To find agent instruction files:
```bash
curl -s "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/agents" \
  -H "Origin: $PAPERCLIP_API_URL" \
  ${PAPERCLIP_SESSION_COOKIE:+-H "Cookie: $PAPERCLIP_SESSION_COOKIE"} | jq '.[] | {name, urlKey, adapterConfig}'
```

Check `adapterConfig.cwd` for the workspace path. If null, try the default Paperclip data directory:
`$PAPERCLIP_HOME/instances/default/workspaces/*/agents/{urlKey}/`

### Step 4: Diagnose the gap

Common root causes:
- **No instructions at all** — agent has no instruction files
- **Missing rule** — instructions exist but don't cover this scenario
- **Ambiguous rule** — instructions say something but not clearly enough
- **Wrong default** — agent does something reasonable but not what we want

### Step 5: Fix it

**Chat copilot** (system prompt, skills): Fix directly — these are code files we control.

**Agent instructions** (AGENTS.md, HEARTBEAT.md, SOUL.md, TOOLS.md): Show the user what you'll change and **wait for explicit approval** before writing.

### Step 6: Summarize

After fixing, briefly state:
- **What went wrong** — one sentence
- **Root cause** — which file was missing what
- **What was fixed** — the specific addition/change

### Self-correction (when YOU are the problem)

When the user corrects your behavior in the current conversation, you already have the evidence — it's the conversation itself. Don't pull from the DB, just:

1. **Acknowledge the mistake** briefly (one sentence, no over-apologizing)
2. **Do the right thing immediately** — take the action the user wanted
3. **Identify which instruction file caused the gap** — check `system-prompt.md` and `skills/*.md`
4. **Fix it** so the same mistake doesn't happen again

Example: User says "you should have created a task for @Noah, not searched the codebase yourself" → create the task immediately, then check the handoff skill to see why you didn't delegate.

### Critical rules

- **Always pull real evidence first.** Don't guess from the user's description alone.
- **Don't ask "want me to fix it?"** — diagnose and either fix (copilot) or propose the specific change (agent instructions).
- **Keep fixes minimal.** Add only what's needed to prevent this specific failure.
- **If agent has no instruction files at all**, create them with just the relevant rules — don't over-engineer a full persona.
