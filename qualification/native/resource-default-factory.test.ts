import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import "./src/test-guard.js";
import { expect } from "bun:test";
const applicationTest = isolatedApplicationTest(import.meta.url);
import { cpSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { storeChatMetadata } from "../../runtime/src/db.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { createDefaultApplicationRuntime } from "../../runtime/durable-engine/src/default-application-runtime.js";
import { admitAddonLocalRequest } from "../../runtime/src/addons/local-context.js";
import { handleRegisteredAddonConfigApiRequest } from "../../runtime/src/channels/web/handlers/addon-config-api.js";

applicationTest("actual eight-resource factory uses owned native Root dashboard and reopens registration", async () => {
  const source = process.env.DURABLE_ADDONS_ROOT;
  if (!source) throw Error("DURABLE_ADDONS_ROOT required");
  const workspace = process.env.PICLAW_WORKSPACE!;
  for (const kind of ["diagram-tools", "export-timeline-pdf", "kanban-editor", "yolo-vibe", "mindmap", "web-viewer", "eml-viewer", "session-dashboard"]) {
    const pkg = join(workspace, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-" + kind);
    cpSync(join(source, "addons", kind), pkg, { recursive: true, filter: p => !p.split("/").includes("node_modules") });
    symlinkSync(join(import.meta.dir, "../../node_modules"), join(pkg, "node_modules"));
  }
  process.env.PICLAW_DB_IN_MEMORY = "0"; initDatabase();
  storeChatMetadata("web:resource-factory", new Date().toISOString());
  const owner = acquireRuntimeLock({ lockPath: join(workspace, "resource-owner.lock"), strictOwnership: true, disabled: false });
  const model = { provider: "synthetic", id: "approved", name: "Approved", api: "openai-completions", baseUrl: "https://invalid.invalid", input: ["text"], reasoning: false, contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const services = { modelRuntime: { getPhysicalModel: () => model }, modelRegistry: { getAvailable: () => [model] } } as any;
  const getDashboardRootCurrent = async (authorized = true) => {
    const req = new Request("http://fixture/agent/addons/api/session-dashboard/sessions");
    if (authorized) admitAddonLocalRequest(req, { userId: "default", mode: "single-user" } as any, () => true);
    return handleRegisteredAddonConfigApiRequest(req, "session-dashboard", "sessions", (body, status = 200) => Response.json(body, { status }));
  };
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined;
  try {
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    getDb().query("INSERT INTO messages(id,chat_jid,sender,content,timestamp,is_bot_message) VALUES (?,?,?,?,?,?)")
      .run("native-dashboard-output", "web:resource-factory", "assistant", "Native SDK 1.3 Root projection", new Date().toISOString(), 1);
    const response = await getDashboardRootCurrent(); expect(response?.status).toBe(200);
    const body = await response!.json() as any;
    expect(body.ok).toBe(true);
    const row = body.sessions.find((r: any) => r.chat_jid === "web:resource-factory");
    expect(row).toBeTruthy();
    expect(row.summary).toBe("Native SDK 1.3 Root projection");
    expect(row.conversation_id).toBeTruthy();
    expect(row.session_id).toBeTruthy();
    expect(getDb().query("SELECT 1 FROM conversations WHERE id=?").get(Number(row.conversation_id))).toBeTruthy();
    expect((await getDashboardRootCurrent(false))?.status).not.toBe(200);
    getDb().query("DELETE FROM messages WHERE id=?").run("native-dashboard-output");
    await backend.close(); backend = undefined;
    expect(await getDashboardRootCurrent()).toBeNull();
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    expect((await getDashboardRootCurrent())?.status).toBe(200);
  } finally { await backend?.close(); owner.release(); await closeDatabase(); }
});
