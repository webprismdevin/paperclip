## Skill: Agent Handoff

When the user @-mentions an agent with a work request, you should **hand off** the work by creating Paperclip task(s) assigned to that agent.

### When to trigger

- User says `@AgentName do something` — hand off work to that agent
- User says `@AgentName` with a question (e.g., "what's your status?") — query the agent's tasks instead, don't create new tasks
- User uses `/handoff` — explicitly wants to assign work to an agent

### Step 1: Decide whether to confirm or just do it

**Skip confirmation when the user's intent is clear:**
- User explicitly tells you to create a task: "create a task for @AgentName to investigate X" → just create it
- User corrects you and says what should have happened: "you should have had @AgentName do X" → just create it
- User gives a direct instruction with an @-mention and a clear action → just create it

**Propose structure only when the request is ambiguous or complex:**
- User gives a vague or multi-part request: "build out the onboarding flow" → propose options
- It's unclear whether this should be one task or many → ask

**For simple, single-action requests** where you do confirm:
> I'll create a single task for **AgentName**:
> - **"Task title"** — brief description
>
> Want me to go ahead, or would you like to adjust anything?

**For complex, multi-step requests:**
> This looks like it could be broken down. Two options:
>
> **Option A — Single task:** One issue with all the details in the description.
> **Option B — Parent + sub-tasks:** A parent issue with focused sub-tasks.
>
> Which approach do you prefer?

### Step 2: Create the issues

Use `POST /api/companies/{companyId}/issues` with:
- `title`: A concise summary of the work
- `description`: Full, self-contained context (see rules below)
- `assigneeAgentId`: The agent's ID (from the `[Mentioned agents]` block)
- `priority`: Infer from context — default to `medium`
- `status`: `todo`
- `parentId`: The parent issue's ID (only for sub-tasks, after creating the parent first)

**For parent + sub-tasks:** Create the parent issue first, then create each sub-task with `parentId` set to the parent's ID.

### Step 3: Confirm the handoff

Respond with a summary showing what was created:
> Handed off to **AgentName**:
> - **PRJ-12** "Parent task title" (parent)
>   - **PRJ-13** "Sub-task 1"
>   - **PRJ-14** "Sub-task 2"

Use the actual identifiers returned by the API.

### Critical rules

- **Match the user's urgency.** If they clearly stated what to create, create it. Only propose structure when the request is ambiguous or complex.
- **Never retry failed API calls.** If an issue creation fails, report the error. Do not re-attempt — it may have partially succeeded.
- **Never reference file paths or documents in descriptions.** The agent cannot read your files. Inline all relevant content directly.
- **Make descriptions self-contained.** The agent has NO access to this chat, your files, or documents you created during conversation. Include everything the agent needs: all requirements, context, strategies, and acceptance criteria.
- **Each sub-task should be independently actionable.** The agent should be able to pick up any sub-task and know what to do without reading the parent.
- **Put ALL content in the `description` field.** Do not create the issue and then add a comment with the details. The `description` field is where the full plan, context, and requirements belong. Comments are for follow-ups, not the initial brief.
- **Stop after confirming the handoff.** Once you've created the issues and confirmed them to the user, you are DONE. Do not continue working on the problem yourself, do not elaborate further, do not offer next steps. The whole point of a handoff is that the agent takes it from here.

### Example: Parent + sub-tasks

```bash
# 1. Create parent issue
curl -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues" \
  -H "Origin: $PAPERCLIP_API_URL" \
  ${PAPERCLIP_SESSION_COOKIE:+-H "Cookie: $PAPERCLIP_SESSION_COOKIE"} \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Build user onboarding flow",
    "description": "Design and implement a multi-step onboarding flow for new users.\n\n## Requirements\n- Welcome screen with value prop\n- Account setup (name, avatar, preferences)\n- Team invitation step\n- First project creation wizard\n\n## Acceptance criteria\n- Users complete onboarding in under 2 minutes\n- Each step is skippable\n- Progress is saved if user leaves mid-flow",
    "assigneeAgentId": "agent-id-here",
    "priority": "medium",
    "status": "todo"
  }'
# Response: { "id": "parent-uuid", "identifier": "PRJ-12", ... }

# 2. Create sub-tasks with parentId
curl -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues" \
  -H "Origin: $PAPERCLIP_API_URL" \
  ${PAPERCLIP_SESSION_COOKIE:+-H "Cookie: $PAPERCLIP_SESSION_COOKIE"} \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Design onboarding UI mockups",
    "description": "Create wireframes and high-fidelity mockups for each onboarding step...",
    "assigneeAgentId": "agent-id-here",
    "parentId": "parent-uuid",
    "priority": "medium",
    "status": "todo"
  }'
```

### Multiple agents

If the user mentions multiple agents, create separate tasks for each unless the work is clearly collaborative — in that case, create one task and mention the others in the description.

### Don't do agent work yourself

You are a copilot, not an agent. When the user asks for something that requires codebase investigation, research, or sustained work, **delegate it to an agent** rather than attempting it yourself.

Signs you should delegate instead of doing it yourself:
- The work requires searching a codebase, checking dashboards, or reading external systems
- The user mentions a specific agent by name or role
- The task would take multiple tool calls and sustained effort
- You don't have direct access to the systems involved (e.g., admin dashboards, external services)

**Wrong:** User says "kick off a sprint for feature X" → you start searching the codebase yourself
**Right:** User says "kick off a sprint for feature X" → you delegate research to the appropriate agent, then help plan once results are back

### Context from conversation

When creating task descriptions, include relevant context from the current conversation. The agent picking up the task won't have access to this chat, so descriptions must be completely self-contained. If you discussed plans, strategies, or requirements during the conversation, copy the relevant content directly into the description.
