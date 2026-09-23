import { opencodeService } from "./opencode.ts";
import { stateTracker, type SessionState } from "./state-tracker.ts";

export interface InterceptResult {
  handled: boolean;
  replyText?: string;
  action?: "abort" | "status" | "todos" | "reset";
}

export class IntentInterceptor {
  private stopPatterns = [
    /^stop$/i,
    /^abort$/i,
    /^cancel$/i,
    /^kill$/i,
    /^halt$/i,
    /^!stop/i,
    /^!abort/i,
    /^!cancel/i,
  ];

  private statusPatterns = [
    /^status$/i,
    /^what'?s up\??$/i,
    /^whats up\??$/i,
    /^what are you doing\??$/i,
    /^what'?re you doing\??$/i,
    /^what are you working on\??$/i,
    /^what is the status\??$/i,
    /^progress\??$/i,
    /^ping$/i,
    /^how'?s it going\??$/i,
    /^how is it going\??$/i,
    /^current status\??$/i,
    /^!status/i,
  ];

  private todoPatterns = [
    /^todos?\??$/i,
    /^tasks?\??$/i,
    /^checklist\??$/i,
    /^show todos?\??$/i,
    /^show tasks?\??$/i,
    /^!todo/i,
    /^!todos/i,
  ];

  public isStopCommand(text: string): boolean {
    const trimmed = text.trim();
    return this.stopPatterns.some((p) => p.test(trimmed));
  }

  public isStatusQuery(text: string): boolean {
    const trimmed = text.trim();
    return this.statusPatterns.some((p) => p.test(trimmed));
  }

  public isTodoQuery(text: string): boolean {
    const trimmed = text.trim();
    return this.todoPatterns.some((p) => p.test(trimmed));
  }

  public async intercept(
    sessionId: string,
    cleanText: string
  ): Promise<InterceptResult> {
    const trimmed = cleanText.trim();

    // 1. Check for Stop / Abort command
    if (this.isStopCommand(trimmed)) {
      console.log(`🛑 Intercepted STOP command for session ${sessionId}`);
      try {
        await opencodeService.abort(sessionId);
        stateTracker.setIdle(sessionId);
        return {
          handled: true,
          action: "abort",
          replyText: `🛑 *OpenCode session aborted.* Ongoing operations have been stopped. Ready for your next instruction!`,
        };
      } catch (err: any) {
        return {
          handled: true,
          action: "abort",
          replyText: `⚠️ Attempted to abort session, but received error: ${err.message || String(err)}`,
        };
      }
    }

    // 2. Check for Instant Status Query
    if (this.isStatusQuery(trimmed)) {
      console.log(`ℹ️ Intercepted STATUS query for session ${sessionId}`);
      const state = stateTracker.getSession(sessionId);
      const isBusy = state?.status === "busy";

      if (isBusy && state) {
        const activeTools = Array.from(state.activeTools.values());
        const elapsedSec = state.lastPromptTime ? Math.max(1, Math.round((Date.now() - state.lastPromptTime) / 1000)) : 0;

        const lines = [
          `⚡ *OpenCode is currently busy* (${elapsedSec}s elapsed)`,
        ];

        if (state.lastPrompt) {
          lines.push(`• *Task:* "${state.lastPrompt.slice(0, 100)}${state.lastPrompt.length > 100 ? "..." : ""}"`);
        }

        if (activeTools.length > 0) {
          lines.push(`• *Active tool:* \`${activeTools[0].title}\``);
        } else {
          lines.push(`• *Status:* 🧠 Processing / Planning`);
        }

        if (state.completedTools.length > 0) {
          lines.push(`• *Completed steps:* ${state.completedTools.length} tool(s) executed`);
        }

        lines.push(`\n_Tip: Reply \`stop\` anytime to cancel this task._`);

        return {
          handled: true,
          action: "status",
          replyText: lines.join("\n"),
        };
      }

      // Idle state
      const lastActiveAgo = state?.lastActivityTime
        ? this.formatTimeAgo(state.lastActivityTime)
        : "recently";

      const lines = [
        `💤 *OpenCode is idle and ready.*`,
        `• *Session:* \`${sessionId}\``,
        `• *Last active:* ${lastActiveAgo}`,
      ];

      if (state?.lastPrompt) {
        lines.push(`• *Last completed task:* "${state.lastPrompt.slice(0, 80)}"`);
      }

      return {
        handled: true,
        action: "status",
        replyText: lines.join("\n"),
      };
    }

    // 3. Check for Todo / Tasks Query
    if (this.isTodoQuery(trimmed)) {
      console.log(`📋 Intercepted TODO query for session ${sessionId}`);
      try {
        const sdkTodos = await opencodeService.getTodos(sessionId);
        const todos = sdkTodos || stateTracker.getSession(sessionId)?.todos || [];

        if (!todos || todos.length === 0) {
          return {
            handled: true,
            action: "todos",
            replyText: `📋 *Todo List:* No active tasks or todos for this session.`,
          };
        }

        const lines = [`📋 *Task List for Session* (\`${sessionId}\`):\n`];
        for (const t of todos) {
          let icon = "⬜";
          if (t.status === "completed") icon = "✅";
          else if (t.status === "in_progress") icon = "⚙️";
          else if (t.status === "cancelled") icon = "❌";

          lines.push(`${icon} *[${t.status.toUpperCase()}]* ${t.content}`);
        }

        return {
          handled: true,
          action: "todos",
          replyText: lines.join("\n"),
        };
      } catch (err: any) {
        return {
          handled: true,
          action: "todos",
          replyText: `⚠️ Could not retrieve todos: ${err.message || String(err)}`,
        };
      }
    }

    return { handled: false };
  }

  private formatTimeAgo(timestamp: number): string {
    const sec = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hours = Math.round(min / 60);
    return `${hours}h ago`;
  }
}

export const intentInterceptor = new IntentInterceptor();
