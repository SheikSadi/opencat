# 🐱 OpenCat (`@elelem/opencat`)

> **Remote OpenCode AI Agent Bridge for Slack**  
> Control your local OpenCode development agent remotely from your phone or laptop via Slack.

OpenCat establishes a secure, outbound **WebSocket (Socket Mode)** connection to Slack. It requires **no public IP, no port forwarding, no ngrok, and no webhook configuration**.

---

## ⚡ Quickstart (Under 2 Minutes)

### Step 1: Get the 1-Click Slack App Manifest

Run in your terminal:
```bash
npx @elelem/opencat manifest
```
Copy the printed JSON manifest.

### Step 2: Create Your Personal Slack Bot

Each user connects their own personal bot so conversations don't conflict:
1. Open [api.slack.com/apps](https://api.slack.com/apps).
2. Click **Create New App** ➔ **From an app manifest**.
3. Select your Slack workspace and paste the JSON from Step 1.
4. Name your bot (e.g. `OpenCat - John`).

### Step 3: Get Your Tokens

1. **Bot Token (`xoxb-...`):**  
   In your app settings sidebar, click **Install to Workspace** (or **OAuth & Permissions**), then copy the **Bot User OAuth Token** (`xoxb-...`).

2. **App-Level Token (`xapp-...`):**  
   Click **Basic Information** ➔ scroll to **App-Level Tokens** ➔ click **Generate Token and Scopes**:
   - Token Name: `opencat`
   - Scope: `connections:write`
   - Click **Generate** and copy the token (`xapp-...`).

### Step 4: Configure OpenCat

Run the interactive setup wizard:
```bash
npx @elelem/opencat setup
```
Paste your `xoxb-...` and `xapp-...` tokens when prompted. OpenCat securely saves your config to `~/.config/opencat/config.json` (chmod `0600`).

### Step 5: Start OpenCat!

```bash
npx @elelem/opencat
```

That's it! Your agent is live and listening on Slack.

---

## 💬 How to Use in Slack

- **Mention in channel:** `@OpenCat check git status and run tests`
- **Direct message:** Open a DM with your bot and send any prompt directly.
- **Thread continuity:** All replies within the same Slack thread share the same OpenCode session context.
- **Reset session:** Send `reset` or `new session` in the thread to start fresh.
- **Status emojis:**
  - 👀 (`eyes`): Request received, agent is working.
  - ✅ (`white_check_mark`): Completed successfully.
  - ❌ (`x`): OpenCode encountered an error.

---

## 📱 Handoff: Switch from PC to Phone

If you are working on your PC and want to step away without losing your active OpenCode session, ask OpenCode:
> *"Send a Slack handoff message so I can continue from my phone"*

OpenCode will run:
```bash
npx @elelem/opencat handoff --message "Tests passed. Ready for review!"
```
OpenCat automatically detects the active PC session, posts a notification to your Slack DM, and binds that thread. Any reply you send in that Slack thread continues the exact same session!

---

## 🛠️ CLI Reference

```bash
npx @elelem/opencat [command] [options]
```

### Commands:
| Command | Description |
|---|---|
| *(default)* | Start the Slack Socket Mode listener |
| `setup` | Run interactive credentials wizard & install skill/sync |
| `attach [args]` | Attach PC terminal to the shared OpenCat OpenCode server |
| `sync` | Enable live terminal sync in `~/.bashrc` / `~/.zshrc` |
| `manifest` | Print the 1-click Slack App Manifest JSON |
| `handoff [msg]` | Post a Slack notification linked to active PC session |
| `install-skill` | Install OpenCat handoff skill into OpenCode |
| `status` | View configured tokens and OpenCode server status |
| `--help`, `-h` | Display help |

### Options:
- `--dir <path>`: Working directory for OpenCode sessions (default: current directory).
- `--port <port>`: Port for OpenCode headless server (default: `4096`).
- `--message, -m <msg>`: Summary message text for handoff.
- `--channel, -c <id>`: Destination Slack channel ID (default: user DM).

---

## 🔒 Security & Privacy

- All communication between Slack and your machine happens over encrypted WebSockets (`wss://`).
- No incoming ports are opened on your machine or firewall.
- Credentials are saved only on your local machine (`~/.config/opencat/config.json`) with user-only permissions (`0600`).
- You can also set environment variables: `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN`.

---

## 🐧 Run as a Background Daemon (Linux Systemd)

To keep OpenCat running persistently in the background across reboots:

Create `~/.config/systemd/user/opencat.service`:

```ini
[Unit]
Description=OpenCat Slack Agent Listener
After=network.target

[Service]
Type=simple
Environment=NODE_ENV=production
ExecStart=/usr/bin/env npx @elelem/opencat
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Enable and start:
```bash
systemctl --user daemon-reload
systemctl --user enable --now opencat
loginctl enable-linger $USER
```
