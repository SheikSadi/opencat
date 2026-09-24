#!/usr/bin/env node
import { App } from "@slack/bolt";
import { resolveConfig, runInteractiveSetup, getConfigFilePath, type Config } from "./config.ts";
import { sessionStore } from "./session-store.ts";
import { opencodeService } from "./opencode.ts";
import { stateTracker } from "./state-tracker.ts";
import { slackStatusManager } from "./slack-status.ts";
import { permissionManager } from "./permissions.ts";
import { intentInterceptor } from "./interceptor.ts";
import { executeHandoff } from "./handoff.ts";
import { installHandoffSkill, installShellIntegration } from "./skill.ts";
import { startInteractiveGuide, printAllGuide } from "./guide.ts";

export const SLACK_MANIFEST = {
  _metadata: {
    major_version: 1,
    minor_version: 1,
  },
  display_information: {
    name: "OpenCat",
    description: "Remote OpenCode AI Agent Bridge for Slack",
    background_color: "#121212",
  },
  features: {
    bot_user: {
      display_name: "OpenCat",
      always_online: true,
    },
  },
  oauth_config: {
    scopes: {
      bot: [
        "app_mentions:read",
        "channels:history",
        "channels:read",
        "chat:write",
        "files:read",
        "files:write",
        "groups:history",
        "groups:read",
        "im:history",
        "im:read",
        "im:write",
        "mpim:history",
        "mpim:read",
        "reactions:read",
        "reactions:write",
        "users:read",
      ],
    },
  },
  settings: {
    interactivity: {
      is_enabled: true,
    },
    event_subscriptions: {
      bot_events: [
        "app_mention",
        "message.channels",
        "message.groups",
        "message.im",
        "message.mpim",
      ],
    },
    socket_mode_enabled: true,
    token_rotation_enabled: false,
  },
};

function printHelp() {
  console.log(`
🐱 OpenCat - Remote OpenCode AI Agent Bridge for Slack

Usage:
  npx @sheiksadi/opencat [command] [options]

Commands:
  start               Start the Slack Socket Mode listener (default)
  setup               Run the interactive Slack credentials setup wizard
  guide               Interactive knowledge explorer & usage guide (aliases: how-to, docs)
  manifest            Print the 1-click Slack App Manifest JSON
  attach [args...]    Attach your PC terminal to the shared OpenCat OpenCode server
  sync                Enable live terminal sync in ~/.bashrc / ~/.zshrc
  handoff [message]   Post a handoff message to Slack linked to this active session
  install-skill       Install the OpenCat handoff skill into OpenCode
  status              Check configuration and server health
  test                Run self-test verification suite
  --help, -h          Show this help message

Options:
  --port <port>       Port for OpenCode headless server (default: 4096)
  --dir <path>        Working directory for OpenCode sessions (default: current directory)
  --mode <mode>       Permission mode: auto, interactive, or read-only (default: auto)
  --message, -m <msg> Message text for handoff
  --channel, -c <id>  Target Slack channel for handoff (default: user DM)

Examples:
  npx @sheiksadi/opencat
  npx @sheiksadi/opencat setup
  npx @sheiksadi/opencat manifest
  npx @sheiksadi/opencat handoff "Tests passed. Ready for review!"
  npx @sheiksadi/opencat --dir /path/to/my-repo
`);
}

