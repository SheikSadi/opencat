import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import dotenv from "dotenv";

import { installHandoffSkill, installShellIntegration } from "./skill.ts";

// Load local .env if present
dotenv.config();

export interface Config {
  slackBotToken: string;
  slackAppToken: string;
  opencodeServerUrl: string;
  opencodeWorkingDir: string;
  autoApprovePermissions: boolean;
  port: number;
  defaultChannel?: string;
}

export interface SetupResult {
  config: Config;
  startNow: boolean;
}

export function getConfigDir(): string {
  const dir = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "opencat")
    : path.join(os.homedir(), ".config", "opencat");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getConfigFilePath(): string {
  return path.join(getConfigDir(), "config.json");
}

export function loadSavedConfig(): Partial<Config> {
  const filePath = getConfigFilePath();
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    } catch (err) {
      console.warn("⚠️ Warning: Failed to parse saved config at", filePath, err);
    }
  }
  return {};
}

export function saveConfig(cfg: Partial<Config>): void {
  const filePath = getConfigFilePath();
  const existing = loadSavedConfig();
  const merged = { ...existing, ...cfg };
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export async function verifySlackToken(botToken: string): Promise<{
  ok: boolean;
  user?: string;
  team?: string;
  scopes?: string[];
  error?: string;
}> {
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const data: any = await res.json();
    if (!data.ok) {
      return { ok: false, error: data.error || "Invalid token" };
    }
    const scopesHeader = res.headers.get("x-oauth-scopes") || "";
    const scopes = scopesHeader.split(",").map((s) => s.trim()).filter(Boolean);
    return { ok: true, user: data.user, team: data.team, scopes };
  } catch (err: any) {
    return { ok: false, error: err.message || "Network error" };
  }
}

export async function runInteractiveSetup(): Promise<SetupResult> {
  const rl = readline.createInterface({ input, output });
  console.log("\n=======================================================");
  console.log("       🐱 OpenCat - Slack Agent Setup Wizard           ");
  console.log("=======================================================");
  console.log("To connect OpenCat with your personal Slack bot, you need:");
  console.log("1. Bot User OAuth Token (starts with xoxb-)");
  console.log("2. App-Level Token for Socket Mode (starts with xapp-)\n");
  console.log("💡 Tip: Run 'npx @elelem/opencat manifest' to get the 1-click Slack app manifest.\n");

  const existing = loadSavedConfig();

  const promptToken = async (
    prompt: string,
    existingVal?: string,
    validator?: (v: string) => boolean
  ): Promise<string> => {
    while (true) {
      const defaultHint = existingVal ? ` [Press Enter to keep current: ...${existingVal.slice(-6)}]` : "";
      const answer = (await rl.question(`${prompt}${defaultHint}: `)).trim();
      const val = answer || existingVal || "";
      if (!val) {
        console.log("❌ Value cannot be empty. Please try again.");
        continue;
      }
      if (validator && !validator(val)) {
        console.log("⚠️ Value does not appear to match expected format. Please verify.");
      }
      return val;
    }
  };

  const slackBotToken = await promptToken(
    "Enter Slack Bot Token (xoxb-...)",
    existing.slackBotToken,
    (v) => v.startsWith("xoxb-")
  );

  console.log("🔄 Verifying Bot Token with Slack...");
  const authCheck = await verifySlackToken(slackBotToken);
  if (authCheck.ok) {
    console.log(`🤖 Verified! Connected as @${authCheck.user} in workspace '${authCheck.team}'`);
    if (authCheck.scopes && !authCheck.scopes.includes("reactions:write")) {
      console.log("⚠️ Notice: Bot lacks 'reactions:write' scope in Slack.");
      console.log("   Emoji reactions (👀, ✅) will be disabled until you add it in OAuth & Permissions.");
    }
  } else {
    console.log(`⚠️ Warning: Slack verification returned '${authCheck.error}'. Please double check the token.`);
  }

  const slackAppToken = await promptToken(
    "\nEnter Slack App-Level Token (xapp-...)",
    existing.slackAppToken,
    (v) => v.startsWith("xapp-")
  );

  const serverUrl = process.env.OPENCODE_SERVER_URL || existing.opencodeServerUrl || "http://127.0.0.1:4096";
  const parsedUrl = new URL(serverUrl);

  const resolvedConfig: Config = {
    slackBotToken,
    slackAppToken,
    opencodeServerUrl: serverUrl,
    opencodeWorkingDir: process.env.OPENCODE_WORKING_DIR || existing.opencodeWorkingDir || process.cwd(),
    autoApprovePermissions: existing.autoApprovePermissions ?? true,
    port: parseInt(parsedUrl.port || "4096", 10),
  };

  saveConfig(resolvedConfig);
  console.log(`\n✅ Configuration saved to: ${getConfigFilePath()}`);

  const skillInstalled = installHandoffSkill();
  if (skillInstalled) {
    console.log("✨ Installed OpenCode handoff skill in ~/.config/opencode/skills/opencat/SKILL.md");
  }

  const syncAnswer = (
    await rl.question("\n🔄 Enable live PC terminal sync with Slack? [Recommended] (Y/n): ")
  )
    .trim()
    .toLowerCase();
  const enableSync = syncAnswer === "" || syncAnswer === "y" || syncAnswer === "yes";
  if (enableSync) {
    const installed = installShellIntegration();
    if (installed) {
      console.log("⚡ Enabled live terminal sync in ~/.bashrc / ~/.zshrc (transparent auto-attach)");
    }
  }

  const startAnswer = (await rl.question("\n🚀 Would you like to start OpenCat now? (Y/n): ")).trim().toLowerCase();
  rl.close();

  const startNow = startAnswer === "" || startAnswer === "y" || startAnswer === "yes";

  if (!startNow) {
    console.log("\n=======================================================");
    console.log("                   Next Steps                          ");
    console.log("=======================================================");
    console.log("1. Start OpenCat anytime with:");
    console.log("   npx @elelem/opencat\n");
    console.log("2. In Slack:");
    console.log("   • Send a Direct Message to your bot");
    console.log("   • Or invite it to a channel: /invite @<bot-name>");
    console.log("   • Send instructions, e.g. 'check git status and run tests'\n");
  }

  return { config: resolvedConfig, startNow };
}

