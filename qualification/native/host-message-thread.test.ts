import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { resolveAcceptedMessageThread } from "../../runtime/durable-engine/src/host-message-thread.js";
import type { AcceptedInput } from "../../runtime/durable-engine/src/host-runtime.js";

for (const mode of ["root", "self-root", "nested", "queued", "cross-chat", "missing", "payload", "identity", "internal", "scheduled"] as const) {
  test(`accepted native reply thread: ${mode}`, () => {
    const db = new Database(":memory:");
    try {
      db.exec(`CREATE TABLE messages(id TEXT,chat_jid TEXT,is_bot_message INTEGER,thread_id INTEGER);
        CREATE TABLE service_effect_s01_sources(chat_jid TEXT,source_seq INTEGER,source_id TEXT,kind TEXT,payload_ref TEXT);
        INSERT INTO messages(rowid,id,chat_jid,is_bot_message,thread_id) VALUES
          (10,'root','chat',0,NULL),(11,'input','chat',0,10),(12,'later','chat',0,NULL);`);
      const sourceId = mode === "root" ? "root" : "input";
      const payloadRef = mode === "queued" ? `queued-source:${sourceId}` : `message-row:${sourceId === "root" ? 10 : 11}`;
      const input = { chatJid: "chat", sourceSeq: 3, sourceId, payloadRef } as AcceptedInput;
      db.query("INSERT INTO service_effect_s01_sources VALUES (?,?,?,?,?)").run("chat", 3, sourceId,
        mode === "internal" ? "internal" : mode === "scheduled" ? "scheduled_agent" : "message", payloadRef);
      if (mode === "self-root") db.exec("UPDATE messages SET thread_id=10 WHERE id='root'");
      if (mode === "cross-chat") db.exec("UPDATE messages SET chat_jid='other' WHERE id='input'");
      if (mode === "missing") db.exec("DELETE FROM messages WHERE id='root'");
      if (mode === "payload") db.exec("UPDATE service_effect_s01_sources SET payload_ref='message-row:12'");
      if (mode === "identity") db.exec("UPDATE service_effect_s01_sources SET source_id='later'");
      if (["cross-chat", "missing", "payload", "identity"].includes(mode))
        expect(() => resolveAcceptedMessageThread(db, input)).toThrow();
      else expect(resolveAcceptedMessageThread(db, input)).toBe(mode === "internal" || mode === "scheduled" ? null : 10);
    } finally { db.close(); }
  });
}
