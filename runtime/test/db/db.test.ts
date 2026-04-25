/**
 * test/db/db.test.ts – Tests for database initialisation and core operations.
 *
 * Verifies initDatabase(), schema migrations, message CRUD, media storage,
 * task management, and interaction queries.
 */

import Database from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, expect, test } from "bun:test";
import { createTempWorkspace, getTestWorkspace, setEnv } from "../helpers.js";

let db: typeof import("../../src/db.js");

beforeAll(async () => {
  const ws = getTestWorkspace();
  setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
  });

  db = await import("../../src/db.js");
  db.initDatabase();
});

function makeMessage(chatJid: string, content: string, timestamp: string, isBot = false) {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chat_jid: chatJid,
    sender: isBot ? "bot" : "user",
    sender_name: isBot ? "Bot" : "User",
    content,
    timestamp,
    is_from_me: false,
    is_bot_message: isBot,
  };
}

test("chat branch registry creates first-class branch rows with unique agent handles", () => {
  const rootChatJid = `web:test-root-${Date.now()}`;
  db.storeChatMetadata(rootChatJid, new Date().toISOString(), "Root");
  const root = db.getChatBranchByChatJid(rootChatJid);
  expect(root).not.toBeNull();
  expect(root?.root_chat_jid).toBe(rootChatJid);
  expect(root?.agent_name).toBeTruthy();

  const childA = db.ensureChatBranch({
    chat_jid: `${rootChatJid}:branch:a`,
    root_chat_jid: rootChatJid,
    parent_branch_id: root?.branch_id ?? null,
    agent_name: root?.agent_name,
  });
  const childB = db.ensureChatBranch({
    chat_jid: `${rootChatJid}:branch:b`,
    root_chat_jid: rootChatJid,
    parent_branch_id: root?.branch_id ?? null,
    agent_name: root?.agent_name,
  });

  expect(childA.root_chat_jid).toBe(rootChatJid);
  expect(childA.parent_branch_id).toBe(root?.branch_id ?? null);
  expect(childB.root_chat_jid).toBe(rootChatJid);
  expect(childB.parent_branch_id).toBe(root?.branch_id ?? null);
  expect(childA.agent_name).not.toBe(childB.agent_name);
  expect(db.getChatBranchByAgentName(childA.agent_name)?.chat_jid).toBe(childA.chat_jid);
  expect(db.getChatBranchByAgentName(childB.agent_name)?.chat_jid).toBe(childB.chat_jid);
});

test("chat branch registry supports deliberate branch renames", () => {
  const rootChatJid = `web:test-rename-${Date.now()}`;
  db.storeChatMetadata(rootChatJid, new Date().toISOString(), "Root");
  const branch = db.ensureChatBranch({
    chat_jid: `${rootChatJid}:branch:rename`,
    root_chat_jid: rootChatJid,
    agent_name: "draft-agent",
  });
  const other = db.ensureChatBranch({
    chat_jid: `${rootChatJid}:branch:other`,
    root_chat_jid: rootChatJid,
    agent_name: "taken-name",
  });

  const renamed = db.renameChatBranchIdentity({
    chat_jid: branch.chat_jid,
    agent_name: "research-lead",
  });

  expect(renamed.agent_name).toBe("research-lead");
  expect(renamed.display_name).toBeNull();
  expect(db.getChatBranchByAgentName("research-lead")?.chat_jid).toBe(branch.chat_jid);
  expect(() => db.renameChatBranchIdentity({ chat_jid: branch.chat_jid, agent_name: other.agent_name })).toThrow(
    `Agent handle is already in use: @${other.agent_name}`,
  );
});

test("chat branch registry derives handle from chatJid when no agent_name given", () => {
  const rootChatJid = `web:test-derive-${Date.now()}`;
  db.storeChatMetadata(rootChatJid, new Date().toISOString(), "Root");

  const branch = db.ensureChatBranch({
    chat_jid: `${rootChatJid}:branch:my-research`,
    root_chat_jid: rootChatJid,
  });
  expect(branch.agent_name).toBe("my-research");
  expect(branch.display_name).toBeNull();
});

