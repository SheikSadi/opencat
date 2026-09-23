# OpenCat: Real-Time Slack Streaming, Live Status & Interactive Approvals Plan

## 1. Problem Overview & Root Cause Analysis

### What Happened
When a user asked *"What's up?"* in Slack during an ongoing task (e.g., provisioning infrastructure with Terraform):
1. **Context Continuation Bias:** OpenCode received the greeting in the active session context where a Terraform plan was pending, interpreting the message as a prompt to proceed (*"Terraform plan generated 10 resources... Applying now"*).
2. **Silent Permission Auto-Approval:** OpenCat auto-approved the `bash` permission for `terraform apply -auto-approve` immediately without user confirmation.
3. **Blocking Execution Loop:** `opencodeService.prompt()` is a synchronous call that blocks until all tool executions and LLM generation finish. Slack showed only an `:eyes:` reaction for several minutes with no status updates or replies until the command completed.

---

## 2. Core Architecture & Enhancements

```
┌─────────────────┐       Socket Mode / Events       ┌────────────────────────┐
│   Slack User    │ ◄──────────────────────────────► │  OpenCat Bridge (Node) │
│ (Mobile/Laptop) │                                  │ (src/index.ts & SSE)   │
└─────────────────┘                                  └───────────┬────────────┘
                                                                 │
                                                   REST + SSE    │ (port 4096)
                                                                 ▼
                                                     ┌────────────────────────┐
                                                     │ OpenCode Server / Agent│
                                                     │ (opencode serve)       │
                                                     └────────────────────────┘
```

---

## 3. Implementation Modules

### Module 1: Live Event Streaming & Progress in Slack
- **Listen to OpenCode SSE Events (`event.subscribe()`):**
  - Track `message.part.updated` where `part.type === "tool"` (`running`, `completed`, `error`).
  - Track `session.status` (`busy` / `idle`).
- **Real-Time Slack Updates:**
  - Post an initial status card in the thread when an instruction begins.
  - Update the status message in-place via `chat.update` as tools execute:
    - `⚙️ Running: terraform apply -auto-approve...`
    - `✅ Completed: terraform apply (took 34s)`
  - Provide live visibility so the user is never left in the dark during long-running commands.

### Module 2: Session Activity & Status Intercept
- **Instant Status Queries:**
  - Detect status queries (e.g., `"status"`, `"what's up"`, `"progress"`, `"what are you doing?"`) while the agent is busy.
  - Immediately query the session's active tool/step and reply with the current execution status without triggering unintended prompt execution.
- **Session Control Commands:**
  - `stop` / `abort` / `cancel`: Calls `client.session.abort({ path: { id: sessionId } })` to immediately halt running tasks.
  - `status`: Displays current session state, active tool, and recent activity.
  - `todos`: Displays current task list (`client.session.todo`).

### Module 3: Interactive Slack Approvals (Safe Mode)
- **Configurable Permission Modes:**
  - `auto`: Auto-approve all permissions (default for non-interactive automation).
  - `interactive`: Send Block Kit approval card to Slack with **Approve** and **Deny** buttons.
  - `read-only`: Auto-approve read/search tools, require Slack tap for bash commands / file edits.
- **Block Kit Interaction Handling:**
  - Listen for Slack block actions (`approve_permission`, `deny_permission`).
  - Submit response to `client.postSessionIdPermissionsPermissionId`.

### Module 4: Prompt Context & System Prompt Framing
- **Instruction Guardrails:**
  - Prefix remote Slack instructions with clear role metadata.
  - Instruct the model to distinguish casual check-ins from execution commands, preventing unintended continuation of high-risk actions.

---

## 4. Step-by-Step Execution Plan

1. **Step 1: OpenCode Event Stream & State Tracker (`src/opencode.ts`)**
   - Implement `SessionEventTracker` using `client.event.subscribe()`.
   - Track active tools, running commands, and session busy states per `sessionID`.

2. **Step 2: Slack Live Status Messenger (`src/slack-status.ts`)**
   - Create helper for creating and updating thread status messages with debounce.
   - Render tool execution states cleanly with emojis and execution duration.

3. **Step 3: Intent & Status Interceptor (`src/index.ts`)**
   - Intercept status questions and `stop`/`abort` commands before dispatching to `client.session.prompt`.
   - Provide instant status replies when the session is busy.

4. **Step 4: Interactive Permission Approvals (`src/permissions.ts`)**
   - Support Slack interactive buttons for permission requests when enabled.
   - Add permission mode configuration in `src/config.ts`.

5. **Step 5: Testing & Verification**
   - Verify event streaming with mock/live OpenCode server.
   - Test command cancellation (`stop`/`abort`).
   - Run type check (`tsc --noEmit`) and build (`npm run build`).

---

## 5. Configuration Options (`~/.opencat/config.json` or `.env`)

| Key | Default | Description |
| :--- | :--- | :--- |
| `PERMISSION_MODE` | `auto` | `auto`, `interactive`, or `read-only` |
| `LIVE_PROGRESS` | `true` | Stream tool execution updates to Slack thread |
| `PORT` | `4096` | OpenCode server port |
| `OPENCODE_WORKING_DIR`| Current Dir | Base workspace directory |
