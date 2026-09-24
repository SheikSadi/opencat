import type { Part, Permission, Todo, Event, SessionStatus } from "@opencode-ai/sdk";

export interface ActiveToolInfo {
  id: string;
  callId: string;
  tool: string;
  title: string;
  startTime: number;
  input?: Record<string, unknown>;
}

export interface CompletedToolInfo {
  id: string;
  callId: string;
  tool: string;
  title: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  status: "completed" | "error";
  error?: string;
  input?: Record<string, unknown>;
}

export interface SessionState {
  sessionId: string;
  status: "idle" | "busy" | "retry";
  activeTools: Map<string, ActiveToolInfo>;
  completedTools: CompletedToolInfo[];
  todos: Todo[];
  lastActivityTime: number;
  lastPrompt?: string;
  lastPromptTime?: number;
  retryInfo?: { attempt: number; message: string; next: number };
}

export type StateListener = (sessionId: string, state: SessionState) => void;
export type PermissionListener = (permission: any) => void | Promise<void>;
export type PermissionRepliedListener = (sessionId: string, permissionId: string, response: string) => void | Promise<void>;

export class SessionStateTracker {
  private sessions = new Map<string, SessionState>();
  private stateListeners = new Set<StateListener>();
  private permissionListeners = new Set<PermissionListener>();
  private permissionRepliedListeners = new Set<PermissionRepliedListener>();

  public getOrCreateSession(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        sessionId,
        status: "idle",
        activeTools: new Map(),
        completedTools: [],
        todos: [],
        lastActivityTime: Date.now(),
      };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  public getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  public setPrompt(sessionId: string, promptText: string): void {
    const session = this.getOrCreateSession(sessionId);
    session.lastPrompt = promptText;
    session.lastPromptTime = Date.now();
    session.lastActivityTime = Date.now();
    session.status = "busy";
    this.notifyStateListeners(sessionId);
  }

  public setIdle(sessionId: string): void {
    const session = this.getOrCreateSession(sessionId);
    session.status = "idle";
    session.activeTools.clear();
    session.lastActivityTime = Date.now();
    this.notifyStateListeners(sessionId);
  }

  public onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public onPermission(listener: PermissionListener): () => void {
    this.permissionListeners.add(listener);
    return () => this.permissionListeners.delete(listener);
  }

  public onPermissionReplied(listener: PermissionRepliedListener): () => void {
    this.permissionRepliedListeners.add(listener);
    return () => this.permissionRepliedListeners.delete(listener);
  }

  private notifyStateListeners(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    for (const listener of this.stateListeners) {
      try {
        listener(sessionId, state);
      } catch (err) {
        console.error("Error in state change listener:", err);
      }
    }
  }

  public async handleEvent(event: any): Promise<void> {
    if (!event || typeof event !== "object" || !("type" in event)) return;

    const eventType = event.type as string;
    const props = event.properties;

    switch (eventType) {
      case "session.status": {
        if (props?.sessionID && props?.status) {
          const session = this.getOrCreateSession(props.sessionID);
          const st = props.status as SessionStatus;
          session.status = st.type;
          session.lastActivityTime = Date.now();
          if (st.type === "retry") {
            session.retryInfo = {
              attempt: st.attempt,
              message: st.message,
              next: st.next,
            };
          } else {
            session.retryInfo = undefined;
          }
          if (st.type === "idle") {
            session.activeTools.clear();
          }
          this.notifyStateListeners(props.sessionID);
        }
        break;
      }

      case "session.idle": {
        if (props?.sessionID) {
          const session = this.getOrCreateSession(props.sessionID);
          session.status = "idle";
          session.activeTools.clear();
          session.lastActivityTime = Date.now();
          this.notifyStateListeners(props.sessionID);
        }
        break;
      }

      case "message.part.updated": {
        if (props?.part && props.part.type === "tool") {
          const part = props.part;
          const sessionId = part.sessionID;
          if (!sessionId) break;

          const session = this.getOrCreateSession(sessionId);
          session.lastActivityTime = Date.now();

          const toolKey = part.callID || part.id;
          const state = part.state;
          const toolName = part.tool || "tool";

          let title = toolName;
          if (state && typeof state === "object") {
            if ("title" in state && state.title) {
              title = String(state.title);
            } else if (toolName === "bash" && state.input && typeof state.input === "object" && "command" in state.input) {
              title = `bash: ${String((state.input as any).command).slice(0, 80)}`;
            } else if (state.input && typeof state.input === "object" && "filePath" in state.input) {
              title = `${toolName}: ${String((state.input as any).filePath).slice(0, 60)}`;
            }
          }

          if (state?.status === "running") {
            session.activeTools.set(toolKey, {
              id: part.id,
              callId: part.callID,
              tool: toolName,
              title,
              startTime: (state as any).time?.start || Date.now(),
              input: state.input as Record<string, unknown>,
            });
            this.notifyStateListeners(sessionId);
          } else if (state?.status === "completed") {
            const running = session.activeTools.get(toolKey);
            const startTime = running?.startTime || (state as any).time?.start || Date.now();
            const endTime = (state as any).time?.end || Date.now();

            session.activeTools.delete(toolKey);
            session.completedTools.push({
              id: part.id,
              callId: part.callID,
              tool: toolName,
              title,
              startTime,
              endTime,
              durationMs: Math.max(0, endTime - startTime),
              status: "completed",
              input: state.input as Record<string, unknown>,
            });

            // Keep completed tools bounded to last 50
            if (session.completedTools.length > 50) {
              session.completedTools.shift();
            }

            this.notifyStateListeners(sessionId);
          } else if (state?.status === "error") {
            const running = session.activeTools.get(toolKey);
            const startTime = running?.startTime || (state as any).time?.start || Date.now();
            const endTime = (state as any).time?.end || Date.now();

            session.activeTools.delete(toolKey);
            session.completedTools.push({
              id: part.id,
              callId: part.callID,
              tool: toolName,
              title,
              startTime,
              endTime,
              durationMs: Math.max(0, endTime - startTime),
              status: "error",
              error: (state as any).error,
              input: state.input as Record<string, unknown>,
            });

            this.notifyStateListeners(sessionId);
          }
        }
        break;
      }

      case "todo.updated": {
        if (props?.sessionID && Array.isArray(props.todos)) {
          const session = this.getOrCreateSession(props.sessionID);
          session.todos = props.todos as Todo[];
          session.lastActivityTime = Date.now();
          this.notifyStateListeners(props.sessionID);
        }
        break;
      }

      case "permission.asked":
      case "permission.updated": {
        if (props?.id && props?.sessionID) {
          const perm = props as any;
          for (const listener of this.permissionListeners) {
            try {
              await listener(perm);
            } catch (err) {
              console.error("Error in permission listener:", err);
            }
          }
        }
        break;
      }

      case "permission.replied": {
        if (props?.permissionID && props?.sessionID) {
          for (const listener of this.permissionRepliedListeners) {
            try {
              await listener(props.sessionID, props.permissionID, props.response);
            } catch (err) {
              console.error("Error in permission replied listener:", err);
            }
          }
        }
        break;
      }
    }
  }
}

export const stateTracker = new SessionStateTracker();
