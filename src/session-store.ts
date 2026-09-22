import fs from "node:fs";
import path from "node:path";
import { getConfigDir } from "./config.ts";

export class SessionStore {
  private cache = new Map<string, string>();
  private filePath: string;

  constructor(customPath?: string) {
    if (customPath) {
      this.filePath = customPath;
    } else {
      const configDir = getConfigDir();
      this.filePath = path.join(configDir, "sessions.json");
    }
    this.init();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const json = JSON.parse(raw);
        for (const [k, v] of Object.entries(json)) {
          if (typeof v === "string") {
            this.cache.set(k, v);
          }
        }
      }
    } catch (err) {
      console.warn("⚠️ Warning: Failed to load sessions from file:", err);
    }
  }

  private init() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Backward compatibility: If global sessions.json does not exist yet,
      // check if local ./data/sessions.json exists and import it.
      if (!fs.existsSync(this.filePath)) {
        const localLegacyPath = path.resolve(process.cwd(), "data/sessions.json");
        if (fs.existsSync(localLegacyPath)) {
          try {
            const legacyData = fs.readFileSync(localLegacyPath, "utf-8");
            fs.writeFileSync(this.filePath, legacyData, "utf-8");
          } catch {}
        }
      }

      this.load();
    } catch (err) {
      console.warn("⚠️ Warning: Failed to initialize session store:", err);
    }
  }

  private persist() {
    try {
      const obj: Record<string, string> = {};
      for (const [k, v] of this.cache.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
    } catch (err) {
      console.error("❌ Failed to persist sessions:", err);
    }
  }

  get(key: string): string | undefined {
    this.load();
    return this.cache.get(key);
  }

  set(key: string, sessionId: string): void {
    this.load();
    this.cache.set(key, sessionId);
    this.persist();
  }

  delete(key: string): boolean {
    this.load();
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.persist();
    }
    return deleted;
  }
}

export const sessionStore = new SessionStore();