export async function resolveConfig(options: { forceSetup?: boolean } = {}): Promise<SetupResult> {
  if (options.forceSetup) {
    return runInteractiveSetup();
  }

  // 1. Check process.env (or .env)
  let botToken = process.env.SLACK_BOT_TOKEN;
  let appToken = process.env.SLACK_APP_TOKEN;

  // 2. Check saved file config
  const saved = loadSavedConfig();
  if (!botToken && saved.slackBotToken) {
    botToken = saved.slackBotToken;
  }
  if (!appToken && saved.slackAppToken) {
    appToken = saved.slackAppToken;
  }

  // 3. If missing, prompt interactively if running in TTY
  if (!botToken || !appToken) {
    if (process.stdin.isTTY) {
      return runInteractiveSetup();
    }

    console.error("❌ Error: Missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN.");
    console.error("Please provide them via environment variables, a local .env file,");
    console.error("or run 'npx @elelem/opencat setup' to configure them interactively.");
    process.exit(1);
  }

  const serverUrl = process.env.OPENCODE_SERVER_URL || saved.opencodeServerUrl || "http://127.0.0.1:4096";
  const parsedUrl = new URL(serverUrl);

  return {
    config: {
      slackBotToken: botToken,
      slackAppToken: appToken,
      opencodeServerUrl: serverUrl,
      opencodeWorkingDir: process.env.OPENCODE_WORKING_DIR || saved.opencodeWorkingDir || process.cwd(),
      autoApprovePermissions: (process.env.AUTO_APPROVE_PERMISSIONS ?? saved.autoApprovePermissions ?? "true") !== "false",
      port: parseInt(parsedUrl.port || "4096", 10),
      defaultChannel: process.env.SLACK_DEFAULT_CHANNEL || saved.defaultChannel,
    },
    startNow: true,
  };
}
