import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function installHandoffSkill(): boolean {
  try {
    const skillsDir = path.join(os.homedir(), ".config", "opencode", "skills", "opencat");
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    const skillPath = path.join(skillsDir, "SKILL.md");
    const content = `---
name: opencat-handoff
description: Handoff the active OpenCode PC session to Slack so the user can continue prompting from their mobile phone or laptop.
---

# OpenCat Session Handoff to Slack

Use this skill when:
- The user asks to "send a Slack notification", "notify me on Slack", "ping me on Slack", or "handoff to Slack".
- The user indicates they are stepping away from their computer or want to continue the session from mobile/Slack.

## Action
Run the following bash command using the \`bash\` tool:
\`\`\`bash
npx @sheiksadi/opencat handoff --message "<A concise summary of what was accomplished and what the next prompt or action could be>"
\`\`\`
`;

    fs.writeFileSync(skillPath, content, "utf-8");
    return true;
  } catch {
    return false;
  }
}

export function installShellIntegration(): boolean {
  const markerStart = "# >>> OpenCat shell integration >>>";
  const markerEnd = "# <<< OpenCat shell integration <<<";
  const block = `
${markerStart}
# Transparently attach to shared OpenCode server when OpenCat is running
opencode() {
  if curl -s -m 0.2 http://127.0.0.1:4096/project > /dev/null 2>&1; then
    command opencode attach http://127.0.0.1:4096 "$@"
  else
    command opencode "$@"
  fi
}
${markerEnd}
`;

  let modified = false;
  const home = os.homedir();
  const targets = [path.join(home, ".bashrc"), path.join(home, ".zshrc")];

  for (const rcFile of targets) {
    if (!fs.existsSync(rcFile)) continue;
    try {
      let content = fs.readFileSync(rcFile, "utf-8");
      if (content.includes(markerStart)) {
        const regex = new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`, "g");
        content = content.replace(regex, block.trim());
      } else {
        content = content + "\n" + block;
      }
      fs.writeFileSync(rcFile, content, "utf-8");
      modified = true;
    } catch {}
  }
  return modified;
}
