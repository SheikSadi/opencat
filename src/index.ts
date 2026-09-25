#!/usr/bin/env node
import pkg from "@slack/bolt";
const { App } = pkg;
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
import { parseStartOptions } from "./cli-options.ts";

export const SLACK_MANIFEST = {
  _metadata: {
    major_version: 1,
    minor_version: 1,
  },
  display_information: {
    name: "LocalCat",
    description: "Local OpenCode AI Agent Bridge for Slack",
    background_color: "#121212",
  },
  features: {
    app_home: {
      home_tab_enabled: false,
      messages_tab_enabled: true,
      messages_tab_read_only_enabled: false,
    },
    bot_user: {
      display_name: "LocalCat",
      always_online: true,
    },
    slash_commands: [
      {
        command: "/localcat",
        description: "Manage LocalCat middleware (reinstall/sync manifest)",
        usage_hint: "[reinstall]",
        should_escape: false,
      },
      {
        command: "/localcode",
        description: "Control local OpenCode agent mode and status",
        usage_hint: "[build | plan | mode | status]",
        should_escape: false,
      },
    ],
  },
  oauth_config: {
    scopes: {
      bot: [
        "commands",
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
  --mode <mode>       Permission mode: auto, interactive, or read-only (default: auto; aliases: -i, -r)
  --message, -m <msg> Message text for handoff
  --channel, -c <id>  Target Slack channel for handoff (default: user DM)

Examples:
  npx @sheiksadi/opencat
  npx @sheiksadi/opencat setup
  npx @sheiksadi/opencat manifest
  npx @sheiksadi/opencat -i
  npx @sheiksadi/opencat -r
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

  let authSuccess = false;
  let authDelay = 1000;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      console.log(`🔑 Testing Slack credentials (attempt ${attempt}/10)...`);
      const auth = await app.client.auth.test({ token: config.slackBotToken });
      botUserId = auth.user_id || "";
      botId = auth.bot_id || "";
      console.log(`🤖 Bot connected as: @${auth.user} (User ID: ${botUserId}, Bot ID: ${botId})`);
      authSuccess = true;
      break;
    } catch (err: any) {
      console.error(`❌ Slack authentication attempt ${attempt} failed:`, err.message || err);
      if (attempt === 10) {
        console.error("❌ Unrecoverable authentication failure. Exiting.");
        process.exit(1);
      }
      console.log(`🔄 Retrying authentication in ${authDelay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, authDelay));
      authDelay = Math.min(authDelay * 2, 60000);
    }
  }

  // Helper to fetch Slack private file with bot token authentication
  async function downloadSlackFileAsBase64(
    url: string,
    token: string
  ): Promise<{ base64: string; mimeType: string } | null> {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        console.warn(`⚠️ Failed to download Slack file from ${url}: status ${res.status}`);
        return null;
      }
      const mimeType = res.headers.get("content-type") || "application/octet-stream";
      const arrayBuffer = await res.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      return { base64, mimeType };
    } catch (err: any) {
      console.warn(`⚠️ Error downloading Slack file:`, err.message || err);
      return null;
    }
  }

  // Helper to reinstall/sync Slack manifest via API or Slack CLI
  async function performManifestReinstall(): Promise<{ success: boolean; message: string }> {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");

    let userToken = "";
    const credFile = path.join(os.homedir(), ".slack/credentials.json");
    if (fs.existsSync(credFile)) {
      try {
        const creds = JSON.parse(fs.readFileSync(credFile, "utf-8"));
        for (const teamId of Object.keys(creds)) {
          if (creds[teamId]?.token) {
            userToken = creds[teamId].token;
            break;
          }
        }
      } catch {}
    }

    if (!userToken) {
      userToken = process.env.SLACK_USER_TOKEN || process.env.SLACK_CONFIG_TOKEN || "";
    }

    let appId = process.env.SLACK_APP_ID || "";
    if (!appId && userToken && config.slackBotToken) {
      try {
        const authRes = await fetch("https://slack.com/api/auth.test", {
          headers: { Authorization: `Bearer ${config.slackBotToken}` },
        });
        const authJson = await authRes.json();
        const botId = authJson.bot_id;
        if (botId) {
          const botRes = await fetch(`https://slack.com/api/bots.info?bot=${botId}`, {
            headers: { Authorization: `Bearer ${userToken}` },
          });
          const botJson = await botRes.json();
          appId = botJson.bot?.app_id || "";
        }
      } catch (err: any) {
        console.warn("⚠️ Could not resolve Slack app_id:", err.message);
      }
    }

    if (!appId || !userToken) {
      return {
        success: false,
        message: "❌ Could not find Slack User/Config Token in `~/.slack/credentials.json`. Run `slack login` on your host once to link the CLI.",
      };
    }

    try {
      const updateRes = await fetch("https://slack.com/api/apps.manifest.update", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          app_id: appId,
          manifest: SLACK_MANIFEST,
        }),
      });
      const updateJson = await updateRes.json();

      if (!updateJson.ok) {
        return {
          success: false,
          message: `⚠️ Slack API error updating manifest: \`${updateJson.error}\``,
        };
      }

      // If slack CLI exists, run slack app install to activate changes in workspace
      const { spawnSync } = await import("node:child_process");
      const cliCheck = spawnSync("which", ["slack"]);
      if (cliCheck.status === 0) {
        const installRes = spawnSync("slack", ["app", "install", `--app=${appId}`], {
          encoding: "utf-8",
        });
        if (installRes.status === 0) {
          return {
            success: true,
            message: `🎉 *OpenCat reinstalled successfully!* App \`${appId}\` updated with the latest manifest and slash commands activated.`,
          };
        }
      }

      return {
        success: true,
        message: `✅ *Manifest updated via Slack API* for app \`${appId}\`. If new scopes were added, reinstall to workspace in the Slack App Console.`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `❌ Failed to reinstall app: ${err.message || String(err)}`,
      };
    }
  }

  // Command handler for /localcat (LocalCat middleware management)
  app.command("/localcat", async ({ command, ack, respond }) => {
    await ack();
    const subcmd = (command.text || "").trim().toLowerCase();

    if (subcmd === "reinstall" || subcmd === "sync") {
      await respond({
        text: "⏳ Reinstalling LocalCat Slack app with latest manifest...",
        response_type: "ephemeral",
      });
      const result = await performManifestReinstall();
      await respond({
        text: result.message,
        response_type: "ephemeral",
      });
    } else {
      await respond({
        text: "Usage: `/localcat reinstall` (Sync & reinstall Slack app with latest manifest)",
        response_type: "ephemeral",
      });
    }
  });

  // Command handler for /localcode (Local OpenCode server agent modes & status)
  app.command("/localcode", async ({ command, ack, respond }) => {
    await ack();
    const subcmd = (command.text || "").trim().toLowerCase();
    const channelId = command.channel_id;

    if (subcmd === "status") {
      const activeMode = sessionStore.getChannelMode(channelId);
      const isOnline = await opencodeService.isServerRunning();
      await respond({
        text: `📊 *Local OpenCode Status*\n• Server: ${isOnline ? "🟢 Online" : "🔴 Offline"}\n• Mode: *${activeMode.toUpperCase()}* (\`${activeMode}\`)\n• Port: ${config.port}\n• Directory: \`${config.opencodeWorkingDir}\``,
        response_type: "ephemeral",
      });
    } else if (subcmd === "build") {
      if (channelId) {
        sessionStore.setChannelMode(channelId, "build");
      }
      await respond({
        text: "⚡ Switched to *Build Mode* (`build`). Code editing and execution enabled.",
        response_type: "ephemeral",
      });
    } else if (subcmd === "plan") {
      if (channelId) {
        sessionStore.setChannelMode(channelId, "plan");
      }
      await respond({
        text: "🧠 Switched to *Plan Mode* (`plan`). Read-only analysis and planning.",
        response_type: "ephemeral",
      });
    } else if (subcmd === "mode" || subcmd === "") {
      const currentMode = sessionStore.getChannelMode(channelId);
      const blocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `⚙️ *Select OpenCode Agent Mode:*\nCurrent active mode in this channel: *${currentMode.toUpperCase()}* (\`${currentMode}\`)`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "🧠 Plan Mode", emoji: true },
              action_id: "opencat_act_mode_plan",
              style: currentMode === "plan" ? "primary" : undefined,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "⚡ Build Mode", emoji: true },
              action_id: "opencat_act_mode_build",
              style: currentMode === "build" ? "primary" : undefined,
            },
          ],
        },
      ];
      await respond({ blocks, response_type: "ephemeral" });
    } else {
      await respond({
        text: "Usage: `/localcode` | `/localcode mode` | `/localcode build` | `/localcode plan` | `/localcode status`",
        response_type: "ephemeral",
      });
    }
  });

  // Handle interactive mode switch button clicks
  app.action("opencat_act_mode_plan", async ({ ack, body, respond, client }) => {
    await ack();
    const channelId = (body as any).channel?.id;
    if (channelId) {
      sessionStore.setChannelMode(channelId, "plan");
    }
    const messageTs = (body as any).message?.ts;
    if (channelId && messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: "🧠 Switched to *Plan Mode*",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "✅ Active Mode: *Plan Mode* (Read-only analysis & planning)",
              },
            },
          ],
        });
        return;
      } catch {}
    }
    await respond({
      text: "🧠 Switched to *Plan Mode*",
      replace_original: true,
    });
  });

  app.action("opencat_act_mode_build", async ({ ack, body, respond, client }) => {
    await ack();
    const channelId = (body as any).channel?.id;
    if (channelId) {
      sessionStore.setChannelMode(channelId, "build");
    }
    const messageTs = (body as any).message?.ts;
    if (channelId && messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: "⚡ Switched to *Build Mode*",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "✅ Active Mode: *Build Mode* (Code editing & execution enabled)",
              },
            },
          ],
        });
        return;
      } catch {}
    }
    await respond({
      text: "⚡ Switched to *Build Mode*",
      replace_original: true,
    });
  });

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
    rawFiles,
    say,
    client,
  }: {
    channel: string;
    ts: string;
    threadTs: string;
    userId: string;
    text: string;
    rawFiles?: any[];
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

    if (!cleanText && (!rawFiles || rawFiles.length === 0)) return;

    // React with "eyes" to acknowledge receipt immediately
    await safeReaction(client, "add", channel, ts, "eyes");

    const threadKey = `${channel}:${threadTs}`;

    // Command: help
    if (cleanText.toLowerCase() === "help") {
      const activeMode = sessionStore.getChannelMode(channel);
      const helpText = [
        "👋 *OpenCat - Local OpenCode Slack Bridge*",
        "",
        "Send me instructions to control your local OpenCode agent while away!",
        `• *Active Agent Mode*: \`${activeMode}\` (Use \`/localcode build\` or \`/localcode plan\` to switch)`,
        "• *OpenCode Commands*: `/localcode mode`, `/localcode build`, `/localcode plan`, `/localcode status`.",
        "• *LocalCat Commands*: `/localcat reinstall` (Sync & reinstall Slack app manifest).",
        "• *Regular message/thread*: Messages within the same Slack thread share OpenCode session context.",
        "• *Attachments & Images*: Upload screenshots, logs, or files directly in your message.",
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
      // Ensure the OpenCode server is running and healthy
      await opencodeService.ensureServer();

      // Get or create session
      let sessionId = sessionStore.get(threadKey);
      let sessionExists = false;
      if (sessionId) {
        try {
          const res = await opencodeService.client.session.get({
            path: { id: sessionId },
          });
          if (res?.data && !res?.error) {
            sessionExists = true;
          }
        } catch {
          sessionExists = false;
        }
      }

      if (!sessionId || !sessionExists) {
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

      // Download any Slack file or image attachments
      const attachedFiles: Array<{ mime: string; filename?: string; url: string }> = [];
      if (rawFiles && rawFiles.length > 0) {
        for (const file of rawFiles) {
          const downloadUrl = file.url_private_download || file.url_private;
          if (downloadUrl) {
            const downloaded = await downloadSlackFileAsBase64(downloadUrl, config.slackBotToken);
            if (downloaded) {
              const mime = file.mimetype || downloaded.mimeType;
              const dataUrl = `data:${mime};base64,${downloaded.base64}`;
              attachedFiles.push({
                mime,
                filename: file.name || file.title || "attachment",
                url: dataUrl,
              });
            }
          }
        }
      }

      const activeAgent = sessionStore.getChannelMode(channel);

      // Start Live Progress Card in Slack Thread if enabled
      if (config.liveProgress) {
        const statusSummary = cleanText || (attachedFiles.length > 0 ? `Uploaded ${attachedFiles.length} file(s)` : "Processing...");
        await slackStatusManager.startStatus(channel, threadTs, sessionId, statusSummary);
      }

      // Frame instruction with remote Slack context guardrails
      const promptText = cleanText || (attachedFiles.length > 0 ? "Please inspect the attached file(s) and provide guidance or action." : "");
      const promptWithFraming = `[Remote Slack Instruction from @${userId}]:\n${promptText}`;

      // Execute prompt in OpenCode
      const reply = await opencodeService.prompt(sessionId, promptWithFraming, {
        agent: activeAgent,
        files: attachedFiles.length > 0 ? attachedFiles : undefined,
      });

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
    // Ignore edits, deletions, bot messages (allow file_share subtype)
    if (message.subtype && message.subtype !== "file_share") return;
    if ("bot_id" in message && message.bot_id) return;
    if ("user" in message && message.user === botUserId) return;

    const text = ("text" in message ? message.text : "") || "";
    const rawFiles = ("files" in message ? (message as any).files : []) || [];
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
      rawFiles,
      say,
      client,
    });
  });

  // Handle mentions in channels
  app.event("app_mention", async ({ event, say, client }) => {
    if (event.user === botUserId) return;

    const text = event.text || "";
    const rawFiles = (event as any).files || [];
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
      rawFiles,
      say,
      client,
    });
  });

  async function startAppWithRetry() {
    let delay = 1000;
    const maxRetries = 10;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`⚡ Starting Slack Socket Mode listener (attempt ${attempt}/${maxRetries})...`);
        await app.start();
        console.log("🟢 Slack Socket Mode listener is running and ready for instructions!");
        return;
      } catch (err: any) {
        console.error(`❌ Failed to start Slack Socket Mode listener (attempt ${attempt}/${maxRetries}):`, err.message || err);
        if (attempt === maxRetries) {
          console.error("❌ Max connection retries reached. Exiting.");
          process.exit(1);
        }
        console.log(`🔄 Retrying listener in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 60000);
      }
    }
  }

  // Bind to socket mode client failures
  const socketClient = (app as any).receiver?.client;
  if (socketClient) {
    socketClient.on("reconnecting", () => {
      console.log("🔄 Slack Socket Mode connection dropped. Reconnecting...");
    });
    socketClient.on("failed", async (err: any) => {
      console.error("❌ Slack Socket Mode connection failed permanently:", err);
      console.log("🔄 Re-initializing listener with exponential backoff...");
      try {
        await app.stop();
      } catch (e) {
        console.warn("⚠️ Warning during app.stop() execution:", e);
      }
      await startAppWithRetry();
    });
  }

  await startAppWithRetry();

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

  const { workingDir, port, permissionMode, botToken, appToken } = parseStartOptions(args);

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
    const { config } = await resolveConfig({ botToken, appToken });
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
    const { config: cfg } = await resolveConfig({ botToken, appToken });
    opencodeService.init(cfg);
    const isRunning = await opencodeService.isServerRunning();
    const useJson = args.includes("--json");

    if (useJson) {
      console.log(JSON.stringify({
        status: "ok",
        configFile: getConfigFilePath(),
        slackBotToken: cfg.slackBotToken ? "configured" : "missing",
        slackAppToken: cfg.slackAppToken ? "configured" : "missing",
        opencodeServerUrl: cfg.opencodeServerUrl,
        opencodeWorkingDir: cfg.opencodeWorkingDir,
        permissionMode: cfg.permissionMode,
        liveProgress: cfg.liveProgress,
        opencodeServerRunning: isRunning,
      }, null, 2));
    } else {
      console.log("=== OpenCat Status ===");
      console.log("Config file:", getConfigFilePath());
      console.log("Slack Bot Token:", cfg.slackBotToken ? `configured (${cfg.slackBotToken.slice(0, 9)}...)` : "missing");
      console.log("Slack App Token:", cfg.slackAppToken ? `configured (${cfg.slackAppToken.slice(0, 9)}...)` : "missing");
      console.log("OpenCode Server URL:", cfg.opencodeServerUrl);
      console.log("Working Directory:", cfg.opencodeWorkingDir);
      console.log("Permission Mode:", cfg.permissionMode);
      console.log("Live Progress:", cfg.liveProgress ? "enabled" : "disabled");
      console.log("OpenCode Server:", isRunning ? "running" : "stopped");
    }
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

  const { config, startNow } = await resolveConfig({ botToken, appToken });
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
