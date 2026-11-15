import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SettingsManager } from "../../node_modules/@earendil-works/pi-coding-agent";
import { installCodeReviewFixture } from "./code-review-fixture.ts";
import { loadApplicationExtensionCatalog, qualifyInstalledCodeReview, assertApplicationExtensionCatalogSupported } from "../../runtime/durable-engine/src/host-extension-catalog.ts";
for (const mode of ["approved", "tamper", "shadow", "version"] as const) test(`installed actual Code Review catalog ${mode}`, async () => {
  const dir = mkdtempSync(join(import.meta.dir, ".qualification-review-"));
  const pkg = installCodeReviewFixture(dir), agentDir = join(dir, "agent"); mkdirSync(agentDir);
  if (mode === "tamper") writeFileSync(join(pkg, "tool.ts"), readFileSync(join(pkg, "tool.ts"), "utf8") + "\n// changed\n");
  if (mode === "shadow") writeFileSync(join(pkg, "tool.js"), `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(join(dir, "unqualified-module-io"))}, "BAD");
export function createCodeReviewTool() {}\n`);
  if (mode === "version") { const p = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")); p.version = "0.1.9"; writeFileSync(join(pkg, "package.json"), JSON.stringify(p)); }
  let catalog: Awaited<ReturnType<typeof loadApplicationExtensionCatalog>> | undefined;
  const db = new Database(":memory:");
  try {
    if (mode !== "approved") {
      await expect(loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() })).rejects.toThrow(/Unqualified installed (add-on package|extension source) before evaluation/);
      expect(await Bun.file(join(dir, "unqualified-module-io")).exists()).toBe(false);
      return;
    }
    catalog = await loadApplicationExtensionCatalog({ cwd: dir, agentDir, settingsManager: SettingsManager.inMemory() });
    const q = await qualifyInstalledCodeReview(catalog, dir);
    expect(q).toBeDefined(); assertApplicationExtensionCatalogSupported(catalog, q);
    expect([...q!.extension.handlers.keys()]).toEqual(["resources_discover"]);
    const release = q!.addon.setReviewDatabaseSource({ database: db, assertOwner() {} });
    const service = q!.addon.reviewService() as any;
    const runtime = await import(join(pkg, "runtime.ts"));
    expect(runtime.reviewService()).toBe(service);
    expect(service.database.db).toBe(db);
    expect(() => q!.addon.setReviewDatabaseSource({ database: db, assertOwner() {} })).toThrow("already bound");
    q!.addon.closeReviewServices();
    expect(q!.addon.reviewService()).not.toBe(service); // UI reset retains grant.
    const current = q!.addon.reviewService() as any;
    const who = { ownerId: "default", actorId: "default", kind: "operator", workspaceId: "workspace" };
    const target = { chatId: "web:default", incarnation: "branch", label: "Default" };
    const review = current.createFromCapture(who, { title: "Review", focusPath: "a.ts", target }, {
      workspaceId: "workspace", worktreeId: "tree", mode: "source", base: null, head: null, capturedAt: new Date().toISOString(),
      files: [{ oldPath: null, newPath: "a.ts", oldText: null, newText: "saved\n", change: "source", fileIdentity: "inode" }],
    }, { requestId: "create" });
    const thread = current.createThread(who, review.reviewId, { fileId: review.files[0], side: "source", body: "Concern" }, { requestId: "comment" });
    const dispatch = current.submit(who, review.reviewId, { target, items: [{ threadId: thread.threadId, version: 1 }] }, { requestId: "send" });
    let settle!: (value: any) => void, entered!: () => void;
    const enqueuing = new Promise<void>(resolve => { entered = resolve; });
    const pending = current.deliver(who, dispatch.dispatchId, { enqueue() {
      const receipt = new Promise(resolve => { settle = resolve; }); entered(); return receipt;
    } });
    await enqueuing;
    release(); release();
    expect(() => service.database.get("SELECT 1")).toThrow("closed");
    const releaseNext = q!.addon.setReviewDatabaseSource({ database: db, assertOwner() {} });
    const next = q!.addon.reviewService() as any;
    expect(next.database.db).toBe(db);
    settle({ status: "accepted", rowId: 99 }); await expect(pending).rejects.toThrow("closed");
    expect(next.inspectDispatch(who, dispatch.dispatchId).attempts[0].state).toBe("unknown");
    release(); // Stale release must not revoke the new incarnation.
    expect(q!.addon.reviewService()).toBeDefined(); releaseNext();
    expect(db.query("SELECT 1 AS alive").get()).toEqual({ alive: 1 });
  } finally { catalog?.runtime.invalidate("fixture ended"); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
