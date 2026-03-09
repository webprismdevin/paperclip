## Skill: Agent Handoff

When the user @-mentions an agent with a work request, you should **hand off** the work by creating Paperclip task(s) assigned to that agent.

### When to trigger

- User says `@AgentName do something` — hand off work to that agent
- User says `@AgentName` with a question (e.g., "what's your status?") — query the agent's tasks instead, don't create new tasks
- User uses `/handoff` — explicitly wants to assign work to an agent

### Step 1: Propose the handoff structure

Before creating any issues, **always ask the user** how they want to structure the handoff. Present options based on the complexity of the work:

**For simple, single-action requests** (e.g., "write a blog post", "fix the login bug"):
> I'll create a single task for **AgentName**:
> - **"Task title"** — brief description
>
> Want me to go ahead, or would you like to adjust anything?

**For complex, multi-step requests** (e.g., "launch a newsletter", "build a feature"):
> This looks like it could be broken down. Two options:
>
> **Option A — Single task:** One issue with all the details in the description.
> - "Launch Shopify Newsletter" — all requirements in one task
>
> **Option B — Parent + sub-tasks:** A parent issue with focused sub-tasks the agent can work through.
> - **Parent:** "Launch Shopify Newsletter"
>   - Sub: "Research competitor newsletters and positioning"
>   - Sub: "Set up email platform and landing page"
>   - Sub: "Write first 3 newsletter editions"
>   - Sub: "Launch and promote to initial audience"
>
> Which approach do you prefer?

Wait for the user to confirm before creating anything.

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

Respond with a summary:
> Handed off to **CEO**:
> - **TES-8** "Launch Shopify Newsletter" (parent)
>   - **TES-9** "Research competitor newsletters"
>   - **TES-10** "Set up email platform and landing page"
>   - **TES-11** "Write first 3 editions"
>   - **TES-12** "Launch and promote"

### Critical rules

- **Always propose the structure first.** Never create issues without user confirmation.
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
    "title": "Launch Shopify Newsletter",
    "description": "Launch and grow a Shopify developer newsletter focused on AI-powered app development.\n\n## Goal\nReach $10k/mo revenue within 6 months through sponsorships and premium content.\n\n## Strategy\n- Target technical Shopify developers building with AI\n- Weekly format, mix of tutorials and industry analysis\n- Monetize via sponsorships after reaching 5k subscribers",
    "assigneeAgentId": "ceo-agent-id",
    "priority": "medium",
    "status": "todo"
  }'
# Response: { "id": "parent-uuid", "identifier": "TES-8", ... }

# 2. Create sub-tasks with parentId
curl -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues" \
  -H "Origin: $PAPERCLIP_API_URL" \
  ${PAPERCLIP_SESSION_COOKIE:+-H "Cookie: $PAPERCLIP_SESSION_COOKIE"} \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Research competitor newsletters and positioning",
    "description": "Analyze the top 5 Shopify developer newsletters...",
    "assigneeAgentId": "ceo-agent-id",
    "parentId": "parent-uuid",
    "priority": "medium",
    "status": "todo"
  }'
```

### Multiple agents

If the user mentions multiple agents, create separate tasks for each unless the work is clearly collaborative — in that case, create one task and mention the others in the description.

### Context from conversation

When creating task descriptions, include relevant context from the current conversation. The agent picking up the task won't have access to this chat, so descriptions must be completely self-contained. If you discussed plans, strategies, or requirements during the conversation, copy the relevant content directly into the description.
