import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { acceptedSteerFixture } from "./src/accepted-steer-recovery-fixture.js";
import { reconstituteAcceptedWork } from "../../runtime/durable-engine/src/host-recovery.js";
import { value } from "./src/host-handoff.js";
import { context } from "./src/fixture.js";
import type { AcceptedSourceSnapshot } from "../../runtime/src/service-effects/contracts/service-work-store.js";

for (const boundary of ["before-submit", "committed-ack-lost"] as const) {
  test(`passive source discovery without fixture identity: ${boundary}`, async () => {
    const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "host-recovery-"));
    const oldMemory = process.env.PICLAW_DB_IN_MEMORY;
    const f = await acceptedSteerFixture(dir, boundary);
    try {
      const { primary, primaryId } = await f.prepare();
      await f.runtime!.close(); f.permit = false;
      await f.open(); // Paused; same host-owned manifest and accepted store.
      f.db.exec("DROP TABLE recovery_fixture_identity");
      const entries = f.providerEntries;
      const options = {
        incarnation: f.incarnation,
        binding: { chatJid: f.chatJid, branchId: "main", conversationId: f.base.root.id },
        runningBinding: { sessionId: f.incarnation, lane: "main", watchGeneration: f.generation },
        assertOwner: () => f.owner.assert(), work: f.ports.work, bindings: f.ports.bindings,
        async readAcceptedInput(source: AcceptedSourceSnapshot) {
          const row = f.db.query("SELECT content FROM messages WHERE id=? AND chat_jid=?")
            .get(source.sourceId, source.chatJid) as { content: string } | null;
          if (!row) throw Error("Missing persisted message");
          const binding = await f.ports.bindings.findSource(source.chatJid, source.sourceSeq);
          const operation = value(await f.ports.work.getOperation(f.incarnation))!;
          return { claimed: { source, operation }, branchId: "main",
            requestId: binding?.requestId ?? `queued-steer:${source.sourceId}`, content: row.content };
        },
      };
      const recovered = await reconstituteAcceptedWork(options);
      expect(recovered.map(r => r.role)).toEqual(["primary", "intent"]);
      expect(recovered[0]!.input).toEqual(primary);
      expect(recovered[0]!.binding?.submissionId).toBe(primaryId);
      const intent = recovered[1]!;
      expect(intent.input.requestId).toBe(`queued-steer:${f.intentSourceId}`);
      if (boundary === "before-submit") expect(intent.binding).toBeNull();
      else expect(Number(intent.binding?.submissionId)).toBe(f.committedIntentId!);
      expect(f.providerEntries).toBe(entries);
      expect(f.permit).toBe(false);
      const reader = options.readAcceptedInput;
      await expect(reconstituteAcceptedWork({ ...options, async readAcceptedInput(source) {
        const loaded = await reader(source);
        return { ...loaded, content: "swapped primary bytes" };
      } })).rejects.toThrow("Unverified recovered authority");
      await expect(reconstituteAcceptedWork({ ...options, runningBinding: { ...options.runningBinding, sessionId: "other" } }))
        .rejects.toThrow("Unverified recovered authority");
      await expect(reconstituteAcceptedWork({ ...options, async readAcceptedInput(source) {
        const loaded = await reader(source);
        return { ...loaded, claimed: { ...loaded.claimed,
          source: { ...loaded.claimed.source, provenanceRef: "invented-provenance" } } };
      } })).rejects.toThrow("Unverified recovered authority");
      // Unknown/missing source is not a primary fallback or permission for legacy replay.
      await expect(reconstituteAcceptedWork({ ...options, work: {
        listOpenOperations: f.ports.work.listOpenOperations.bind(f.ports.work),
        getOperation: f.ports.work.getOperation.bind(f.ports.work),
        getQueuedInputIntent: f.ports.work.getQueuedInputIntent.bind(f.ports.work),
        getSourceBySeq(chat, seq) { return seq === intent.input.sourceSeq ? null : f.ports.work.getSourceBySeq(chat, seq); },
      } })).rejects.toThrow("Unverified recovered authority");
      expect(f.providerEntries).toBe(entries);
      // Fault injection changes SQL authority, not the lifecycle or source provenance.
      const intentRow = f.db.query("SELECT * FROM service_effect_s01_intents WHERE operation_id=? AND intent_id=?")
        .get(f.incarnation, intent.input.requestId) as Record<string, string>;
      const tables = f.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%binding%'").all();
      const snapshotBindings = () => tables.map(t => f.db.query(`SELECT * FROM "${(t as { name: string }).name}"`).all());
      const beforeBindings = snapshotBindings();
      const restore = () => {
        f.db.query("DELETE FROM service_effect_s01_intents WHERE operation_id=?").run(f.incarnation);
        f.db.query("INSERT INTO service_effect_s01_intents(operation_id,intent_id,intent_hash,kind,payload_ref,created_at) VALUES (?,?,?,?,?,?)")
          .run(intentRow.operation_id!, intentRow.intent_id!, intentRow.intent_hash!, intentRow.kind!, intentRow.payload_ref!, intentRow.created_at!);
      };
      for (const sql of [
        "DELETE FROM service_effect_s01_intents WHERE operation_id=?",
        "UPDATE service_effect_s01_intents SET kind='prompt' WHERE operation_id=?",
        "UPDATE service_effect_s01_intents SET intent_id='other' WHERE operation_id=?",
        "UPDATE service_effect_s01_intents SET payload_ref='other' WHERE operation_id=?",
        "UPDATE service_effect_s01_intents SET intent_hash='" + "a".repeat(64) + "' WHERE operation_id=?",
        "UPDATE service_effect_s01_intents SET created_at='replaced' WHERE operation_id=?",
      ]) {
        f.db.query(sql).run(f.incarnation);
        expect(f.ports.work.getQueuedInputIntent(f.incarnation, intent.work.claimed.source)).toBeNull();
        await expect(reconstituteAcceptedWork(options)).rejects.toThrow("Unverified recovered authority");
        expect(snapshotBindings()).toEqual(beforeBindings);
        expect(f.providerEntries).toBe(entries);
        restore();
        // A mutation at the last async operation read must also be rejected.
        await expect(reconstituteAcceptedWork({ ...options, work: {
          listOpenOperations: options.work.listOpenOperations.bind(options.work),
          getSourceBySeq: options.work.getSourceBySeq.bind(options.work),
          getQueuedInputIntent: options.work.getQueuedInputIntent.bind(options.work),
          async getOperation(id) {
            const result = await options.work.getOperation(id);
            f.db.query(sql).run(f.incarnation);
            return result;
          },
        } })).rejects.toThrow("Unverified recovered authority");
        expect(snapshotBindings()).toEqual(beforeBindings);
        expect(f.providerEntries).toBe(entries);
        restore();
      }
      const pending = reconstituteAcceptedWork(options);
      options.readAcceptedInput = async () => { throw Error("replaced after await"); };
      expect(await pending).toHaveLength(2);
      f.permit = true;
      const id = await f.runtime!.submitIntent(intent.input);
      expect(await f.runtime!.submitIntent(intent.input)).toBe(id);
      if (boundary === "committed-ack-lost") expect(Number(id)).toBe(f.committedIntentId!);
      expect((await f.candidateStorage!.submissionByRequest(f.base.root.id, intent.input.requestId, context))?.id).toBe(id);
    } finally {
      await f.close();
      if (oldMemory === undefined) delete process.env.PICLAW_DB_IN_MEMORY; else process.env.PICLAW_DB_IN_MEMORY = oldMemory;
      await rm(dir, { recursive: true, force: true });
    }
  }, 15000);
}
