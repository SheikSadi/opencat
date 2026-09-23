import type { Permission } from "@opencode-ai/sdk";
import type { Config, PermissionMode } from "./config.ts";
import { opencodeService } from "./opencode.ts";

export interface PendingPermission {
  sessionId: string;
  permissionId: string;
  channel?: string;
  threadTs?: string;
  messageTs?: string;
  permission: Permission;
  createdAt: number;
}

export class PermissionManager {
  private config!: Config;
  private pendingPermissions = new Map<string, PendingPermission>();
  private slackClient: any = null;
  // Map from sessionId to active Slack thread info { channel, threadTs }
  private sessionThreads = new Map<string, { channel: string; threadTs: string }>();

  public init(config: Config, slackClient?: any): void {
    this.config = config;
    if (slackClient) {
      this.slackClient = slackClient;
    }
  }

  public setSlackClient(slackClient: any): void {
    this.slackClient = slackClient;
  }

  public registerSessionThread(sessionId: string, channel: string, threadTs: string): void {
    this.sessionThreads.set(sessionId, { channel, threadTs });
  }

  public isReadOnlyPermission(perm: Permission): boolean {
    const type = (perm.type || "").toLowerCase();
    const title = (perm.title || "").toLowerCase();
    const metadata = (perm.metadata || {}) as Record<string, any>;
    const tool = String(metadata.tool || metadata.name || "").toLowerCase();

    // Explicitly dangerous or mutating tools
    if (
      type === "bash" ||
      tool === "bash" ||
      title.includes("bash") ||
      type === "write" ||
      tool === "write" ||
      title.includes("write") ||
      type === "edit" ||
      tool === "edit" ||
      title.includes("edit") ||
      type === "delete" ||
      tool === "delete" ||
      title.includes("delete")
    ) {
      return false;
    }

    // Known read-only operations
    if (
      type === "read" ||
      type === "glob" ||
      type === "grep" ||
      tool === "read" ||
      tool === "glob" ||
      tool === "grep" ||
      tool === "webfetch" ||
      tool === "fetch" ||
      title.startsWith("read") ||
      title.startsWith("glob") ||
      title.startsWith("grep") ||
      title.startsWith("search") ||
      title.startsWith("list")
    ) {
      return true;
    }

    return false;
  }

  public async handlePermissionRequest(perm: Permission): Promise<void> {
    const mode = this.config?.permissionMode || "auto";
    const sessionId = perm.sessionID;
    const permissionId = perm.id;

    if (!sessionId || !permissionId) return;

    // 1. Auto mode: approve immediately
    if (mode === "auto") {
      console.log(`🔐 [Permission: Auto-Approved] ${perm.title || perm.id} for session ${sessionId}`);
      await opencodeService.respondPermission(sessionId, permissionId, "always");
      return;
    }

    // 2. Read-only mode: auto-approve read tools, prompt for others
    if (mode === "read-only" && this.isReadOnlyPermission(perm)) {
      console.log(`🔐 [Permission: Read-Only Auto-Approved] ${perm.title || perm.id} for session ${sessionId}`);
      await opencodeService.respondPermission(sessionId, permissionId, "always");
      return;
    }

    // 3. Interactive / Manual Approval via Slack
    console.log(`🔐 [Permission: Interactive Request] ${perm.title || perm.id} for session ${sessionId}`);

    const threadInfo = this.sessionThreads.get(sessionId);
    if (!threadInfo || !this.slackClient) {
      // Fallback: If no Slack thread or client is attached, fall back based on mode
      if (mode === "read-only") {
        console.warn("⚠️ No Slack thread mapped for session, rejecting mutating operation in read-only mode.");
        await opencodeService.respondPermission(sessionId, permissionId, "reject");
      } else {
        console.warn("⚠️ No Slack thread mapped for session, auto-approving.");
        await opencodeService.respondPermission(sessionId, permissionId, "once");
      }
      return;
    }

    const { channel, threadTs } = threadInfo;
    const permDetails = this.formatPermissionDetails(perm);

    try {
      const blocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🛡️ *Permission Request:*\n*${perm.title || perm.type || "Tool Execution"}*\n${permDetails}`,
          },
        },
        {
          type: "actions",
          block_id: `perm_actions_${permissionId}`,
          elements: [
            {
              type: "button",
              action_id: "opencat_perm_once",
              text: { type: "plain_text", text: "Allow Once" },
              value: JSON.stringify({ sessionId, permissionId, response: "once" }),
            },
            {
              type: "button",
              action_id: "opencat_perm_always",
              text: { type: "plain_text", text: "Always Allow" },
              style: "primary",
              value: JSON.stringify({ sessionId, permissionId, response: "always" }),
            },
            {
              type: "button",
              action_id: "opencat_perm_reject",
              text: { type: "plain_text", text: "Deny" },
              style: "danger",
              value: JSON.stringify({ sessionId, permissionId, response: "reject" }),
            },
          ],
        },
      ];

      const res = await this.slackClient.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `🛡️ Permission Request: ${perm.title || perm.type || "Tool Execution"}`,
        blocks,
      });

      if (res.ok && res.ts) {
        this.pendingPermissions.set(permissionId, {
          sessionId,
          permissionId,
          channel,
          threadTs,
          messageTs: res.ts,
          permission: perm,
          createdAt: Date.now(),
        });
      }
    } catch (err) {
      console.error("❌ Failed to post permission request to Slack:", err);
    }
  }

  private formatPermissionDetails(perm: Permission): string {
    const meta = (perm.metadata || {}) as Record<string, any>;
    const lines: string[] = [];

    if (meta.command) {
      lines.push(`\`\`\`bash\n${meta.command}\n\`\`\``);
    } else if (meta.filePath) {
      lines.push(`• *Path:* \`${meta.filePath}\``);
    } else if (meta.query) {
      lines.push(`• *Query:* \`${meta.query}\``);
    } else if (perm.pattern) {
      const patternStr = Array.isArray(perm.pattern) ? perm.pattern.join(", ") : perm.pattern;
      lines.push(`• *Pattern:* \`${patternStr}\``);
    }

    return lines.join("\n");
  }

  public async resolvePermission(
    permissionId: string,
    response: "once" | "always" | "reject",
    userId: string
  ): Promise<boolean> {
    const pending = this.pendingPermissions.get(permissionId);
    if (!pending) return false;

    const { sessionId, channel, messageTs, permission } = pending;
    console.log(`🔐 Resolving permission ${permissionId} as '${response}' by user ${userId}`);

    await opencodeService.respondPermission(sessionId, permissionId, response);
    this.pendingPermissions.delete(permissionId);

    // Update Slack card to show resolution
    if (this.slackClient && channel && messageTs) {
      try {
        const icon = response === "reject" ? "🚫" : "✅";
        const actionLabel = response === "reject" ? "Denied" : response === "always" ? "Always Allowed" : "Allowed Once";
        const updateText = `${icon} *Permission ${actionLabel}* by <@${userId}> for *${permission.title || permission.type}*`;

        await this.slackClient.chat.update({
          channel,
          ts: messageTs,
          text: updateText,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: updateText,
              },
            },
          ],
        });
      } catch (err) {
        console.warn("⚠️ Failed to update Slack permission card:", err);
      }
    }

    return true;
  }
}

export const permissionManager = new PermissionManager();
