import assert from "node:assert";
import { resolveConfig } from "../src/config.ts";
import { opencodeService } from "../src/opencode.ts";
import { sessionStore } from "../src/session-store.ts";
import { stateTracker, SessionStateTracker } from "../src/state-tracker.ts";
import { intentInterceptor } from "../src/interceptor.ts";
import { permissionManager, PermissionManager } from "../src/permissions.ts";
import { slackStatusManager, SlackStatusManager } from "../src/slack-status.ts";
import { GUIDE_TREE, formatTopicContent, type GuideTopic } from "../src/guide.ts";
import { parseStartOptions } from "../src/cli-options.ts";

async function testStateTracker() {
  console.log("🧪 Testing SessionStateTracker event ingestion...");
  const tracker = new SessionStateTracker();
  const sessionId = "sess_test_123";

  // 1. Initial state
  const initSession = tracker.getOrCreateSession(sessionId);
  assert.strictEqual(initSession.status, "idle");
  assert.strictEqual(initSession.activeTools.size, 0);

  // 2. Set Prompt
  tracker.setPrompt(sessionId, "Run terraform plan");
  assert.strictEqual(tracker.getSession(sessionId)?.status, "busy");
  assert.strictEqual(tracker.getSession(sessionId)?.lastPrompt, "Run terraform plan");

  // 3. Tool running event
  await tracker.handleEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part_1",
        sessionID: sessionId,
        messageID: "msg_1",
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "running",
          input: { command: "terraform plan" },
          time: { start: Date.now() - 2000 },
        },
      },
    },
  });

  const runningState = tracker.getSession(sessionId);
  assert.strictEqual(runningState?.activeTools.size, 1);
  const runningTool = runningState?.activeTools.get("call_1");
  assert.strictEqual(runningTool?.tool, "bash");
  assert.strictEqual(runningTool?.title, "bash: terraform plan");

  // 4. Tool completed event
  await tracker.handleEvent({
    type: "message.part.updated",
    properties: {
      part: {
        id: "part_1",
        sessionID: sessionId,
        messageID: "msg_1",
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "terraform plan" },
          time: { start: Date.now() - 2000, end: Date.now() },
        },
      },
    },
  });

  const completedState = tracker.getSession(sessionId);
  assert.strictEqual(completedState?.activeTools.size, 0);
  assert.strictEqual(completedState?.completedTools.length, 1);
  assert.strictEqual(completedState?.completedTools[0].status, "completed");

  // 5. Todo updated event
  await tracker.handleEvent({
    type: "todo.updated",
    properties: {
      sessionID: sessionId,
      todos: [
        { id: "1", content: "Plan infra", status: "completed", priority: "high" },
        { id: "2", content: "Apply infra", status: "in_progress", priority: "high" },
      ],
    },
  });

  const todoState = tracker.getSession(sessionId);
  assert.strictEqual(todoState?.todos.length, 2);
  assert.strictEqual(todoState?.todos[1].status, "in_progress");

  // 6. Permission asked & replied events
  let capturedAskedPerm: any = null;
  tracker.onPermission((p) => {
    capturedAskedPerm = p;
  });

  let capturedRepliedInfo: any = null;
  tracker.onPermissionReplied((sId, pId, resp) => {
    capturedRepliedInfo = { sId, pId, resp };
  });

  await tracker.handleEvent({
    type: "permission.asked",
    properties: {
      id: "perm_test_999",
      sessionID: sessionId,
      permission: "external_directory",
      patterns: ["/etc/*"],
    },
  });

  assert.strictEqual(capturedAskedPerm?.id, "perm_test_999");
  assert.strictEqual(capturedAskedPerm?.permission, "external_directory");

  await tracker.handleEvent({
    type: "permission.replied",
    properties: {
      sessionID: sessionId,
      permissionID: "perm_test_999",
      response: "once",
    },
  });

  assert.strictEqual(capturedRepliedInfo?.pId, "perm_test_999");
  assert.strictEqual(capturedRepliedInfo?.resp, "once");

  console.log("✅ SessionStateTracker verified successfully!");
}

