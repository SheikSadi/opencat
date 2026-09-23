import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export interface GuideTopic {
  id: string;
  title: string;
  summary?: string;
  content?: string;
  children?: GuideTopic[];
}

export const GUIDE_TREE: GuideTopic = {
  id: "root",
  title: "OpenCat Interactive Guide & Knowledge Explorer",
  summary: "Welcome to OpenCat! Choose any category below to master your Slack AI agent bridge.",
  children: [
    {
      id: "quickstart",
      title: "🚀 Quickstart & Basic Usage",
      summary: "Learn how to start OpenCat, send prompts from Slack DMs or channels, and manage threads.",
      children: [
        {
          id: "qs-start",
          title: "Starting OpenCat Listener",
          content: `
🚀 STARTING OPENCAT
===================

OpenCat connects your local OpenCode agent to Slack via secure outbound WebSocket (Socket Mode).

1. In your project's root directory, run:
   $ npx @sheiksadi/opencat

2. To target a different workspace or repository directory:
   $ npx @sheiksadi/opencat --dir /path/to/my-project

3. To use a custom OpenCode server port (default 4096):
   $ npx @sheiksadi/opencat --port 4098

💡 Pro-tip: OpenCat runs completely locally. No public IP, no ngrok, and no port forwarding required!
`,
        },
        {
          id: "qs-dm",
          title: "Chatting via Slack Direct Message (DM)",
          content: `
💬 CHATTING VIA DIRECT MESSAGE (DM)
===================================

The simplest and most private way to use OpenCat:

1. Open your Slack workspace.
2. Find your bot under "Apps" or "Direct Messages" (e.g. @OpenCat).
3. Send any prompt directly:
   • "Check git status and summarize uncommitted changes"
   • "Fix the failing tests in src/auth.ts"
   • "Refactor database migration script"

Each DM conversation will automatically maintain its own active OpenCode session context!
`,
        },
        {
          id: "qs-channels",
          title: "Using OpenCat in Team Channels & Groups",
          content: `
👥 USING OPENCAT IN CHANNELS
============================

Collaborate with your team using OpenCat in shared channels:

1. Invite OpenCat to your channel:
   /invite @OpenCat

2. Mention the bot with your prompt:
   @OpenCat review the latest PR diff and suggest improvements

3. OpenCat will reply directly in a Slack thread, keeping the channel clean.
   All subsequent messages in that thread continue the conversation!
`,
        },
        {
          id: "qs-threads",
          title: "Thread Context & Multi-Turn Conversations",
          content: `
🧵 THREAD CONTEXT & CONTINUITY
==============================

OpenCat binds every Slack thread to a dedicated OpenCode session:

• Sequential instructions: When you reply in an existing thread, OpenCat continues
  with full memory of all previous tools, file edits, and responses.
• Isolated workspaces: Starting a new thread in Slack automatically creates a clean,
  independent OpenCode session.
• Session reset: If you want to wipe memory inside an active thread without starting
  a new one, simply reply:
  "reset" or "new session"
`,
        },
        {
          id: "qs-progress",
          title: "Live Tool Execution Streaming & Timers",
          content: `
📡 LIVE TOOL PROGRESS STREAMING
===============================

When OpenCode executes tools (running bash commands, editing files, searching code),
OpenCat posts an interactive Live Progress Card in your Slack thread:

• Real-time updates: The card updates in-place with active tools (e.g. ⚙️ Running: bash: pytest (14s)).
• Completed step summaries: See completed actions (e.g. ✅ read: package.json (120ms)).
• Dynamic indicators: Watch the agent think and execute live right from your mobile device!
`,
        },
      ],
    },
    {
      id: "slack-controls",
      title: "⚡ In-Chat Slack Controls & Commands",
      summary: "Special commands you can type in Slack to check status, abort tasks, view todos, or reset.",
      children: [
        {
          id: "sc-status",
          title: "Live Status Inspection (`status` / `what's up`)",
          content: `
🔍 LIVE STATUS INSPECTION
=========================

Ever wondered what the agent is currently doing while you're away from your desk?

Simply reply with any of these in your Slack thread:
• status
• what's up?
• progress
• how's it going?

⚡ OpenCat intercepts this query instantly:
Instead of queuing a slow agent prompt, it immediately inspects the running OpenCode process
and reports the exact tool, command, and elapsed duration!
`,
        },
        {
          id: "sc-stop",
          title: "Halting Execution (`stop` / `abort` / `cancel`)",
          content: `
🛑 HALTING EXECUTION IMMEDIATELY
================================

If an agent is running a long test, an unintended command, or you changed your mind:

Reply in Slack with:
• stop
• abort
• cancel

⚡ OpenCat immediately halts the active tool execution and stops the OpenCode turn!
`,
        },
        {
          id: "sc-todos",
          title: "Task Checklists (`todos` / `tasks`)",
          content: `
📋 TASK CHECKLISTS & PROGRESS
=============================

To view the agent's multi-step plan and checklist:

Reply in Slack with:
• todos
• tasks
• show tasks

OpenCat returns a formatted list of all completed, in-progress, and pending tasks
tracked by OpenCode for that session.
`,
        },
        {
          id: "sc-reset",
          title: "Resetting Thread Context (`reset` / `new session`)",
          content: `
🔄 RESETTING THREAD CONTEXT
===========================

To clear the session memory in an existing Slack thread and start fresh:

Reply with:
• reset
• new session
• /new

The next message in this thread will initialize a clean, new OpenCode session.
`,
        },
        {
          id: "sc-help",
          title: "In-Slack Help Card (`help`)",
          content: `
❓ IN-SLACK HELP CARD
====================

Need a quick reminder while in Slack?

Reply in any Slack thread or DM with:
• help

OpenCat will post a concise command cheat sheet right in your chat!
`,
        },
      ],
    },
    {
      id: "handoff",
      title: "📱 PC ➔ Phone Handoff",
      summary: "Transfer your active terminal session seamlessly to Slack so you can step away without losing context.",
      children: [
        {
          id: "ho-prompt",
          title: "Handoff via Natural Language in Terminal",
          content: `
🗣️ NATURAL LANGUAGE HANDOFF
============================

When working with OpenCode in your PC terminal, simply tell it:

> "Send a Slack handoff message so I can continue from my phone"
> "Handoff session to Slack with summary: Finished writing unit tests"

OpenCode invokes the OpenCat handoff skill, creates a Slack DM notification,
and links the thread directly to your active session!
`,
        },
        {
          id: "ho-cli",
          title: "Handoff via CLI Command (`npx @sheiksadi/opencat handoff`)",
          content: `
💻 HANDOFF VIA CLI COMMAND
==========================

You can trigger a handoff directly from your terminal:

$ npx @sheiksadi/opencat handoff "Finished refactoring auth. Ready for mobile review!"

Options:
• --channel, -c <channelId>: Specify a target channel (default: your DM)
• --session <sessionId>: Explicitly pass an OpenCode session ID

OpenCat posts to Slack and prints the thread ID. Reply on your phone to continue!
`,
        },
        {
          id: "ho-flow",
          title: "How Mobile Continuation Works",
          content: `
🔄 HOW CONTINUATION WORKS
=========================

1. When handoff executes, OpenCat sends a Slack notification with a session badge.
2. When you reply in that thread from your mobile Slack app, OpenCat automatically
   resumes the exact same session on your PC.
3. All file changes, terminal commands, and edits are executed live on your local machine!
`,
        },
      ],
    },
    {
      id: "mirroring",
      title: "🖥️ PC Terminal Mirroring & Auto-Sync",
      summary: "Watch Slack commands execute live on your PC screen and configure transparent shell auto-attaching.",
      children: [
        {
          id: "mir-attach",
          title: "Live Terminal Mirroring (`npx @sheiksadi/opencat attach`)",
          content: `
🖥️ LIVE TERMINAL MIRRORING
===========================

Want to see OpenCat's actions live on your PC monitor while you prompt from your phone?

In your terminal, run:
$ npx @sheiksadi/opencat attach

This attaches your local terminal UI directly to the running OpenCode server.
Any prompt sent from Slack will render its live tool outputs and text directly on your screen!
`,
        },
        {
          id: "mir-sync",
          title: "Shell Auto-Sync (`npx @sheiksadi/opencat sync`)",
          content: `
⚡ SHELL AUTO-SYNC
==================

Enable transparent shell integration so that simply running 'opencode' automatically
connects to the shared OpenCat server:

Run:
$ npx @sheiksadi/opencat sync

This safely adds an alias/function to your ~/.bashrc and ~/.zshrc:
• Running 'opencode' or 'opencode -c' will auto-attach to the active OpenCat instance.
• Run 'source ~/.bashrc' (or restart terminal) to apply.
`,
        },
      ],
    },
    {
      id: "permissions",
      title: "🛡️ Permission Modes & Security",
      summary: "Configure autonomous vs. interactive button approval modes for bash and file operations.",
      children: [
        {
          id: "perm-auto",
          title: "Auto Mode (`--mode auto`)",
          content: `
🟢 AUTO MODE (DEFAULT)
======================

$ npx @sheiksadi/opencat --mode auto

• Completely autonomous execution.
• OpenCode automatically executes tool calls (bash, file reads, writes) without waiting.
• Ideal for personal development environments and quick remote tasks.
`,
        },
        {
          id: "perm-interactive",
          title: "Interactive Approval Mode (`--mode interactive`)",
          content: `
🟡 INTERACTIVE APPROVAL MODE
============================

$ npx @sheiksadi/opencat --mode interactive

• When OpenCode attempts any mutating tool (running bash commands, modifying files),
  OpenCat posts an interactive approval card in Slack with 3 buttons:
  [ Allow Once ]  [ Always Allow ]  [ Deny ]
• Execution pauses until you tap a button in Slack!
• Perfect when you want fine-grained oversight on remote operations.
`,
        },
        {
          id: "perm-readonly",
          title: "Read-Only Mode (`--mode read-only`)",
          content: `
🔵 READ-ONLY MODE
=================

$ npx @sheiksadi/opencat --mode read-only

• Safe inspection tools (file reads, grep, glob, directory listings) are auto-approved.
• Mutating tools (bash execution, file writes/edits) trigger interactive Slack approval cards.
• The best balance between convenience and safety!
`,
        },
        {
          id: "perm-security",
          title: "Security & Credential Storage",
          content: `
🔒 SECURITY & CREDENTIAL STORAGE
================================

• No Inbound Ports: OpenCat uses Slack Socket Mode over outbound TLS WebSockets (wss://).
  No firewalls need to be opened and no public IP is exposed.
• Local Credentials: Slack tokens are stored in ~/.config/opencat/config.json with
  user-only read/write permissions (chmod 0600).
• Environment Override: You can also use SLACK_BOT_TOKEN and SLACK_APP_TOKEN env variables.
`,
        },
      ],
    },
    {
      id: "daemon",
      title: "🐧 Background Daemon & 24/7 Setup",
      summary: "Keep OpenCat running persistently in the background across reboots using Linux systemd.",
      children: [
        {
          id: "d-systemd",
          title: "Creating the Systemd Service File",
          content: `
🐧 SYSTEMD SERVICE CONFIGURATION
================================

Create file: ~/.config/systemd/user/opencat.service

[Unit]
Description=OpenCat Slack Agent Listener
After=network.target

[Service]
Type=simple
Environment=NODE_ENV=production
ExecStart=/usr/bin/env npx @sheiksadi/opencat
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`,
        },
        {
          id: "d-enable",
          title: "Enabling & Starting the Service",
          content: `
🚀 ENABLING & STARTING DAEMON
=============================

1. Reload systemd user daemon:
   $ systemctl --user daemon-reload

2. Enable and start OpenCat:
   $ systemctl --user enable --now opencat

3. Enable lingering so it continues running when you log out:
   $ loginctl enable-linger $USER
`,
        },
        {
          id: "d-logs",
          title: "Checking Status & Viewing Logs",
          content: `
📊 CHECKING STATUS & LOGS
=========================

• Check service status:
  $ systemctl --user status opencat

• Stream real-time logs:
  $ journalctl --user -u opencat -f

• Restart service:
  $ systemctl --user restart opencat
`,
        },
      ],
    },
    {
      id: "troubleshooting",
      title: "🔧 Troubleshooting & FAQ",
      summary: "Quick fixes for common setup, token scope, and connectivity issues.",
      children: [
        {
          id: "tb-reactions",
          title: "Missing Emoji Reactions (👀 / ✅ / ❌)",
          content: `
⚠️ MISSING EMOJI REACTIONS
==========================

If OpenCat does not react with emojis (👀 when working, ✅ when done):
Your Slack Bot Token lacks the 'reactions:write' permission scope.

Fix:
1. Go to https://api.slack.com/apps -> Select your OpenCat App.
2. Click "OAuth & Permissions" in the sidebar.
3. Under "Bot Token Scopes", add: reactions:write and reactions:read.
4. Click "Reinstall to Workspace" at the top.
`,
        },
        {
          id: "tb-channel",
          title: "Bot Not Responding in Channels",
          content: `
⚠️ BOT NOT RESPONDING IN CHANNELS
=================================

If the bot does not respond when you mention it in a channel:

Fix:
1. Make sure you invited the bot to the channel:
   /invite @OpenCat
2. Make sure you mention the bot:
   @OpenCat what's the latest commit?
3. Verify your Bot Token has 'app_mentions:read' and 'channels:history' scopes.
`,
        },
        {
          id: "tb-port",
          title: "OpenCode Port Conflict (Port 4096 in use)",
          content: `
⚠️ PORT CONFLICT
================

If port 4096 is already occupied by another application:

Fix:
Run OpenCat on a different port:
$ npx @sheiksadi/opencat --port 4098

Or find and terminate the existing process:
$ lsof -i :4096
$ kill -9 <PID>
`,
        },
        {
          id: "tb-status",
          title: "Verifying Configuration & Server Health",
          content: `
🔍 VERIFYING CONFIGURATION
==========================

Run the diagnostic status check:
$ npx @sheiksadi/opencat status

This validates:
• Config file location and permissions
• Bot Token (xoxb-...) validity
• App-Level Token (xapp-...) validity
• OpenCode headless server health & working directory
`,
        },
      ],
    },
  ],
};