test("chat branch registry rejects rename with empty handle", () => {
  const rootChatJid = `web:test-empty-${Date.now()}`;
  db.storeChatMetadata(rootChatJid, new Date().toISOString(), "Root");
  const branch = db.ensureChatBranch({
    chat_jid: `${rootChatJid}:branch:valid`,
    root_chat_jid: rootChatJid,
    agent_name: "valid-name",
  });

  expect(() => db.renameChatBranchIdentity({
    chat_jid: branch.chat_jid,
    agent_name: "",
  })).toThrow(/letter or number/);

  expect(() => db.renameChatBranchIdentity({
    chat_jid: branch.chat_jid,
    agent_name: "---",
  })).toThrow(/letter or number/);
});

test("chat branch registry always writes null display_name", () => {
  const rootChatJid = `web:test-null-dn-${Date.now()}`;
  db.storeChatMetadata(rootChatJid, new Date().toISOString(), "Root");

  const branch = db.ensureChatBranch({
    chat_jid: `${rootChatJid}:branch:check`,
    root_chat_jid: rootChatJid,
    agent_name: "check-agent",
  });
  expect(branch.display_name).toBeNull();

  const renamed = db.renameChatBranchIdentity({
    chat_jid: branch.chat_jid,
    agent_name: "renamed-agent",
  });
  expect(renamed.display_name).toBeNull();

  const archived = db.archiveChatBranch(branch.chat_jid);
  const restored = db.restoreChatBranchIdentity({
    chat_jid: archived.chat_jid,
    agent_name: "restored-agent",
  });
  expect(restored.display_name).toBeNull();
});

test("chat branch registry supports pruning non-root branches and archiving non-default roots", () => {
  const rootChatJid = `web:test-prune-${Date.now()}`;
  db.storeChatMetadata(rootChatJid, new Date().toISOString(), "Root");
  const root = db.getChatBranchByChatJid(rootChatJid);
  const branch = db.ensureChatBranch({
    chat_jid: `${rootChatJid}:branch:prune`,
    root_chat_jid: rootChatJid,
    parent_branch_id: root?.branch_id ?? null,
    agent_name: "prunable",
  });

  const archived = db.archiveChatBranch(branch.chat_jid);
  expect(archived.archived_at).toBeTruthy();
  expect(db.getChatBranchByAgentName(branch.agent_name)).toBeNull();
  expect(db.listChatBranches(rootChatJid).map((item) => item.chat_jid)).toEqual([rootChatJid]);

  const archivedRoot = db.archiveChatBranch(rootChatJid);
  expect(archivedRoot.archived_at).toBeTruthy();
});

test("chat branch registry lets pruned agent handles be reused", () => {
  const rootChatJid = `web:test-prune-reuse-${Date.now()}`;
  db.storeChatMetadata(rootChatJid, new Date().toISOString(), "Root");
  const root = db.getChatBranchByChatJid(rootChatJid);
  const archived = db.ensureChatBranch({
    chat_jid: `${rootChatJid}:branch:archived`,
    root_chat_jid: rootChatJid,
    parent_branch_id: root?.branch_id ?? null,
    agent_name: "reusable-handle",
  });
  db.archiveChatBranch(archived.chat_jid);

  const reused = db.ensureChatBranch({
    chat_jid: `${rootChatJid}:branch:replacement`,
    root_chat_jid: rootChatJid,
    parent_branch_id: root?.branch_id ?? null,
    agent_name: "reusable-handle",
  });
  expect(reused.agent_name).toBe("reusable-handle");
  expect(db.getChatBranchByAgentName("reusable-handle")?.chat_jid).toBe(reused.chat_jid);

  const renamed = db.renameChatBranchIdentity({
    chat_jid: archived.chat_jid,
    agent_name: "archived-handle",
  });
  expect(renamed.agent_name).toBe("archived-handle");
});