function splitSlackMessage(text: string, maxLength = 3900): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    // Prefer splitting at a newline
    let splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx === -1 || splitIdx < maxLength / 2) {
      // Prefer splitting at whitespace
      splitIdx = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIdx === -1 || splitIdx < maxLength / 2) {
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

async function safeReaction(
  client: any,
  action: "add" | "remove",
  channel: string,
  timestamp: string,
  name: string
) {
  try {
    if (action === "add") {
      await client.reactions.add({ channel, timestamp, name });
    } else {
      await client.reactions.remove({ channel, timestamp, name });
    }
  } catch (err: any) {
    const code = err.data?.error || err.message;
    if (code === "missing_scope") {
      console.warn("⚠️ Slack reaction failed: Bot token lacks 'reactions:write' scope. Add it in OAuth & Permissions.");
    } else if (code !== "no_reaction" && code !== "already_reacted") {
      console.warn(`⚠️ Slack reaction (${action} ${name}) failed:`, code);
    }
  }
}

async function startListener(config: Config) {
  console.log("⚡ Initializing OpenCat Slack Socket Mode Listener...");
  console.log(`📁 OpenCode Working Directory: ${config.opencodeWorkingDir}`);
  console.log(`🛡️ Permission Mode: ${config.permissionMode}`);
  console.log(`📡 Live Progress Streaming: ${config.liveProgress ? "Enabled" : "Disabled"}`);

  // Initialize and ensure OpenCode headless server is up
  opencodeService.init(config);
  await opencodeService.ensureServer();

  const app = new App({
    token: config.slackBotToken,
    appToken: config.slackAppToken,
    socketMode: true,
  });

  // Attach Slack client to helpers
  slackStatusManager.init(app.client);
  permissionManager.setSlackClient(app.client);

  let botUserId = "";
  let botId = "";

  const processedMessages = new Set<string>();

  function isDuplicateMessage(channel: string, ts: string): boolean {
    const key = `${channel}:${ts}`;
    if (processedMessages.has(key)) {
      return true;
    }
    if (processedMessages.size > 5000) {
      processedMessages.clear();
    }
    processedMessages.add(key);
    setTimeout(() => processedMessages.delete(key), 5 * 60 * 1000);
    return false;
  }

  try {
    const auth = await app.client.auth.test({ token: config.slackBotToken });
    botUserId = auth.user_id || "";
    botId = auth.bot_id || "";
    console.log(`🤖 Bot connected as: @${auth.user} (User ID: ${botUserId}, Bot ID: ${botId})`);
  } catch (err) {
    console.error("❌ Failed to verify Slack credentials:", err);
    process.exit(1);
  }

  // Handle interactive permission approvals from Slack buttons
  app.action("opencat_perm_once", async ({ ack, body, action }) => {
    await ack();
    try {
      const val = JSON.parse((action as any).value || "{}");
      if (val.permissionId) {
        await permissionManager.resolvePermission(val.permissionId, "once", body.user.id);
      }
    } catch (err) {
      console.error("Error resolving permission (once):", err);
    }
  });

  app.action("opencat_perm_always", async ({ ack, body, action }) => {
    await ack();
    try {
      const val = JSON.parse((action as any).value || "{}");
      if (val.permissionId) {
        await permissionManager.resolvePermission(val.permissionId, "always", body.user.id);
      }
    } catch (err) {
      console.error("Error resolving permission (always):", err);
    }
  });

  app.action("opencat_perm_reject", async ({ ack, body, action }) => {
    await ack();
    try {
      const val = JSON.parse((action as any).value || "{}");
      if (val.permissionId) {
        await permissionManager.resolvePermission(val.permissionId, "reject", body.user.id);
      }
    } catch (err) {
      console.error("Error resolving permission (reject):", err);
    }
  });

  // Handle incoming message or mention
  async function handleInstruction({
    channel,
    ts,
    threadTs,
    userId,
    text,
    say,
    client,
  }: {
    channel: string;
    ts: string;
    threadTs: string;
    userId: string;
    text: string;
    say: (args: any) => Promise<any>;
    client: any;
  }) {
    if (isDuplicateMessage(channel, ts)) {
      return;
    }

    const cleanText = text
      .replace(new RegExp(`<@${botUserId}>`, "g"), "")
      .replace(/<@[A-Z0-9]+>/g, "")
      .trim();

    if (!cleanText) return;

    // React with "eyes" to acknowledge receipt immediately
    await safeReaction(client, "add", channel, ts, "eyes");

    const threadKey = `${channel}:${threadTs}`;

    // Command: help
    if (cleanText.toLowerCase() === "help") {
      const helpText = [
        "👋 *OpenCat - OpenCode Slack Bridge*",
        "",
        "Send me instructions to control your local OpenCode agent while away!",
        "• *Regular message/thread*: Messages within the same Slack thread share OpenCode session context.",
        "• `status` / `what's up`: Instantly check current activity without continuing pending tasks.",
        "• `stop` / `abort`: Instantly stop any running task.",
        "• `todos` / `tasks`: View current session task checklist.",
        "• `reset` or `new session`: Starts a new, fresh OpenCode session for this thread.",
        "• `help`: Shows this help message.",
      ].join("\n");

      await say({ text: helpText, thread_ts: threadTs });
      await safeReaction(client, "remove", channel, ts, "eyes");
      await safeReaction(client, "add", channel, ts, "white_check_mark");
      return;
    }

    // Command: reset session
    if (["reset", "new session", "/new", "!reset"].includes(cleanText.toLowerCase())) {
      sessionStore.delete(threadKey);
      await say({
        text: "🔄 OpenCode session context reset for this thread. The next message will start a fresh session.",
        thread_ts: threadTs,
      });
      await safeReaction(client, "remove", channel, ts, "eyes");
      await safeReaction(client, "add", channel, ts, "white_check_mark");
      return;
    }

    try {
      // Get or create session
      let sessionId = sessionStore.get(threadKey);
      if (!sessionId) {
        const title = `Slack (${userId}): ${cleanText.slice(0, 40)}`;
        sessionId = await opencodeService.createSession(title);
        sessionStore.set(threadKey, sessionId);
        console.log(`✨ Created new OpenCode session ${sessionId} for thread ${threadKey}`);
      } else {
        console.log(`🔗 Continuing OpenCode session ${sessionId} for thread ${threadKey}`);
      }

      // Register active Slack thread with permission manager
      permissionManager.registerSessionThread(sessionId, channel, threadTs);

      // Check for Instant Status / Abort / Todo Intercept
      const interceptResult = await intentInterceptor.intercept(sessionId, cleanText);
      if (interceptResult.handled && interceptResult.replyText) {
        await say({ text: interceptResult.replyText, thread_ts: threadTs });
        await safeReaction(client, "remove", channel, ts, "eyes");
        await safeReaction(client, "add", channel, ts, "white_check_mark");
        return;
      }

      // Start Live Progress Card in Slack Thread if enabled
      if (config.liveProgress) {
        await slackStatusManager.startStatus(channel, threadTs, sessionId, cleanText);
      }

      // Frame instruction with remote Slack context guardrails
      const promptWithFraming = `[Remote Slack Instruction from @${userId}]:\n${cleanText}`;

      // Execute prompt in OpenCode
      const reply = await opencodeService.prompt(sessionId, promptWithFraming);

      // Mark Live Status Card as Finished
      if (config.liveProgress) {
        await slackStatusManager.finishStatus(sessionId, true, "Completed");
      }

      // Post reply back in thread (chunked if large)
      const chunks = splitSlackMessage(reply);
      for (const chunk of chunks) {
        await say({ text: chunk, thread_ts: threadTs });
      }

      // Update reaction: remove eyes, add check mark
      await safeReaction(client, "remove", channel, ts, "eyes");
      await safeReaction(client, "add", channel, ts, "white_check_mark");
    } catch (err: any) {
      console.error(`❌ Error processing instruction for ${threadKey}:`, err);

      if (config.liveProgress) {
        let sessionId = sessionStore.get(threadKey);
        if (sessionId) {
          await slackStatusManager.finishStatus(sessionId, false, "Encountered an error");
        }
      }

      await say({
        text: `⚠️ *OpenCode encountered an error:*\n\`\`\`${err.message || String(err)}\`\`\``,
        thread_ts: threadTs,
      });

      await safeReaction(client, "remove", channel, ts, "eyes");
      await safeReaction(client, "add", channel, ts, "x");
    }
  }

  // Handle DMs and channel messages
  app.message(async ({ message, say, client }) => {
    // Ignore edits, deletions, bot messages
    if (message.subtype) return;
    if ("bot_id" in message && message.bot_id) return;
    if ("user" in message && message.user === botUserId) return;

    const text = ("text" in message ? message.text : "") || "";
    const channel = message.channel;
    const ts = message.ts;
    const threadTs = ("thread_ts" in message && message.thread_ts ? message.thread_ts : ts) as string;
    const userId = ("user" in message ? message.user : "unknown") as string;

    const isDM = channel.startsWith("D");
    const isBotMentioned = text.includes(`<@${botUserId}>`);
    const isExistingThreadSession = !!sessionStore.get(`${channel}:${threadTs}`);

    // In channels or group chats, only respond if explicitly mentioned or part of an existing thread session
    if (!isDM && !isBotMentioned && !isExistingThreadSession) {
      return;
    }

    await handleInstruction({
      channel,
      ts,
      threadTs,
      userId,
      text,
      say,
      client,
    });
  });

  // Handle mentions in channels
  app.event("app_mention", async ({ event, say, client }) => {
    if (event.user === botUserId) return;

    const text = event.text || "";
    const channel = event.channel;
    const ts = event.ts;
    const threadTs = (event.thread_ts || ts) as string;
    const userId = event.user || "unknown";

    await handleInstruction({
      channel,
      ts,
      threadTs,
      userId,
      text,
      say,
      client,
    });
  });

  await app.start();
  console.log("🟢 Slack Socket Mode listener is running and ready for instructions!");

  const cleanup = async () => {
    console.log("\nShutting down listener...");
    try {
      await app.stop();
    } catch {}
    opencodeService.stopServer();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "start";

  if (["--help", "-h", "help"].includes(command)) {
    printHelp();
    process.exit(0);
  }

  if (["guide", "how-to", "howto", "docs", "usage", "cheatsheet"].includes(command)) {
    if (args.includes("--all") || !process.stdin.isTTY) {
      printAllGuide();
    } else {
      await startInteractiveGuide();
    }
    process.exit(0);
  }

  if (command === "manifest") {
    console.log(JSON.stringify(SLACK_MANIFEST, null, 2));
    console.log("\n💡 How to use this manifest:");
    console.log("1. Go to https://api.slack.com/apps");
    console.log("2. Click 'Create New App' -> 'From an app manifest'");
    console.log("3. Select your Slack workspace and paste the JSON above.");
    console.log("4. Under 'OAuth & Permissions', click 'Install to Workspace' -> copy Bot User OAuth Token (xoxb-...)");
    console.log("5. Under 'Basic Information' -> 'App-Level Tokens', click 'Generate Token' with scope 'connections:write' -> copy App Token (xapp-...)");
    console.log("6. Run 'npx @sheiksadi/opencat setup' to configure OpenCat.\n");
    process.exit(0);
  }

  if (command === "handoff") {
    let message: string | undefined;
    let channel: string | undefined;
    let sessionId: string | undefined;

    for (let i = 1; i < args.length; i++) {
      if ((args[i] === "--message" || args[i] === "-m") && args[i + 1]) {
        message = args[i + 1];
        i++;
      } else if ((args[i] === "--channel" || args[i] === "-c") && args[i + 1]) {
        channel = args[i + 1];
        i++;
      } else if (args[i] === "--session" && args[i + 1]) {
        sessionId = args[i + 1];
        i++;
      } else if (!message && !args[i].startsWith("-")) {
        message = args.slice(i).join(" ");
        break;
      }
    }

    try {
      console.log("🔄 Initiating OpenCat session handoff to Slack...");
      const result = await executeHandoff({
        message,
        channel,
        sessionId,
      });
      console.log(`✅ Handoff message sent!`);
      console.log(`📌 Session ID: ${result.sessionId}`);
      console.log(`💬 Slack Channel: ${result.channel}`);
      console.log(`🧵 Message Timestamp: ${result.ts}`);
      console.log(`\n👉 Reply directly to that message in Slack to continue this session!`);
      console.log(`💡 Tip: To see Slack updates live on this monitor while you're away, attach with: npx @sheiksadi/opencat attach -c`);
      process.exit(0);
    } catch (err: any) {
      console.error(`❌ Handoff failed:`, err.message);
      process.exit(1);
    }
  }

  if (command === "attach") {
    const { config } = await resolveConfig();
    const extraArgs = args.slice(1);
    console.log(`🔗 Attaching to OpenCode server at ${config.opencodeServerUrl}...`);
    const { spawnSync } = await import("node:child_process");
    const child = spawnSync("opencode", ["attach", config.opencodeServerUrl, ...extraArgs], {
      stdio: "inherit",
    });
    process.exit(child.status ?? 0);
  }

  if (command === "sync" || command === "enable-sync") {
    const ok = installShellIntegration();
    if (ok) {
      console.log("✅ Enabled live PC terminal sync in ~/.bashrc / ~/.zshrc.");
      console.log("   Now simply running 'opencode' or 'opencode -c' will auto-attach to OpenCat.");
      console.log("   Run 'source ~/.bashrc' (or restart your terminal) to apply.");
    } else {
      console.error("❌ Failed to update shell rc files.");
    }
    process.exit(0);
  }

  if (command === "install-skill") {
    const ok = installHandoffSkill();
    if (ok) {
      console.log("✅ Installed OpenCode handoff skill at ~/.config/opencode/skills/opencat/SKILL.md");
    } else {
      console.error("❌ Failed to install skill.");
    }
    process.exit(0);
  }

  if (command === "setup" || command === "config") {
    const { config, startNow } = await runInteractiveSetup();
    if (startNow) {
      await startListener(config);
    }
    process.exit(0);
  }

  if (command === "status") {
    const { config: cfg } = await resolveConfig();
    console.log("=== OpenCat Status ===");
    console.log("Config file:", getConfigFilePath());
    console.log("Slack Bot Token:", cfg.slackBotToken ? `configured (${cfg.slackBotToken.slice(0, 9)}...)` : "missing");
    console.log("Slack App Token:", cfg.slackAppToken ? `configured (${cfg.slackAppToken.slice(0, 9)}...)` : "missing");
    console.log("OpenCode Server URL:", cfg.opencodeServerUrl);
    console.log("Working Directory:", cfg.opencodeWorkingDir);
    console.log("Permission Mode:", cfg.permissionMode);
    console.log("Live Progress:", cfg.liveProgress ? "enabled" : "disabled");
    process.exit(0);
  }

  if (command === "test") {
    console.log("🧪 Running OpenCat self-test suite...");
    const { spawnSync } = await import("node:child_process");
    const testPath = new URL("../test/verify.ts", import.meta.url).pathname;
    const res = spawnSync(process.execPath, ["--experimental-strip-types", testPath], {
      stdio: "inherit",
    });
    process.exit(res.status ?? 0);
  }

  // Parse optional flags like --dir, --port, --mode
  let workingDir: string | undefined;
  let port: number | undefined;
  let permissionMode: any;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir" && args[i + 1]) {
      workingDir = args[i + 1];
      i++;
    } else if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--mode" && args[i + 1]) {
      permissionMode = args[i + 1];
      i++;
    }
  }

  const { config, startNow } = await resolveConfig();
  if (!startNow) {
    process.exit(0);
  }

  if (workingDir) config.opencodeWorkingDir = workingDir;
  if (port) config.port = port;
  if (permissionMode) config.permissionMode = permissionMode;

  await startListener(config);
}

main().catch((err) => {
  console.error("❌ Fatal application error:", err);
  process.exit(1);
});