export function formatTopicContent(topic: GuideTopic): string {
  const lines: string[] = [];
  const border = "=".repeat(70);
  lines.push(border);
  lines.push(`📖 ${topic.title.toUpperCase()}`);
  lines.push(border);
  if (topic.content) {
    lines.push(topic.content.trim());
  }
  lines.push(border);
  return lines.join("\n");
}

export function printAllGuide(node: GuideTopic = GUIDE_TREE, depth = 0): void {
  const indent = "  ".repeat(depth);
  if (node.id === "root") {
    console.log("========================================================================");
    console.log("           🐱 OpenCat Complete Documentation & Guide                    ");
    console.log("========================================================================\n");
  } else {
    console.log(`\n${indent}# ${node.title}`);
    if (node.summary) console.log(`${indent}${node.summary}`);
    if (node.content) console.log(node.content.trim());
  }

  if (node.children) {
    for (const child of node.children) {
      printAllGuide(child, depth + 1);
    }
  }
}

export async function startInteractiveGuide(): Promise<void> {
  const rl = readline.createInterface({ input, output });

  const historyStack: GuideTopic[] = [GUIDE_TREE];

  try {
    while (historyStack.length > 0) {
      const current = historyStack[historyStack.length - 1];
      const isRoot = historyStack.length === 1;

      console.log("\n" + "=".repeat(72));
      console.log(`       🐱 ${current.title.toUpperCase()}`);
      console.log("=".repeat(72));

      if (current.summary) {
        console.log(`\n💡 ${current.summary}\n`);
      }

      if (current.content) {
        console.log(current.content.trim());
        console.log("\n" + "-".repeat(72));
        console.log("Navigation: [Press Enter] to go back, or enter '0' for Main Menu");
        const nav = (await rl.question("👉 Choice: ")).trim().toLowerCase();
        if (nav === "0" || nav === "m" || nav === "main") {
          historyStack.length = 1; // Back to root
        } else {
          historyStack.pop(); // Back to parent
        }
        continue;
      }

      if (!current.children || current.children.length === 0) {
        historyStack.pop();
        continue;
      }

      console.log("What do you want to learn?\n");
      current.children.forEach((child, idx) => {
        const num = idx + 1;
        const desc = child.summary ? ` - ${child.summary}` : "";
        console.log(`  ${num}. ${child.title}${desc}`);
      });

      if (isRoot) {
        console.log("\n  0. 🚪 Exit Guide\n");
      } else {
        console.log("\n  0. ⬅️  Go Back\n");
      }

      const answer = (await rl.question(`Enter a choice (0-${current.children.length}): `)).trim();

      if (answer === "0" || answer.toLowerCase() === "q" || answer.toLowerCase() === "exit") {
        if (isRoot) {
          console.log("\n👋 Happy hacking with OpenCat! Run 'npx @sheiksadi/opencat' to start your bot anytime.\n");
          break;
        } else {
          historyStack.pop();
          continue;
        }
      }

      const selectedIndex = parseInt(answer, 10);
      if (isNaN(selectedIndex) || selectedIndex < 1 || selectedIndex > current.children.length) {
        console.log(`\n⚠️ Invalid selection. Please enter a number between 0 and ${current.children.length}.`);
        continue;
      }

      const nextNode = current.children[selectedIndex - 1];
      historyStack.push(nextNode);
    }
  } finally {
    rl.close();
  }
}
