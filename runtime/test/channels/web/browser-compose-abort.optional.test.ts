import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { chromium, devices, type Browser, type BrowserContext, type Page } from "playwright";
import { startDedicatedWebTestInstance, type DedicatedWebTestInstance } from "./helpers/dedicated-instance.js";

const optionalBrowserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
const CHAT_JID = "web:default";

let instance: DedicatedWebTestInstance | null = null;
let browser: Browser | null = null;
let context: BrowserContext | null = null;

beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== "1") return;
  browser = await chromium.launch({ headless: true });
});

afterEach(async () => {
  await context?.close();
  context = null;
  await instance?.close();
  instance = null;
});

afterAll(async () => {
  await browser?.close();
  browser = null;
});

function seedRootChat(db: any) {
  const now = new Date().toISOString();
  db.storeChatMetadata(CHAT_JID, now, "Mobile Abort Test");
  db.ensureChatBranch({
    chat_jid: CHAT_JID,
    root_chat_jid: CHAT_JID,
    parent_branch_id: null,
    agent_name: "root",
  });
}

function createAbortableAgentPool(db: any) {
  const activeChats = new Set<string>();
  const stopResolvers = new Map<string, () => void>();
  const abortRequests: Array<{ chatJid: string; operationId: string }> = [];
  const stoppedChats = new Set<string>();

  const listChats = () => db.listChatBranches(null).map((branch: any) => ({
    branch_id: branch.branch_id,
    chat_jid: branch.chat_jid,
    root_chat_jid: branch.root_chat_jid,
    parent_branch_id: branch.parent_branch_id,
    agent_name: branch.agent_name,
    display_name: null,
    session_id: null,
    session_name: branch.agent_name,
    model: null,
    is_active: activeChats.has(branch.chat_jid),
    has_side_session: false,
  }));

  const agentPool = {
    isStreaming: (chatJid: string) => activeChats.has(chatJid),
    isActive: (chatJid: string) => activeChats.has(chatJid),
    getContextUsageForChat: async () => null,
    getAvailableModels: async () => ({
      current: null,
      models: [],
      model_options: [],
      thinking_level: null,
      thinking_level_label: null,
      supports_thinking: false,
      available_thinking_levels: [],
      available_thinking_level_labels: [],
      provider_usage: null,
    }),
    getCurrentModelLabel: async () => null,
    listKnownChats: () => listChats(),
    listActiveChats: () => listChats(),
    getAgentHandleForChat: () => "root",
    findChatByAgentName: () => null,
    hasPendingStreamingQueue: () => false,
    runAgent: async (_prompt: string, chatJid: string) => {
      activeChats.add(chatJid);
      try {
        await new Promise<void>((resolve) => stopResolvers.set(chatJid, resolve));
        stoppedChats.add(chatJid);
        return { status: "success", result: null };
      } finally {
        stopResolvers.delete(chatJid);
        activeChats.delete(chatJid);
      }
    },
    cancelOperationAndAbort: async (chatJid: string, expectedOperationId: string, cause = "user_abort") => {
      abortRequests.push({ chatJid, operationId: expectedOperationId });
      const operation = db.getChatOperation(chatJid);
      if (!operation) {
        return { status: "no_op", reason: "no_active_operation", operation: null, physicallyAborted: false };
      }
      if (operation.operationId !== expectedOperationId) {
        return { status: "no_op", reason: "operation_mismatch", operation, physicallyAborted: false };
      }
      const owner = {
        operationId: operation.operationId,
        sourceSeq: operation.sourceSeq,
        phase: operation.phase,
        generation: operation.generation,
      };
      const cancellation = db.cancelChatOperation(chatJid, owner, {
        cause,
        requestedAt: new Date().toISOString(),
      });
      if (cancellation.status !== "applied") {
        return { status: "no_op", reason: cancellation.reason, operation, physicallyAborted: false };
      }
      stopResolvers.get(chatJid)?.();
      return {
        status: "cancelled",
        reason: cancellation.reason,
        operation: cancellation.operation,
        physicallyAborted: true,
      };
    },
    applyControlCommand: async () => ({ status: "error", message: "No legacy operation is active." }),
  };

  return { agentPool, abortRequests, stoppedChats };
}

function chatOnlyUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("chat_jid", CHAT_JID);
  url.searchParams.set("chat_only", "1");
  return url.toString();
}

async function waitForServerOperation(db: any) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const operation = db.getChatOperation(CHAT_JID);
    if (operation) return operation;
    await Bun.sleep(25);
  }
  throw new Error("Timed out waiting for the durable chat operation.");
}

async function waitForCondition(check: () => boolean, message: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await Bun.sleep(25);
  }
  throw new Error(message);
}

async function openMobileChat(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("textarea", { timeout: 15_000 });
}

optionalBrowserTest("mobile Compose Abort refreshes missing authority and stops the exact live turn in one click", async () => {
  let seededDb: any;
  const bootstrapPool: any = { getContextUsageForChat: async () => null };
  instance = await startDedicatedWebTestInstance({
    prefix: "piclaw-browser-mobile-abort-",
    seed: (db) => {
      seededDb = db;
      seedRootChat(db);
    },
    agentPool: bootstrapPool,
  });
  const controlled = createAbortableAgentPool(seededDb);
  Object.assign(bootstrapPool, controlled.agentPool);
  instance.web.agentPool = bootstrapPool;

  context = await browser!.newContext({ ...devices["iPhone 14 Pro"] });
  await context.addInitScript(() => {
    (window as any).__PICLAW_SILENCE_WARNING_MS = 50;
    (window as any).__PICLAW_SILENCE_REFRESH_MS = 50;
    (window as any).__PICLAW_SILENCE_FINALIZE_MS = 120_000;
  });
  const page = await context.newPage();
  await openMobileChat(page, chatOnlyUrl(instance.baseUrl));

  const observedRequests: Array<{ method: string; url: string; body: string | null }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/agent/status" || url.pathname === "/agent/default/message") {
      observedRequests.push({ method: request.method(), url: `${url.pathname}${url.search}`, body: request.postData() });
    }
  });

  await page.locator("textarea").fill("Keep this test turn active until Abort is clicked");
  await page.locator("button.send-btn:not(.abort-mode)").click();

  const operation = await waitForServerOperation(seededDb);
  await page.waitForSelector('[data-testid="stop-button"]', { timeout: 10_000 });

  const authoritativeStatus = await page.evaluate(async (chatJid) => {
    const response = await fetch(`/agent/status?chat_jid=${encodeURIComponent(chatJid)}`);
    return await response.json();
  }, CHAT_JID);
  expect(authoritativeStatus.status).toBe("active");
  expect(authoritativeStatus.data?.operation_id).toBe(operation.operationId);
  expect(authoritativeStatus.data?.operation_authority).toBe("durable");

  // Drive the real silence watchdog into the deployed failure state. Its
  // client-only waiting status keeps Abort mode active but omits authority,
  // while the server status above remains exact and durable.
  await page.waitForFunction(() => document.body.innerText.includes("Waiting for model… No events for"));

  observedRequests.length = 0;
  await page.locator('[data-testid="stop-button"]').click();

  await waitForCondition(
    () => controlled.stoppedChats.has(CHAT_JID),
    "One mobile Abort click did not stop the live agent turn.",
  );
  await page.waitForFunction(() => document.body.innerText.includes("Operation cancellation persisted."));

  const statusRefreshes = observedRequests.filter((request) => request.method === "GET" && request.url.startsWith("/agent/status?"));
  const abortPosts = observedRequests.filter((request) => {
    if (request.method !== "POST" || !request.url.startsWith("/agent/default/message?")) return false;
    const body = JSON.parse(request.body || "{}");
    return body.content === "/abort";
  });
  expect(statusRefreshes).toHaveLength(1);
  expect(abortPosts).toHaveLength(1);
  expect(JSON.parse(abortPosts[0].body || "{}").expected_operation_id).toBe(operation.operationId);
  expect(controlled.abortRequests).toEqual([{ chatJid: CHAT_JID, operationId: operation.operationId }]);

  await waitForCondition(
    () => seededDb.getChatOperationDisposition(operation.sourceSeq)?.outcome === "cancelled",
    "The exact durable operation did not settle as cancelled.",
  );
  expect(await page.locator("body").innerText()).not.toContain("The active operation identity is not available");
});