test("chat branch registry can list archived branches and restore with collision-safe handles", () => {
  const rootChatJid = `web:test-restore-${Date.now()}`;
  db.storeChatMetadata(rootChatJid, new Date().toISOString(), "Root");
  const root = db.getChatBranchByChatJid(rootChatJid);

  const archived = db.ensureChatBranch({
    chat_jid: `${rootChatJid}:branch:archived`,
    root_chat_jid: rootChatJid,
    parent_branch_id: root?.branch_id ?? null,
    agent_name: "release",
  });
  db.archiveChatBranch(archived.chat_jid);

  // Occupy @release while archived copy exists.
  db.ensureChatBranch({
    chat_jid: `${rootChatJid}:branch:active`,
    root_chat_jid: rootChatJid,
    parent_branch_id: root?.branch_id ?? null,
    agent_name: "release",
  });

  const activeOnly = db.listChatBranches(rootChatJid).map((branch) => branch.chat_jid);
  expect(activeOnly).not.toContain(archived.chat_jid);
  const withArchived = db.listChatBranches(rootChatJid, { includeArchived: true }).map((branch) => branch.chat_jid);
  expect(withArchived).toContain(archived.chat_jid);

  const restored = db.restoreChatBranchIdentity({ chat_jid: archived.chat_jid });
  expect(restored.archived_at).toBeNull();
  expect(restored.agent_name).toMatch(/^release(?:-\d+)?$/);
  expect(db.getChatBranchByAgentName(restored.agent_name)?.chat_jid).toBe(archived.chat_jid);
});