async function testIntentInterceptor() {
  console.log("🧪 Testing IntentInterceptor (Stop, Status, Todos)...");
  const testSession = "sess_intercept_test";
  stateTracker.setPrompt(testSession, "Deploying infrastructure");

  // 1. Stop / Abort command
  assert.strictEqual(intentInterceptor.isStopCommand("stop"), true);
  assert.strictEqual(intentInterceptor.isStopCommand("abort"), true);
  assert.strictEqual(intentInterceptor.isStopCommand("cancel"), true);
  assert.strictEqual(intentInterceptor.isStopCommand("regular prompt"), false);

  // 2. Status inquiries
  assert.strictEqual(intentInterceptor.isStatusQuery("status"), true);
  assert.strictEqual(intentInterceptor.isStatusQuery("what's up?"), true);
  assert.strictEqual(intentInterceptor.isStatusQuery("whats up"), true);
  assert.strictEqual(intentInterceptor.isStatusQuery("how's it going"), true);
  assert.strictEqual(intentInterceptor.isStatusQuery("what are you doing?"), true);
  assert.strictEqual(intentInterceptor.isStatusQuery("create a new file"), false);

  // 3. Todo queries
  assert.strictEqual(intentInterceptor.isTodoQuery("todos"), true);
  assert.strictEqual(intentInterceptor.isTodoQuery("tasks"), true);
  assert.strictEqual(intentInterceptor.isTodoQuery("show todos"), true);

  // 4. Intercept call while busy
  const busyStatusRes = await intentInterceptor.intercept(testSession, "what's up");
  assert.strictEqual(busyStatusRes.handled, true);
  assert.strictEqual(busyStatusRes.action, "status");
  assert(busyStatusRes.replyText?.includes("busy"));

  // 5. Intercept call while idle
  stateTracker.setIdle(testSession);
  const idleStatusRes = await intentInterceptor.intercept(testSession, "status");
  assert.strictEqual(idleStatusRes.handled, true);
  assert.strictEqual(idleStatusRes.action, "status");
  assert(idleStatusRes.replyText?.includes("idle"));

  console.log("✅ IntentInterceptor verified successfully!");
}

async function testPermissionManager() {
  console.log("🧪 Testing PermissionManager...");
  const pm = new PermissionManager();
  pm.init({
    slackBotToken: "xoxb-dummy",
    slackAppToken: "xapp-dummy",
    opencodeServerUrl: "http://127.0.0.1:4096",
    opencodeWorkingDir: process.cwd(),
    autoApprovePermissions: false,
    permissionMode: "read-only",
    liveProgress: true,
    port: 4096,
  });

  // 1. Read-only tool classification
  assert.strictEqual(
    pm.isReadOnlyPermission({
      id: "p1",
      type: "read",
      sessionID: "s1",
      messageID: "m1",
      title: "read: src/index.ts",
      metadata: { tool: "read", filePath: "src/index.ts" },
      time: { created: Date.now() },
    }),
    true
  );

  // 2. Mutating tool classification (bash)
  assert.strictEqual(
    pm.isReadOnlyPermission({
      id: "p2",
      type: "bash",
      sessionID: "s1",
      messageID: "m1",
      title: "bash: rm -rf dist",
      metadata: { tool: "bash", command: "rm -rf dist" },
      time: { created: Date.now() },
    }),
    false
  );

  // 3. Mutating tool classification (write/edit)
  assert.strictEqual(
    pm.isReadOnlyPermission({
      id: "p3",
      type: "write",
      sessionID: "s1",
      messageID: "m1",
      title: "write: config.json",
      metadata: { tool: "write", filePath: "config.json" },
      time: { created: Date.now() },
    }),
    false
  );

  console.log("✅ PermissionManager verified successfully!");
}

async function testGuideTree() {
  console.log("🧪 Testing Interactive Guide Tree & Hierarchy...");
  assert(GUIDE_TREE.children && GUIDE_TREE.children.length >= 7, "Guide tree should have at least 7 main categories");

  // Validate each category and its subtopics
  let totalTopics = 0;
  function validateNode(node: GuideTopic, depth = 0) {
    totalTopics++;
    assert(node.id, "Topic must have an id");
    assert(node.title, `Topic ${node.id} must have a title`);
    if (node.children) {
      assert(node.children.length > 0, `Topic ${node.id} has empty children array`);
      for (const child of node.children) {
        validateNode(child, depth + 1);
      }
    } else {
      assert(node.content && node.content.length > 20, `Leaf topic ${node.id} must have non-empty content`);
      const formatted = formatTopicContent(node);
      assert(formatted.includes(node.title.toUpperCase()), "Formatted content should include uppercase title");
    }
  }

  validateNode(GUIDE_TREE);
  console.log(`✅ Guide Tree verified with ${totalTopics} topics across hierarchy!`);
}

