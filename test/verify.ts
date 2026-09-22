import { resolveConfig } from "../src/config.ts";
import { opencodeService } from "../src/opencode.ts";
import { sessionStore } from "../src/session-store.ts";

async function runTest() {
  console.log("1. Resolving configuration and ensuring server is running...");
  const { config } = await resolveConfig();
  opencodeService.init(config);
  await opencodeService.ensureServer();
  const isHealthy = await opencodeService.isServerRunning();
  console.log("Server running:", isHealthy);

  console.log("2. Creating test session...");
  const sessionId = await opencodeService.createSession("Verification Session");
  console.log("Created session:", sessionId);

  console.log("3. Testing session store...");
  const testKey = "test_channel:12345.6789";
  sessionStore.set(testKey, sessionId);
  const retrieved = sessionStore.get(testKey);
  if (retrieved !== sessionId) throw new Error("SessionStore mismatch!");
  console.log("SessionStore verified:", retrieved);

  console.log("4. Prompting OpenCode...");
  const reply = await opencodeService.prompt(sessionId, "Please respond with 'Verification Successful!'");
  console.log("OpenCode reply:", reply);

  if (!reply.includes("Verification Successful")) {
    throw new Error(`Unexpected reply: ${reply}`);
  }

  console.log("5. Cleaning up test session store entry...");
  sessionStore.delete(testKey);

  console.log("🎉 All components verified successfully!");
  process.exit(0);
}

runTest().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
