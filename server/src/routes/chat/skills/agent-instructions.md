## Skill: Agent Instructions Editor

View and edit agent instruction files (AGENTS.md, SOUL.md, HEARTBEAT.md, TOOLS.md).

### When to trigger

- User asks to view, read, or show an agent's instructions/prompt/soul/heartbeat
- User asks to update, edit, or change an agent's instructions/prompt/soul/heartbeat
- User says "show me the CEO's AGENTS.md" or "update the CTO's soul"

### Step 1: Find the agent and its instruction files

First, get the agent's details to find their workspace path:

```bash
curl -s "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/agents" \
  ${PAPERCLIP_SESSION_COOKIE:+-H "Cookie: $PAPERCLIP_SESSION_COOKIE"}
```

From the response, find the target agent and look at `adapterConfig.cwd` and `adapterConfig.instructionsFilePath`.

The instruction files live at:
```
{adapterConfig.cwd}/AGENTS.md
{adapterConfig.cwd}/SOUL.md
{adapterConfig.cwd}/HEARTBEAT.md
{adapterConfig.cwd}/TOOLS.md
```

If `adapterConfig.cwd` is not set, try the default location:
```
~/.paperclip/instances/default/workspaces/*/agents/{agent-slug}/
```

Where `{agent-slug}` is the agent's `urlKey` (lowercase name, e.g., "ceo", "cto").

### Step 2: Read the file

Use `cat` to read the relevant file. Display the contents to the user in a readable format.

### Step 3: Edit (requires confirmation)

**CRITICAL: Always show the user what you plan to change and get explicit confirmation before writing.**

When the user wants to edit an instruction file:

1. Read the current file contents
2. Draft the proposed changes
3. Show the user a clear diff or summary:
   > Here's what I'd change in **CEO's AGENTS.md**:
   >
   > **Adding** to the "Responsibilities" section:
   > - Monitor weekly newsletter metrics
   >
   > **Removing:**
   > - (nothing)
   >
   > Want me to apply this change?
4. **Wait for explicit confirmation** ("yes", "go ahead", "do it", etc.)
5. Only then write the file

Use the Edit tool or write the file directly — these are local files on disk.

### File descriptions

| File | Purpose | When to edit |
|------|---------|-------------|
| AGENTS.md | Core instructions and prompt — defines what the agent does, how it works, API access, responsibilities | Changing agent behavior, adding capabilities, modifying workflows |
| SOUL.md | Persona, voice, values, strategic posture — defines who the agent is | Changing personality, communication style, decision-making approach |
| HEARTBEAT.md | Per-wake execution checklist — steps the agent follows each heartbeat cycle | Changing the agent's work loop, adding/removing routine steps |
| TOOLS.md | Notes on tools the agent has learned to use | Documenting new tool usage patterns, removing outdated tool notes |

### Critical rules

- **Never edit without confirmation.** Always show what will change and wait for the user to approve.
- **Preserve existing content.** When adding to a file, don't remove existing content unless the user explicitly asks.
- **Show the current content first** if the user asks to "update" something — they may want to see what's there before deciding what to change.
- **One file at a time.** Don't batch edits across multiple files unless the user explicitly asks for it.
- **Back up context.** If making a significant change, briefly note what was there before in your response so the user has a record.
