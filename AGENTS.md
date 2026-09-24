# 🤖 OpenCat AI Agent Integration Guide (`AGENTS.md`)

Welcome! This document outlines how other AI agents, developers, and workflows can integrate with **OpenCat**, the remote Slack-to-OpenCode bridge.

---

## 🗺️ Architecture Overview

OpenCat acts as an outbound **WebSocket (Socket Mode)** bridge between your Slack workspace and your local/headless **OpenCode** execution environment.

```
┌──────────────────┐       Slack Socket Mode      ┌─────────────────────────┐
│   Slack User/AI  │ ◄──────────────────────────► │  OpenCat Bridge Daemon  │
│ (Conversations)  │                              │ (Event-driven Node app) │
└──────────────────┘                              └────────────┬────────────┘
                                                               │
                                                 REST + SSE    │ (Default Port: 4096)
                                                               ▼
                                                  ┌─────────────────────────┐
                                                  │ OpenCode Server/Agent   │
                                                  │ (opencode serve)        │
                                                  └─────────────────────────┘
```

---

## ⚙️ Control Signals & In-Chat Commands

OpenCat intercepts several special intent phrases or commands to manage the active session context before prompting the underlying OpenCode agent. AI agents interacting with Slack threads can leverage these triggers:

| Command | Action | Description |
| :--- | :--- | :--- |
| `status` / `what's up` / `progress` | **Instant Intercept** | Non-blocking query returning active running tool, elapsed time, and completed steps without advancing the execution queue. |
| `stop` / `abort` / `cancel` | **Immediate Halt** | Calls OpenCode's `abort()` API to instantly cancel long-running processes (e.g., terraform apply). |
| `todos` / `tasks` | **List Checklist** | Queries the current session's tasks and displays them to Slack. |
| `reset` / `new session` | **Session Reset** | Resets the active Slack thread-to-session mapping so the next instruction starts fresh. |
| `help` | **Display Help** | Returns a helpful commands card. |

---

## 🛡️ Interactive Permissions (Permission Modes)

OpenCat provides fine-grained control over execution permissions. These are essential for AI agents executing actions in shared spaces:

### 1. `auto` (Default)
Auto-approves all mutating operations (filesystem writes, bash commands, etc.). This is suitable for isolated sandbox automation environments.

### 2. `interactive` (Short CLI Alias: `-i`)
Pauses execution whenever a permission is requested (both inside and outside the workspace). OpenCat formats a beautiful Block Kit interactive card containing details of the action and **"Allow Once"**, **"Always Allow"**, and **"Deny"** buttons.

### 3. `read-only` (Short CLI Alias: `-r`)
Silently auto-approves all non-mutating search and read tools (`grep`, `glob`, `read`, `webfetch`). For any mutating operations (`bash`, `write`, `edit`, `delete`), it falls back to posting interactive Slack button cards.

---

## 🧱 Slack Block Kit Payload Structures

### Interactive Permission Approval Card
When a permission is triggered, OpenCat posts a Block Kit section with an actions block:

```json
{
  "type": "actions",
  "block_id": "perm_actions_<permission_id>",
  "elements": [
    {
      "type": "button",
      "action_id": "opencat_perm_once",
      "text": { "type": "plain_text", "text": "Allow Once" },
      "value": "{\"sessionId\":\"<id>\",\"permissionId\":\"<perm_id>\",\"response\":\"once\"}"
    },
    {
      "type": "button",
      "action_id": "opencat_perm_always",
      "text": { "type": "plain_text", "text": "Always Allow" },
      "style": "primary",
      "value": "{\"sessionId\":\"<id>\",\"permissionId\":\"<perm_id>\",\"response\":\"always\"}"
    },
    {
      "type": "button",
      "action_id": "opencat_perm_reject",
      "text": { "type": "plain_text", "text": "Deny" },
      "style": "danger",
      "value": "{\"sessionId\":\"<id>\",\"permissionId\":\"<perm_id>\",\"response\":\"reject\"}"
    }
  ]
}
```

---

## 🚀 Running OpenCat Correctly

To prevent deadlocks and ensure interactive buttons work:
1. Turn on **Interactivity** in the [Slack App Settings](https://api.slack.com/apps) under **Interactivity & Shortcuts**.
2. Run the OpenCat background daemon (tokens can optionally be passed via CLI flags `--bot-token` and `--app-token`):
   ```bash
   npm run build && node dist/index.js --mode interactive --bot-token xoxb-... --app-token xapp-...
   ```
   Or use the short CLI aliases:
   ```bash
   npm run build && node dist/index.js -i
   ```
3. To attach a terminal monitor (which is read-only regarding prompts but allows watching execution):
   ```bash
   npx @sheiksadi/opencat attach -c
   ```

---

## 🩺 Programmatic Status Monitoring
For headless daemons and containerized environments, you can query status programmatically in JSON format using:
```bash
npx @sheiksadi/opencat status --json
```
