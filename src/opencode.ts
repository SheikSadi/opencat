import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import type { Config } from "./config.ts";

export class OpenCodeService {
  public client!: OpencodeClient;
  private config!: Config;
  private serverProcess: ChildProcess | null = null;
  private eventStreamActive = false;

  public init(config: Config): void {
    this.config = config;
    this.client = createOpencodeClient({
      baseUrl: config.opencodeServerUrl,
      directory: config.opencodeWorkingDir,
    });
  }

  async isServerRunning(): Promise<boolean> {
    if (!this.config) return false;
    try {
      const res = await fetch(`${this.config.opencodeServerUrl}/project`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async ensureServer(): Promise<void> {
    if (!this.config) {
      throw new Error("OpenCodeService must be initialized with config before ensuring server.");
    }

    const running = await this.isServerRunning();
    if (running) {
      console.log(`✅ OpenCode server is already running at ${this.config.opencodeServerUrl}`);
      this.startEventWatcher();
      return;
    }

    // Resolve PATH to include user's opencode bin directory
    const userHome = os.homedir();
    const extraPaths = [
      path.join(userHome, ".opencode", "bin"),
      path.join(userHome, ".local", "bin"),
      "/usr/local/bin",
    ].filter((p) => fs.existsSync(p));

    const combinedPath = [...extraPaths, process.env.PATH || ""].join(path.delimiter);

    console.log(`🚀 Starting OpenCode headless server on port ${this.config.port}...`);
    this.serverProcess = spawn(
      "opencode",
      ["serve", "--port", String(this.config.port), "--hostname", "127.0.0.1"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
        env: {
          ...process.env,
          PATH: combinedPath,
        },
      }
    );

    this.serverProcess.stdout?.on("data", (data) => {
      const line = data.toString().trim();
      if (line) console.log(`[opencode-server]: ${line}`);
    });

    this.serverProcess.stderr?.on("data", (data) => {
      const line = data.toString().trim();
      if (line) console.error(`[opencode-server-err]: ${line}`);
    });

    this.serverProcess.on("exit", (code) => {
      console.warn(`[opencode-server] Process exited with code ${code}`);
      this.serverProcess = null;
    });

    // Wait for server to become healthy
    const startTime = Date.now();
    while (Date.now() - startTime < 15000) {
      if (await this.isServerRunning()) {
        console.log(`✅ OpenCode server is ready at ${this.config.opencodeServerUrl}`);
        this.startEventWatcher();
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    throw new Error(
      `OpenCode server failed to start within 15 seconds. Ensure 'opencode' CLI is installed and accessible in PATH.`
    );
  }

  startEventWatcher(): void {
    if (this.eventStreamActive || !this.config.autoApprovePermissions) return;
    this.eventStreamActive = true;

    (async () => {
      while (true) {
        try {
          const res = await this.client.event.subscribe();
          for await (const event of res.stream) {
            // Check for permission update events
            if (event && typeof event === "object" && "type" in event) {
              if (event.type === "permission.updated" && "properties" in event) {
                const perm = (event as any).properties;
                if (perm?.id && perm?.sessionID) {
                  console.log(
                    `🔐 Auto-approving permission: ${perm.title || perm.id} for session ${perm.sessionID}`
                  );
                  await this.client
                    .postSessionIdPermissionsPermissionId({
                      path: {
                        id: perm.sessionID,
                        permissionID: perm.id,
                      },
                      body: {
                        response: "always",
                      },
                    })
                    .catch((err) => {
                      console.warn(`⚠️ Failed to auto-approve permission:`, err);
                    });
                }
              }
            }
          }
        } catch {
          // SSE stream closed or disconnected; wait before retrying
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    })().catch((err) => {
      console.error("Fatal error in event watcher:", err);
      this.eventStreamActive = false;
    });
  }

  async createSession(title: string): Promise<string> {
    const res = await this.client.session.create({
      body: { title },
      query: { directory: this.config.opencodeWorkingDir },
    });

    if (!res.data?.id) {
      throw new Error(`Failed to create session: ${JSON.stringify(res.error || "unknown error")}`);
    }

    return res.data.id;
  }

  async prompt(sessionId: string, messageText: string): Promise<string> {
    const res = await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: messageText }],
      },
      query: { directory: this.config.opencodeWorkingDir },
    });

    if (res.error) {
      throw new Error(`OpenCode error: ${JSON.stringify(res.error)}`);
    }

    const parts = res.data?.parts || [];
    const textParts = parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .filter(Boolean);

    if (textParts.length > 0) {
      return textParts.join("\n\n");
    }

    // Check if tools were executed without a text summary
    const toolParts = parts.filter((p) => p.type === "tool");
    if (toolParts.length > 0) {
      return `✅ OpenCode executed ${toolParts.length} tool(s) successfully.`;
    }

    return "✅ Instruction processed by OpenCode.";
  }

  stopServer(): void {
    if (this.serverProcess) {
      console.log("🛑 Stopping spawned OpenCode server process...");
      this.serverProcess.kill("SIGTERM");
      this.serverProcess = null;
    }
  }
}

export const opencodeService = new OpenCodeService();
