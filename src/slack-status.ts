import type { SessionState, ActiveToolInfo, CompletedToolInfo } from "./state-tracker.ts";
import { stateTracker } from "./state-tracker.ts";

export interface ThreadStatusSession {
  channel: string;
  threadTs: string;
  sessionId: string;
  statusMessageTs?: string;
  startTime: number;
  promptText: string;
  lastUpdated: number;
  updateTimer?: NodeJS.Timeout;
  pendingUpdate: boolean;
  isFinished: boolean;
}

export class SlackStatusManager {
  private slackClient: any = null;
  private activeThreads = new Map<string, ThreadStatusSession>(); // keyed by sessionId or `${channel}:${threadTs}`
  private minUpdateIntervalMs = 1200; // Debounce interval for Slack rate limits

  public init(slackClient: any): void {
    this.slackClient = slackClient;
    stateTracker.onStateChange((sessionId, state) => {
      this.handleStateChange(sessionId, state);
    });
  }

  public setSlackClient(slackClient: any): void {
    this.slackClient = slackClient;
  }

  public async startStatus(
    channel: string,
    threadTs: string,
    sessionId: string,
    promptText: string
  ): Promise<void> {
    if (!this.slackClient) return;

    const key = `${channel}:${threadTs}`;
    const session: ThreadStatusSession = {
      channel,
      threadTs,
      sessionId,
      startTime: Date.now(),
      promptText,
      lastUpdated: 0,
      pendingUpdate: false,
      isFinished: false,
    };

    this.activeThreads.set(sessionId, session);
    this.activeThreads.set(key, session);

    try {
      const initialText = `⚡ *OpenCat is preparing to execute your request...*`;
      const res = await this.slackClient.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: initialText,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: initialText,
            },
          },
        ],
      });

      if (res.ok && res.ts) {
        session.statusMessageTs = res.ts;
        session.lastUpdated = Date.now();
      }
    } catch (err) {
      console.warn("⚠️ Failed to post initial status message:", err);
    }
  }

  private handleStateChange(sessionId: string, state: SessionState): void {
    const session = this.activeThreads.get(sessionId);
    if (!session || session.isFinished) return;

    this.scheduleUpdate(session, state);
  }

  private scheduleUpdate(session: ThreadStatusSession, state: SessionState): void {
    const now = Date.now();
    const elapsedSinceLast = now - session.lastUpdated;

    if (elapsedSinceLast >= this.minUpdateIntervalMs) {
      this.performUpdate(session, state);
    } else {
      if (!session.pendingUpdate) {
        session.pendingUpdate = true;
        const delay = this.minUpdateIntervalMs - elapsedSinceLast;
        if (session.updateTimer) clearTimeout(session.updateTimer);
        session.updateTimer = setTimeout(() => {
          session.pendingUpdate = false;
          const currentState = stateTracker.getSession(session.sessionId);
          if (currentState && !session.isFinished) {
            this.performUpdate(session, currentState);
          }
        }, delay);
      }
    }
  }

  private async performUpdate(session: ThreadStatusSession, state: SessionState): Promise<void> {
    if (!this.slackClient || !session.statusMessageTs || session.isFinished) return;

    session.lastUpdated = Date.now();
    const formatted = this.formatStatusCard(session, state);

    try {
      await this.slackClient.chat.update({
        channel: session.channel,
        ts: session.statusMessageTs,
        text: formatted.fallbackText,
        blocks: formatted.blocks,
      });
    } catch (err: any) {
      // If message was deleted or rate-limited, handle gracefully
      if (err.data?.error !== "message_not_found") {
        console.warn("⚠️ Failed to update Slack status card:", err.message || err);
      }
    }
  }

  public formatStatusCard(
    session: ThreadStatusSession,
    state: SessionState
  ): { fallbackText: string; blocks: any[] } {
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - session.startTime) / 1000));
    const activeTools = Array.from(state.activeTools.values());
    const recentCompleted = state.completedTools.slice(-3);

    const lines: string[] = [];

    // Header
    lines.push(`⚡ *OpenCat is executing...* (\`${elapsedSeconds}s\`)`);

    // Active tools
    if (activeTools.length > 0) {
      for (const t of activeTools) {
        const toolElapsed = Math.max(1, Math.round((Date.now() - t.startTime) / 1000));
        lines.push(`• ⏳ *Running:* \`${t.title}\` (${toolElapsed}s)`);
      }
    } else if (state.status === "busy") {
      lines.push(`• 🧠 *Thinking:* Deliberating next action...`);
    } else if (state.status === "retry" && state.retryInfo) {
      lines.push(`• 🔄 *Retrying step (attempt ${state.retryInfo.attempt}):* ${state.retryInfo.message}`);
    }

    // Recent completed tools
    if (recentCompleted.length > 0) {
      const completedList = recentCompleted
        .map((t) => {
          const dur = (t.durationMs / 1000).toFixed(1);
          const statusPrefix = t.status === "error" ? "🔴 *Failed:*" : "🟢 *Ran:*";
          return `${statusPrefix} \`${t.title}\` (${dur}s)`;
        })
        .join("\n• ");
      lines.push(`• ${completedList}`);
    }

    // Active Todos if present
    const inProgressTodo = state.todos.find((t) => t.status === "in_progress");
    if (inProgressTodo) {
      lines.push(`📋 *Current Task:* ${inProgressTodo.content}`);
    }

    const fullText = lines.join("\n");

    return {
      fallbackText: fullText,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: fullText,
          },
        },
      ],
    };
  }

  public async finishStatus(sessionId: string, success = true, summary?: string): Promise<void> {
    const session = this.activeThreads.get(sessionId);
    if (!session) return;

    session.isFinished = true;
    if (session.updateTimer) {
      clearTimeout(session.updateTimer);
    }

    if (this.slackClient && session.statusMessageTs) {
      try {
        const elapsedSeconds = Math.max(1, Math.round((Date.now() - session.startTime) / 1000));
        const icon = success ? "🏁" : "⚠️";
        const statusText = summary || (success ? `Finished in ${elapsedSeconds}s` : `Completed with warnings in ${elapsedSeconds}s`);
        const finishMessage = `${icon} *OpenCat:* ${statusText}`;

        await this.slackClient.chat.update({
          channel: session.channel,
          ts: session.statusMessageTs,
          text: finishMessage,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: finishMessage,
              },
            },
          ],
        });
      } catch (err) {
        console.warn("⚠️ Failed to update final status on completion:", err);
      }
    }

    this.activeThreads.delete(sessionId);
    this.activeThreads.delete(`${session.channel}:${session.threadTs}`);
  }
}

export const slackStatusManager = new SlackStatusManager();
