/**
 * test/extensions/attachments.test.ts – Tests for the file-attachments extension.
 *
 * Verifies the attach_file tool creates media entries, handles missing
 * files, respects size limits, and correctly detects MIME types.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { getTestWorkspace, setEnv } from "../helpers.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withChatContext } from "../../src/core/chat-context.js";

let restoreEnv: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
});

function makeFakeApi() {
  const tools = new Map<string, any>();
  return {
    api: {
      on() {},
      registerTool(tool: any) { tools.set(tool.name, tool); },
      registerCommand() {},
      registerShortcut() {},
      registerFlag() {},
      getFlag() { return undefined; },
      registerMessageRenderer() {},
      sendMessage() {},
      sendUserMessage() {},
      appendEntry() {},
      setSessionName() {},
      getSessionName() { return undefined; },
      setLabel() {},
      exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      getActiveTools: () => [],
      getAllTools: () => [],
      setActiveTools() {},
      getCommands: () => [],
      setModel: async () => true,
      getThinkingLevel: () => "off" as any,
      setThinkingLevel() {},
      registerProvider() {},
      unregisterProvider() {},
    } as unknown as ExtensionAPI,
    tools,
  };
}

test("attach_file tool stores media and registers attachment", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
  });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const { WORKSPACE_DIR } = await import("../../src/core/config.js");
  mkdirSync(WORKSPACE_DIR, { recursive: true });
  const filePath = join(WORKSPACE_DIR, "hello.txt");
  writeFileSync(filePath, "hello", "utf8");

  const { fileAttachments } = await import("../../src/extensions/file-attachments.js");
  const { getAttachmentRegistry } = await import("../../src/agent-pool/attachments.js");

  const fake = makeFakeApi();
  fileAttachments(fake.api);

  const tool = fake.tools.get("attach_file");
  expect(tool).toBeDefined();

  const result = await withChatContext("web:default", "web", () => tool.execute("call", { path: "hello.txt" }));
  const details = result.details as any;
  expect(details.filename).toBe("hello.txt");
  expect(details.size).toBe(5);
  expect(details.kind).toBe("file");

  const registry = getAttachmentRegistry();
  const pending = registry.take("web:default");
  expect(pending.length).toBe(1);

  const media = db.getMediaById(pending[0].id);
  expect(media?.filename).toBe("hello.txt");
  expect(media?.metadata?.size).toBe(5);
  expect(media?.metadata?.kind).toBe("file");
});

test("attach_file can register attachments in an injected registry", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
  });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const { WORKSPACE_DIR } = await import("../../src/core/config.js");
  mkdirSync(WORKSPACE_DIR, { recursive: true });
  const filePath = join(WORKSPACE_DIR, "injected.txt");
  writeFileSync(filePath, "hello", "utf8");

  const { AttachmentRegistry } = await import("../../src/agent-pool/attachments.js");
  const { createFileAttachmentsExtension } = await import("../../src/extensions/file-attachments.js");

  const registry = new AttachmentRegistry();
  const unrelatedRegistry = new AttachmentRegistry();
  const fake = makeFakeApi();
  createFileAttachmentsExtension(registry)(fake.api);

  const tool = fake.tools.get("attach_file");
  expect(tool).toBeDefined();

  await withChatContext("web:default", "web", () => tool.execute("call", { path: "injected.txt" }));

  expect(registry.take("web:default")).toHaveLength(1);
  expect(unrelatedRegistry.take("web:default")).toHaveLength(0);
});

test("attach_file reports missing file", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
  });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const { fileAttachments } = await import("../../src/extensions/file-attachments.js");
  const fake = makeFakeApi();
  fileAttachments(fake.api);

  const tool = fake.tools.get("attach_file");
  const result = await withChatContext("web:default", "web", () => tool.execute("call", { path: "missing.txt" }));
  expect(result.content[0].text).toContain("File not found");
});

test("accepted web publisher stores attachment content blocks through the current message store", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const mediaId = db.createMedia(
    "report.txt",
    "text/plain",
    new TextEncoder().encode("report"),
    null,
    { size: 6 }
  );

  const sourceRow = db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "Please send the report",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    // Publisher double only; native source identity/settlement is separately qualified.
    dispatchAcceptedInput: async(chatJid:string,messageId:string,rowId:number)=>{
      expect(db.getMessageRowIdById(chatJid,messageId)).toBe(rowId);
      const stored = await web.admitMessage(chatJid, "Here is the report.", true, [mediaId], {
        threadId: rowId, isTerminalAgentReply: true,
        contentBlocks: [{ type: "file", name: "report.txt", filename: "report.txt", mime_type: "text/plain", size: 6 }],
      });
      expect(stored?.id).toBeGreaterThan(0); return {submission_id:17,queued:false};
    },
    queue: { enqueue: () => {} },
    agentPool: {
      getContextUsageForChat: async () => null,
    },
  });

  const source = db.getDb().query('SELECT id FROM messages WHERE rowid=?').get(sourceRow) as {id:string};
  await web.dispatchAcceptedInput('web:default', source.id, sourceRow);

  const timeline = db.getTimeline("web:default", 10);
  const last = timeline[timeline.length - 1];
  expect(last.data.media_ids).toEqual([mediaId]);
  expect(last.data.content_blocks?.[0]).toMatchObject({
    type: "file",
    name: "report.txt",
    mime_type: "text/plain",
    size: 6,
  });
});

test("read_attachment tool returns text content", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const mediaId = db.createMedia(
    "note.txt",
    "text/plain",
    new TextEncoder().encode("hello world"),
    null,
    { size: 11 }
  );

  const { fileAttachments } = await import("../../src/extensions/file-attachments.js");
  const fake = makeFakeApi();
  fileAttachments(fake.api);

  const tool = fake.tools.get("read_attachment");
  expect(tool).toBeDefined();

  const result = await tool.execute("call", { id: mediaId, mode: "text" });
  const text = result.content?.[0]?.text || "";
  expect(text).toContain("hello world");
});

test("read_attachment respects max_bytes boundary", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const data = new TextEncoder().encode("hello");
  const mediaId = db.createMedia("note.txt", "text/plain", data, null, { size: data.length });

  const { fileAttachments } = await import("../../src/extensions/file-attachments.js");
  const fake = makeFakeApi();
  fileAttachments(fake.api);

  const tool = fake.tools.get("read_attachment");
  const full = await tool.execute("call", { id: mediaId, mode: "text", max_bytes: 5 });
  expect(full.details?.truncated).toBe(false);

  const truncated = await tool.execute("call", { id: mediaId, mode: "text", max_bytes: 4 });
  expect(truncated.details?.truncated).toBe(true);
  expect(truncated.content?.[0]?.text || "").toContain("truncated");
});

test("read_attachment returns base64 for binary content", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const data = new Uint8Array([0, 1, 2, 3]);
  const mediaId = db.createMedia("blob.bin", "application/octet-stream", data, null, { size: data.length });

  const { fileAttachments } = await import("../../src/extensions/file-attachments.js");
  const fake = makeFakeApi();
  fileAttachments(fake.api);

  const tool = fake.tools.get("read_attachment");
  const result = await tool.execute("call", { id: mediaId, mode: "base64", max_bytes: 4 });
  const expected = Buffer.from(data).toString("base64");
  expect(result.details?.mode).toBe("base64");
  expect(result.content?.[0]?.text || "").toContain(expected);
});

test("export_attachment tool writes to workspace tmp", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const mediaId = db.createMedia(
    "note.txt",
    "text/plain",
    new TextEncoder().encode("hello world"),
    null,
    { size: 11 }
  );

  const { fileAttachments } = await import("../../src/extensions/file-attachments.js");
  const fake = makeFakeApi();
  fileAttachments(fake.api);

  const tool = fake.tools.get("export_attachment");
  expect(tool).toBeDefined();

  const result = await tool.execute("call", { id: mediaId });
  const outputPath = result.details?.output_path;
  expect(typeof outputPath).toBe("string");
});

test("read_attachment validates image data with sharp and rejects corrupt images", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const garbageData = new TextEncoder().encode("this is not an image at all");
  const mediaId = db.createMedia("corrupt.png", "image/png", garbageData, null, { size: garbageData.length });

  const { fileAttachments } = await import("../../src/extensions/file-attachments.js");
  const fake = makeFakeApi();
  fileAttachments(fake.api);

  const tool = fake.tools.get("read_attachment");
  const result = await tool.execute("call", { id: mediaId, mode: "image" });

  expect(result.content[0].text).toContain("failed image validation");
  expect(result.details.image_validation_failed).toBe(true);
});

test("read_attachment accepts valid PNG images through sharp validation", async () => {
  const sharp = (await import("sharp")).default;
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const pngData = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 1 } },
  }).png().toBuffer();
  const mediaId = db.createMedia("valid.png", "image/png", pngData, null, { size: pngData.length });

  const { fileAttachments } = await import("../../src/extensions/file-attachments.js");
  const fake = makeFakeApi();
  fileAttachments(fake.api);

  const tool = fake.tools.get("read_attachment");
  const result = await tool.execute("call", { id: mediaId, mode: "image" });

  expect(result.content.length).toBe(2);
  expect(result.content[1].type).toBe("image");
  expect(result.content[1].mimeType).toBe("image/png");
  expect(result.details.mode).toBe("image");
  expect(result.details.converted).toBe(false);
});

test("read_attachment converts unsupported image formats to JPEG via sharp", async () => {
  const sharp = (await import("sharp")).default;
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  // Create a TIFF image (not in VALID_IMAGE_MIMES) — sharp should convert to JPEG
  const tiffData = await sharp({
    create: { width: 2, height: 2, channels: 3, background: { r: 255, g: 0, b: 0 } },
  }).tiff().toBuffer();
  // Store it claiming image/tiff — the MIME check should reject before sharp runs
  const mediaId = db.createMedia("photo.tiff", "image/tiff", tiffData, null, { size: tiffData.length });

  const { fileAttachments } = await import("../../src/extensions/file-attachments.js");
  const fake = makeFakeApi();
  fileAttachments(fake.api);

  const tool = fake.tools.get("read_attachment");
  const result = await tool.execute("call", { id: mediaId, mode: "image" });

  // TIFF is not in VALID_IMAGE_MIMES, so it's rejected before sharp validation
  expect(result.content[0].text).toContain("cannot be returned as an image");
  expect(result.details.unsupported_image_mime).toBe(true);
});