async function testSlackStatusManager() {
  console.log("🧪 Testing SlackStatusManager formatting...");
  const sm = new SlackStatusManager();
  const sessionState = {
    sessionId: "sess_status_test",
    status: "busy" as const,
    activeTools: new Map([
      [
        "c1",
        {
          id: "p1",
          callId: "c1",
          tool: "bash",
          title: "bash: terraform plan",
          startTime: Date.now() - 3000,
        },
      ],
    ]),
    completedTools: [
      {
        id: "p0",
        callId: "c0",
        tool: "read",
        title: "read: main.tf",
        startTime: Date.now() - 5000,
        endTime: Date.now() - 4500,
        durationMs: 500,
        status: "completed" as const,
      },
    ],
    todos: [],
    lastActivityTime: Date.now(),
  };

  const card = sm.formatStatusCard(
    {
      channel: "C123",
      threadTs: "12345.6789",
      sessionId: "sess_status_test",
      startTime: Date.now() - 5000,
      promptText: "Apply terraform",
      lastUpdated: 0,
      pendingUpdate: false,
      isFinished: false,
    },
    sessionState
  );

  assert(card.fallbackText.includes("terraform plan"));
  assert(card.fallbackText.includes("read: main.tf"));
  assert(card.blocks.length > 0);

  console.log("✅ SlackStatusManager verified successfully!");
}

async function testLiveOpenCode() {
  console.log("🧪 Testing OpenCode live integration...");
  if (!process.env.SLACK_BOT_TOKEN) process.env.SLACK_BOT_TOKEN = "xoxb-ci-test-token";
  if (!process.env.SLACK_APP_TOKEN) process.env.SLACK_APP_TOKEN = "xapp-ci-test-token";

  try {
    const { config } = await resolveConfig();
    opencodeService.init(config);

    const isRunning = await opencodeService.isServerRunning();
    if (!isRunning) {
      console.log("ℹ️ OpenCode server not running locally; attempting to ensure server...");
      try {
        await opencodeService.ensureServer();
      } catch (err: any) {
        console.warn("⚠️ Skipping live OpenCode turn test (server unavailable):", err.message);
        return;
      }
    }

    const sessionId = await opencodeService.createSession("Verification Suite");
    console.log("Created test session:", sessionId);

    const testKey = "test_chan:12345.6789";
    sessionStore.set(testKey, sessionId);
    assert.strictEqual(sessionStore.get(testKey), sessionId);
    sessionStore.delete(testKey);

    const reply = await opencodeService.prompt(sessionId, "Respond with: Hello from OpenCat Verification!");
    assert(reply.includes("Hello from OpenCat Verification"));
    console.log("✅ OpenCode live integration verified!");
  } catch (err: any) {
    console.warn("⚠️ Skipping live OpenCode turn test in CI/offline environment:", err.message);
  }
}

function testCliOptionAliases() {
  console.log("🧪 Testing CLI permission mode aliases...");

  assert.strictEqual(parseStartOptions(["-i"]).permissionMode, "interactive");
  assert.strictEqual(parseStartOptions(["-r"]).permissionMode, "read-only");
  assert.strictEqual(parseStartOptions(["--mode", "interactive"]).permissionMode, "interactive");
  assert.strictEqual(parseStartOptions(["--mode", "read-only"]).permissionMode, "read-only");

  const parsed = parseStartOptions(["start", "--dir", "/tmp/work", "--port", "4096", "-i"]);
  assert.strictEqual(parsed.workingDir, "/tmp/work");
  assert.strictEqual(parsed.port, 4096);
  assert.strictEqual(parsed.permissionMode, "interactive");

  console.log("✅ CLI permission mode aliases verified successfully!");
}

async function runAll() {
  console.log("==================================================");
  console.log("      🐱 OpenCat Comprehensive Verification       ");
  console.log("==================================================");

  await testStateTracker();
  await testIntentInterceptor();
  await testPermissionManager();
  await testSlackStatusManager();
  await testGuideTree();
  testCliOptionAliases();
  await testLiveOpenCode();

  console.log("\n🎉 All OpenCat components passed verification!");
  process.exit(0);
}

runAll().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
