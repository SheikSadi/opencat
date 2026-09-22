import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveConfig, type Config } from "./config.ts";
import { sessionStore } from "./session-store.ts";

export interface HandoffOptions {
  message?: string;
  channel?: string;
  sessionId?: string;
  workingDir?: string;
}

export async function resolveActiveSession(serverUrl: string, targetDir: string): Promise<string> {
  try {
    const res = await fetch(`${serverUrl}/session`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      throw new Error(`OpenCode server returned HTTP ${res.status}`);
    }
    const sessions: any[] = await res.json();
    if (!Array.isArray(sessions) || sessions.length === 0) {
      throw new Error("No sessions found in OpenCode.");
    }

    // Sort by updated time descending
    sessions.sort((a, b) => (b.time?.updated || 0) - (a.time?.updated || 0));

    // Prefer session matching current directory
    const dirMatch = sessions.find((s) => s.directory === targetDir || targetDir.startsWith(s.directory || ""));
    if (dirMatch) {
      return dirMatch.id;
    }

    // Fall back to most recently updated session
    return sessions[0].id;
  } catch (err: any) {
    throw new Error(`Failed to resolve active OpenCode session: ${err.message}`);
  }
}

export async function resolveDestinationChannel(botToken: string, explicitChannel?: string, defaultChannel?: string): Promise<string> {
  if (explicitChannel) return explicitChannel;
  if (defaultChannel) return defaultChannel;

  // 1. Look for DM channels with users
  try {
    const res = await fetch("https://slack.com/api/conversations.list?types=im", {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const data: any = await res.json();
    if (data.ok && Array.isArray(data.channels)) {
      const userDMs = data.channels.filter((c: any) => c.user && c.user !== "USLACKBOT");
      if (userDMs.length > 0) {
        return userDMs[0].id;
      }
    }
  } catch {}

  // 2. Look for public/private channels the bot is member of
  try {
    const res = await fetch("https://slack.com/api/conversations.list?types=public_channel,private_channel", {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const data: any = await res.json();
    if (data.ok && Array.isArray(data.channels)) {
      const memberChannels = data.channels.filter((c: any) => c.is_member);
      if (memberChannels.length > 0) {
        return memberChannels[0].id;
      }
      if (data.channels.length > 0) {
        return data.channels[0].id;
      }
    }
  } catch {}

  throw new Error(
    "No destination channel found. Please open a Direct Message with your bot in Slack or specify --channel <channelId>."
  );
}

export async function executeHandoff(options: HandoffOptions = {}): Promise<{
  sessionId: string;
  channel: string;
  ts: string;
}> {
  const { config } = await resolveConfig();
  const cwd = options.workingDir || process.cwd();

  // 1. Determine session ID
  let sessionId = options.sessionId;
  if (!sessionId) {
    sessionId = await resolveActiveSession(config.opencodeServerUrl, cwd);
  }

  // 2. Determine destination channel
  const channel = await resolveDestinationChannel(config.slackBotToken, options.channel, config.defaultChannel);

  // 3. Post handoff notification
  const summary = options.message || "Session handed off from PC. Ready for your instructions!";
  const text = [
    `📱 *OpenCat Hand-off* (Active PC Session)`,
    `> ${summary}`,
    ``,
    `_Reply directly in this thread from Slack to continue this session!_`,
  ].join("\n");

  const postRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.slackBotToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      text,
    }),
  });

  const postData: any = await postRes.json();
  if (!postData.ok) {
    throw new Error(`Slack API error: ${postData.error || "Failed to post handoff message"}`);
  }

  const ts = postData.ts;

  // 4. Map the thread to the session
  sessionStore.set(`${channel}:${ts}`, sessionId);

  return { sessionId, channel, ts };
}

export { installHandoffSkill } from "./skill.ts";