test("initDatabase migrates legacy chat branch uniqueness so pruned handles can be reused", () => {
  const ws = createTempWorkspace("piclaw-chat-branch-migrate-");

  try {
    const legacyDb = new Database(`${ws.store}/messages.db`);
    legacyDb.exec(`
      CREATE TABLE chats (
        jid TEXT PRIMARY KEY,
        name TEXT,
        last_message_time TEXT
      );
      CREATE TABLE chat_branches (
        branch_id TEXT PRIMARY KEY,
        chat_jid TEXT NOT NULL UNIQUE,
        root_chat_jid TEXT NOT NULL,
        parent_branch_id TEXT,
        agent_name TEXT NOT NULL UNIQUE,
        display_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        FOREIGN KEY (chat_jid) REFERENCES chats(jid)
      );
    `);

    const now = new Date().toISOString();
    legacyDb.prepare("INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)").run("web:default", "Root", now);
    legacyDb.prepare("INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)").run("web:default:branch:old", "Old", now);
    legacyDb.prepare("INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)").run("web:default:branch:new", "New", now);
    legacyDb.prepare(
      `INSERT INTO chat_branches (
        branch_id, chat_jid, root_chat_jid, parent_branch_id, agent_name, display_name, created_at, updated_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("branch-root", "web:default", "web:default", null, "root", "Root", now, now, null);
    legacyDb.prepare(
      `INSERT INTO chat_branches (
        branch_id, chat_jid, root_chat_jid, parent_branch_id, agent_name, display_name, created_at, updated_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("branch-old", "web:default:branch:old", "web:default", "branch-root", "reusable", "Old", now, now, now);
    legacyDb.prepare(
      `INSERT INTO chat_branches (
        branch_id, chat_jid, root_chat_jid, parent_branch_id, agent_name, display_name, created_at, updated_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("branch-new", "web:default:branch:new", "web:default", "branch-root", "new-handle", "New", now, now, null);
    legacyDb.close();

    const script = `
      const db = await import("./src/db.js");
      db.initDatabase();
      const renamed = db.renameChatBranchIdentity({
        chat_jid: "web:default:branch:new",
        agent_name: "reusable",
      });
      console.log(JSON.stringify({
        agent_name: renamed.agent_name,
        resolved_chat_jid: db.getChatBranchByAgentName("reusable")?.chat_jid || null,
      }));
    `;
    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: resolve(import.meta.dir, "..", ".."),
      env: {
        ...process.env,
        PICLAW_WORKSPACE: ws.workspace,
        PICLAW_STORE: ws.store,
        PICLAW_DATA: ws.data,
        PICLAW_DB_IN_MEMORY: "0",
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim().split("\n").filter(Boolean).pop() || "{}");
    expect(output.agent_name).toBe("reusable");
    expect(output.resolved_chat_jid).toBe("web:default:branch:new");
  } finally {
    ws.cleanup();
  }
});

test("timeline returns oldest-first and hasOlderMessages works", () => {
  const chatJid = `test:${Date.now()}-timeline`;
  db.storeChatMetadata(chatJid, new Date().toISOString(), "Test");

  db.storeMessage(makeMessage(chatJid, "first", "2024-01-01T00:00:00.000Z"));
  db.storeMessage(makeMessage(chatJid, "second", "2024-01-01T00:01:00.000Z"));
  db.storeMessage(makeMessage(chatJid, "third", "2024-01-01T00:02:00.000Z"));

  const timeline = db.getTimeline(chatJid, 2);
  expect(timeline.length).toBe(2);
  expect(timeline[0].chat_jid).toBe(chatJid);
  expect(timeline[1].chat_jid).toBe(chatJid);
  expect(timeline[0].data.content).toBe("second");
  expect(timeline[1].data.content).toBe("third");

  const oldestId = timeline[0].id;
  expect(db.hasOlderMessages(chatJid, oldestId)).toBe(true);
});

test("search and hashtag filters return matching messages", () => {
  const chatJid = `test:${Date.now()}-search`;
  db.storeChatMetadata(chatJid, new Date().toISOString(), "Test");

  db.storeMessage(makeMessage(chatJid, "hello #world", "2024-02-01T00:00:00.000Z"));
  db.storeMessage(makeMessage(chatJid, "another message", "2024-02-01T00:01:00.000Z"));
  db.storeMessage(makeMessage(chatJid, "#world with hello", "2024-02-01T00:02:00.000Z"));

  const hashtag = db.getMessagesByHashtag(chatJid, "world", 10, 0);
  expect(hashtag.length).toBe(2);

  const results = db.searchMessages(chatJid, "hello", 10, 0);
  expect(results.length).toBe(2);
});

test("searchMessagesAcrossChats can search across branch families or all chats", () => {
  const rootChatJid = `web:test-search-root-${Date.now()}`;
  const branchChatJid = `${rootChatJid}:branch:1`;
  const otherChatJid = `web:test-search-other-${Date.now()}`;
  db.storeChatMetadata(rootChatJid, new Date().toISOString(), "Root");
  db.storeChatMetadata(branchChatJid, new Date().toISOString(), "Branch");
  db.storeChatMetadata(otherChatJid, new Date().toISOString(), "Other");
  const root = db.getChatBranchByChatJid(rootChatJid);
  db.ensureChatBranch({
    chat_jid: branchChatJid,
    root_chat_jid: rootChatJid,
    parent_branch_id: root?.branch_id ?? null,
    agent_name: "search-branch",
  });

  db.storeMessage(makeMessage(rootChatJid, "needle root", "2024-02-02T00:00:00.000Z"));
  db.storeMessage(makeMessage(branchChatJid, "needle branch", "2024-02-02T00:01:00.000Z"));
  db.storeMessage(makeMessage(otherChatJid, "needle other", "2024-02-02T00:02:00.000Z"));

  const rootFamily = db.searchMessagesAcrossChats([rootChatJid, branchChatJid], "needle", 10, 0);
  expect(rootFamily.map((row) => row.data.content)).toEqual(["needle branch", "needle root"]);

  const global = db.searchMessagesAcrossChats(null, "needle", 10, 0);
  expect(global.map((row) => row.data.content)).toEqual(["needle other", "needle branch", "needle root"]);
});

test("media attachments are stored and returned", () => {
  const chatJid = `test:${Date.now()}-media`;
  db.storeChatMetadata(chatJid, new Date().toISOString(), "Test");

  const mediaId = db.createMedia(
    "note.txt",
    "text/plain",
    new TextEncoder().encode("hello"),
    null,
    { size: 5 }
  );

  const rowId = db.storeMessage(makeMessage(chatJid, "with media", "2024-03-01T00:00:00.000Z"));
  db.attachMediaToMessage(rowId, [mediaId]);

  const interaction = db.getMessageByRowId(chatJid, rowId);
  expect(interaction).not.toBeNull();
  expect(interaction?.data.media_ids).toEqual([mediaId]);
});

test("storeMessage updates existing rows without orphaning media attachments", () => {
  const chatJid = `test:${Date.now()}-media-upsert`;
  db.storeChatMetadata(chatJid, new Date().toISOString(), "Test");

  const mediaId = db.createMedia(
    "note.txt",
    "text/plain",
    new TextEncoder().encode("hello"),
    null,
    { size: 5 }
  );

  const message = makeMessage(chatJid, "original", "2024-03-01T00:00:00.000Z");
  const firstRowId = db.storeMessage(message);
  db.attachMediaToMessage(firstRowId, [mediaId]);

  const secondRowId = db.storeMessage({
    ...message,
    content: "edited",
    timestamp: "2024-03-01T00:01:00.000Z",
  });

  expect(secondRowId).toBe(firstRowId);

  const interaction = db.getMessageByRowId(chatJid, secondRowId);
  expect(interaction?.data.content).toBe("edited");
  expect(interaction?.data.media_ids).toEqual([mediaId]);
});

test("text media attachments are added to message search indexing", () => {
  const chatJid = `test:${Date.now()}-media-fts`;
  db.storeChatMetadata(chatJid, new Date().toISOString(), "Test");

  const mediaId = db.createMedia(
    "note.txt",
    "text/plain",
    new TextEncoder().encode("attached needle"),
    null,
    { size: 15 }
  );

  const rowId = db.storeMessage(makeMessage(chatJid, "message body", "2024-03-01T00:00:00.000Z"));
  db.attachMediaToMessage(rowId, [mediaId]);

  const results = db.searchMessages(chatJid, "needle", 10, 0);
  expect(results.map((row) => row.id)).toContain(rowId);
  expect(results.map((row) => row.data.content)).toContain("message body");
});

// --- New coverage: same-timestamp ordering & cursor filters ---

test("same-timestamp ordering is stable for timeline and cursor queries", () => {
  const chatJid = `test:${Date.now()}-same-ts`;
  db.storeChatMetadata(chatJid, new Date().toISOString(), "Test");

  const ts = "2024-04-01T00:00:00.000Z";
  const rowA = db.storeMessage(makeMessage(chatJid, "A", ts));
  const rowB = db.storeMessage(makeMessage(chatJid, "B", ts));

  const timeline = db.getTimeline(chatJid, 10);
  const contents = timeline.map((t) => t.data.content);
  expect(contents).toEqual(["A", "B"]);

  const sinceMessages = db.getMessagesSince(chatJid, "2024-03-31T23:59:59.000Z", "Pi");
  expect(sinceMessages.map((m) => m.content)).toEqual(["A", "B"]);

  const { messages } = db.getNewMessages([chatJid], "2024-03-31T23:59:59.000Z", "Pi");
  expect(messages.map((m) => m.content)).toEqual(["A", "B"]);

  // Row IDs should be increasing with insertion order
  expect(rowB).toBeGreaterThan(rowA);
});

test("storeMessage makes per-chat timestamps monotonic so cursor-based drains cannot miss same-ms turns", () => {
  const chatJid = `test:${Date.now()}-monotonic-cursor`;
  db.storeChatMetadata(chatJid, new Date().toISOString(), "Test");

  const requestedTs = "2024-04-02T00:00:00.000Z";
  const firstRowId = db.storeMessage(makeMessage(chatJid, "first", requestedTs));
  const first = db.getMessageByRowId(chatJid, firstRowId);
  expect(first?.timestamp).toBe(requestedTs);

  // Simulate the cursor having already advanced to the first persisted turn.
  const cursorTs = first?.timestamp || requestedTs;

  const secondRowId = db.storeMessage(makeMessage(chatJid, "second", requestedTs));
  const second = db.getMessageByRowId(chatJid, secondRowId);
  const secondTimestamp = second?.timestamp ?? "";
  expect(secondTimestamp).not.toBe(cursorTs);
  expect(secondTimestamp > cursorTs).toBe(true);

  const pending = db.getMessagesSince(chatJid, cursorTs, "Pi");
  expect(pending.map((m) => m.content)).toEqual(["second"]);
});

// --- Bot message filtering ---

test("getMessagesSince and getNewMessages filter bot messages, bot-prefixed content, slash commands, and steering-only rows", () => {
  const chatJid = `test:${Date.now()}-bot-filter`;
  db.storeChatMetadata(chatJid, new Date().toISOString(), "Test");

  db.storeMessage(makeMessage(chatJid, "Pi: should be filtered", "2024-05-01T00:00:00.000Z", false));
  db.storeMessage(makeMessage(chatJid, "bot message", "2024-05-01T00:01:00.000Z", true));
  db.storeMessage(makeMessage(chatJid, "/tree", "2024-05-01T00:01:10.000Z", false));
  db.storeMessage(makeMessage(chatJid, "   /theme gruvbox", "2024-05-01T00:01:20.000Z", false));
  db.storeMessage({
    ...makeMessage(chatJid, "steering-only", "2024-05-01T00:01:30.000Z", false),
    is_steering_message: true,
  });
  db.storeMessage(makeMessage(chatJid, "user message", "2024-05-01T00:02:00.000Z", false));

  const sinceMessages = db.getMessagesSince(chatJid, "", "Pi");
  expect(sinceMessages.map((m) => m.content)).toEqual(["user message"]);

  const { messages } = db.getNewMessages([chatJid], "", "Pi");
  expect(messages.map((m) => m.content)).toEqual(["user message"]);
});

// --- Delete cascade & media cleanup ---

test("deleteMessageByRowId cleans up media only when unreferenced", () => {
  const chatJid = `test:${Date.now()}-delete-media`;
  db.storeChatMetadata(chatJid, new Date().toISOString(), "Test");

  const mediaId = db.createMedia(
    "shared.txt",
    "text/plain",
    new TextEncoder().encode("shared"),
    null,
    { size: 6 }
  );

  const rowA = db.storeMessage(makeMessage(chatJid, "A", "2024-06-01T00:00:00.000Z"));
  const rowB = db.storeMessage(makeMessage(chatJid, "B", "2024-06-01T00:01:00.000Z"));
  db.attachMediaToMessage(rowA, [mediaId]);
  db.attachMediaToMessage(rowB, [mediaId]);

  expect(db.getMediaById(mediaId)).toBeTruthy();

  db.deleteMessageByRowId(chatJid, rowA);
  expect(db.getMediaById(mediaId)).toBeTruthy();

  db.deleteMessageByRowId(chatJid, rowB);
  expect(db.getMediaById(mediaId)).toBeUndefined();
});

test("deleteThreadByRowId removes thread replies and cleans up media", () => {
  const chatJid = `test:${Date.now()}-delete-thread`;
  db.storeChatMetadata(chatJid, new Date().toISOString(), "Test");

  const mediaParent = db.createMedia(
    "parent.txt",
    "text/plain",
    new TextEncoder().encode("parent"),
    null,
    { size: 6 }
  );
  const mediaChild = db.createMedia(
    "child.txt",
    "text/plain",
    new TextEncoder().encode("child"),
    null,
    { size: 5 }
  );

  const parentId = db.storeMessage(makeMessage(chatJid, "parent", "2024-07-01T00:00:00.000Z"));
  const childId = db.storeMessage({
    ...makeMessage(chatJid, "child", "2024-07-01T00:01:00.000Z"),
    thread_id: parentId,
  } as any);

  db.attachMediaToMessage(parentId, [mediaParent]);
  db.attachMediaToMessage(childId, [mediaChild]);

  const deleted = db.deleteThreadByRowId(chatJid, parentId);
  expect(deleted.length).toBe(2);
  expect(db.getTimeline(chatJid, 10).length).toBe(0);
  expect(db.getMediaById(mediaParent)).toBeUndefined();
  expect(db.getMediaById(mediaChild)).toBeUndefined();
});

// --- Link previews preserve content_blocks ---

test("updateMessageLinkPreviews preserves existing content blocks", () => {
  const chatJid = `test:${Date.now()}-link-preview`;
  db.storeChatMetadata(chatJid, new Date().toISOString(), "Test");

  const rowId = db.storeMessage({
    ...makeMessage(chatJid, "preview", "2024-08-01T00:00:00.000Z"),
    content_blocks: [{ type: "file", name: "note.txt", size: 4 }],
  } as any);

  const ok = db.updateMessageLinkPreviews(chatJid, rowId, [{ url: "https://example.com" }]);
  expect(ok).toBe(true);

  const message = db.getMessageByRowId(chatJid, rowId);
  expect(message?.data.content_blocks?.length).toBe(1);
  expect(message?.data.link_previews?.length).toBe(1);
});

// --- Corrupt JSON in content_blocks/link_previews should not crash ---

test("invalid JSON in content_blocks/link_previews is handled gracefully", () => {
  const chatJid = `test:${Date.now()}-bad-json`;
  db.storeChatMetadata(chatJid, new Date().toISOString(), "Test");

  const rowId = db.storeMessage(makeMessage(chatJid, "bad json", "2024-09-01T00:00:00.000Z"));
  const conn = db.getDb();
  conn.prepare("UPDATE messages SET content_blocks = ?, link_previews = ? WHERE rowid = ?")
    .run("{not json", "[invalid", rowId);

  expect(() => db.getMessageByRowId(chatJid, rowId)).not.toThrow();
  const message = db.getMessageByRowId(chatJid, rowId);
  expect(message?.data.content_blocks).toBeUndefined();
  expect(message?.data.link_previews).toBeUndefined();
});
