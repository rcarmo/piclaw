import { expect, test } from "bun:test";
import { createWebChannelTestFixture } from "./helpers/web-channel-fixture.js";

const RESET_CHAT_STATE_SQL = [
  "DELETE FROM message_media;",
  "DELETE FROM messages;",
  "DELETE FROM chats;",
  "DELETE FROM chat_cursors;",
  "DELETE FROM chat_branches;",
].join("\n");

test("web channel isolates branch post writes from the default chat timeline", async () => {
  const fixture = await createWebChannelTestFixture({
    workspace: "temp",
    prefix: "piclaw-web-isolation-",
    resetSql: RESET_CHAT_STATE_SQL,
    seed: (db) => {
      db.storeChatMetadata("web:default", new Date().toISOString(), "Default");
      db.storeChatMetadata("web:branch", new Date().toISOString(), "Branch");
    },
  });

  try {
    const { db, channel } = fixture;
    channel.getInputSourceAdmission=()=>()=>{};
    channel.dispatchAcceptedInput=async(_chat,_id,row)=>({submission_id:row,queued:false});
    const res = await (channel as any).handleRequest(new Request("http://test/post?chat_jid=web%3Abranch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "branch only" }),
    }));

    expect(res.status).toBe(201);
    const defaultTimeline = db.getTimeline("web:default", 20);
    const branchTimeline = db.getTimeline("web:branch", 20);
    expect(defaultTimeline).toHaveLength(0);
    expect(branchTimeline).toHaveLength(1);
    expect(branchTimeline[0]?.data?.content).toBe("branch only");
  } finally {
    fixture.cleanup();
  }
});

test("web channel isolates branch delete operations from the default chat", async () => {
  const fixture = await createWebChannelTestFixture({
    workspace: "temp",
    prefix: "piclaw-web-isolation-",
    resetSql: RESET_CHAT_STATE_SQL,
    seed: (db) => {
      db.storeChatMetadata("web:default", new Date().toISOString(), "Default");
      db.storeChatMetadata("web:branch", new Date().toISOString(), "Branch");
    },
  });

  try {
    const { db, channel } = fixture;
    const defaultRowId = db.storeMessage({
      id: `msg-${Math.random()}`,
      chat_jid: "web:default",
      sender: "user",
      sender_name: "User",
      content: "default message",
      timestamp: new Date().toISOString(),
      is_from_me: false,
      is_bot_message: false,
    });
    const branchRowId = db.storeMessage({
      id: `msg-${Math.random()}`,
      chat_jid: "web:branch",
      sender: "user",
      sender_name: "User",
      content: "branch message",
      timestamp: new Date().toISOString(),
      is_from_me: false,
      is_bot_message: false,
    });

    const res = await (channel as any).handleRequest(new Request(`http://test/post/${branchRowId}?chat_jid=web%3Abranch`, {
      method: "DELETE",
    }));

    expect(res.status).toBe(200);
    expect(db.getMessageByRowId("web:branch", branchRowId)).toBeUndefined();
    expect(db.getMessageByRowId("web:default", defaultRowId)?.data?.content).toBe("default message");
  } finally {
    fixture.cleanup();
  }
});
