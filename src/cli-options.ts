import type { PermissionMode } from "./config.ts";

export function parseStartOptions(args: string[]): {
  workingDir?: string;
  port?: number;
  permissionMode?: PermissionMode;
} {
  let workingDir: string | undefined;
  let port: number | undefined;
  let permissionMode: PermissionMode | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir" && args[i + 1]) {
      workingDir = args[i + 1];
      i++;
    } else if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--mode" && args[i + 1]) {
      permissionMode = args[i + 1] as PermissionMode;
      i++;
    } else if (args[i] === "-i") {
      permissionMode = "interactive";
    } else if (args[i] === "-r") {
      permissionMode = "read-only";
    }
  }

  return { workingDir, port, permissionMode };
}
