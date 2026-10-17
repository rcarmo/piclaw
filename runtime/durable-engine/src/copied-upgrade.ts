// INACTIVE copied-authority preflight. No paths, storage opens, activation or source selection.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import { CompactionEntry, SystemEntry, type Conversation, type ConversationId, type Harness, type EntryRecord } from "@earendil-works/pi-durable";
import { HostCutoverController } from "./host-cutover.js";
import { assertApplicationBranchRoutes, type ApplicationBootstrapOptions } from "./application-bootstrap.js";
import { importCopiedLegacyTree, prepareLegacyTreeImport, LegacyTreeImportManifest, LegacyImportManifest, IMPORTER_VERSION,
  type CopiedLegacyTreeInput, type GetLegacyContext } from "./legacy-import.js";
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Caller supplies actual owned copied bytes and independently pinned digests. The host
 * manifest remains trusted provenance, NOT evidence of a live host drain or ownership.
 * Its format is the existing rehearsal v1 format; no invented migration/chat IDs.
 * All decoding, provenance and every-leaf context validation precedes any journal write.
 * Bridge must be the trusted public legacy projection; no caller-prepared plan is accepted. */
export function prepareCopiedUpgrade(sourceBytes: Uint8Array, manifestBytes: Uint8Array,
  expected: { sourceSHA256: string; manifestSHA256: string }, bridge: GetLegacyContext) {
  const prepared = prepareUpgrade(sourceBytes, manifestBytes, expected, bridge, false);
  return Object.freeze({ ...prepared, async verify(...args: Parameters<typeof prepared.verify>) {
    return (await prepared.verify(...args)).receipt;
  } });
}

/** Default-off prerequisite for existing-chat application bootstrap. Validates ALL leaves
 * before callers can checkpoint/import. No writer switch, storage open or published ports.
 * Only verified public receipts supply durable IDs and original host session identities. */
export function prepareCopiedApplicationUpgrade(sourceBytes: Uint8Array, manifestBytes: Uint8Array,
  expected: { sourceSHA256: string; manifestSHA256: string }, bridge: GetLegacyContext) {
  const prepared = prepareUpgrade(sourceBytes, manifestBytes, expected, bridge, true);
  return Object.freeze({ ...prepared, async verify(...args: Parameters<typeof prepared.verify>) {
    return (await prepared.verify(...args)).receipt;
  }, async verifyBindings(...args: Parameters<typeof prepared.verify>): Promise<Pick<ApplicationBootstrapOptions, "manifest" | "sessions">> {
    const { binding } = await prepared.verify(...args);
    return Object.freeze({
      manifest: Object.freeze(binding.branches.map(branch => Object.freeze({ chatJid: branch.chatJid,
        branchId: branch.branchId, conversationId: branch.engineConversationId as ConversationId }))),
      sessions: new Map(binding.branches.map(branch => [branch.chatJid, branch.sourceSessionId])),
    });
  } });
}

function prepareUpgrade(sourceBytes: Uint8Array, manifestBytes: Uint8Array,
  expected: { sourceSHA256: string; manifestSHA256: string }, bridge: GetLegacyContext, application: boolean) {
  // Copy caller-owned buffers once; retain only immutable strings and private parsed data.
  const source = Buffer.from(sourceBytes), manifest = Buffer.from(manifestBytes);
  const sourceSHA256 = sha(source), manifestSHA256 = sha(manifest);
  assert(/^[a-f0-9]{64}$/.test(expected.sourceSHA256) && /^[a-f0-9]{64}$/.test(expected.manifestSHA256));
  assert(sourceSHA256 === expected.sourceSHA256 && manifestSHA256 === expected.manifestSHA256, "copied snapshot digest conflict");
  const sourceJSONL = source.toString("utf8"), manifestJSON = manifest.toString("utf8");
  assert(Buffer.from(sourceJSONL).equals(source) && Buffer.from(manifestJSON).equals(manifest), "invalid UTF-8 snapshot");
  const host = JSON.parse(manifestJSON);
  assert(host && typeof host === "object" && !Array.isArray(host));
  const fields = ["version", "sourceCopied", "expectedSourceSHA256", "pending", "inflight", "hostBranchBindings"];
  assert(Object.keys(host).length === fields.length && fields.every(key => Object.hasOwn(host, key)), "invalid copied manifest");
  assert(host.version === 1 && host.sourceCopied === true && host.pending === 0 && host.inflight === 0, "copied source not quiescent");
  assert(host.expectedSourceSHA256 === sourceSHA256, "copied source provenance conflict");
  const input: CopiedLegacyTreeInput = { sourceJSONL, hostBranchBindings: host.hostBranchBindings };
  const plan = prepareLegacyTreeImport(input, bridge);
  for (const branch of plan.prepared) {
    const systems = branch.projection.messages.filter(message => message.role === "system");
    assert(systems.length === 1 && systems[0]!.content === branch.identity.hostBaseline, "baseline context conflict");
    const last = branch.projection.messages.at(-1);
    assert(last?.role === "assistant" && last.stopReason === "stop", "copied leaf not quiescent");
  }
  // One captured route per chat. Root sibling branches have distinct chat JIDs.
  // Same-chat leaves remain unsupported: never discard a leaf or choose the first.
  const canonical = (id: string) => id.length > 0 && id === id.trim();
  if (application && (new Set(plan.prepared.map(branch => branch.identity.chatJid)).size !== plan.prepared.length ||
    plan.prepared.some(branch => !canonical(branch.identity.branchId) ||
      !canonical(branch.identity.chatJid) || !canonical(branch.sourceSessionId))))
    throw Error("Copied application upgrade requires one canonical branch per chat; ambiguous same-chat branches are unsupported");
  // Bind exact manifest bytes too: whitespace/provenance changes cannot silently reuse intent.
  const request = Object.freeze({ requestKey: `copied:${sha(JSON.stringify([sourceSHA256, manifestSHA256]))}`,
    sourceDigest: sourceSHA256, importHash: plan.sourceHash });
  const receipt = Object.freeze({ sourceDigest: sourceSHA256, receiptHash: plan.sourceHash });
  return Object.freeze({
    sourceSHA256, manifestSHA256, request,
    sourceSessionId: plan.prepared[0]!.sourceSessionId,
    identities: Object.freeze(plan.prepared.map(branch => Object.freeze({ ...branch.identity }))),
    assertApplicationBranches(root: import("bun:sqlite").Database) {
      assert(application, "Application plan required");
      assertApplicationBranchRoutes(root, plan.prepared.map(branch => branch.identity));
    },
    assertApplicationScope(incarnation: string, sessionId: string) {
      assert(application && plan.prepared.every(branch => branch.identity.chatIncarnation === incarnation &&
        branch.sourceSessionId === sessionId), "Copied application identity conflict");
    },
    checkpoint(controller: HostCutoverController) { return controller.preflight(request); },
    async importCopied(root: Conversation, assertOwner: () => void, context: Context) {
      const binding = await importCopiedLegacyTree(root, input, bridge, assertOwner, context);
      assert(binding.sourceHash === request.importHash, "copied importer conflict");
      return receipt;
    },
    /** Public open can normalize/write: caller MUST acquire ownership before open.
     * This verification never resumes scheduling and does not flip the writer. */
    async verify(harness: Harness, rootId: ConversationId, context: Context) {
      const binding = (await harness.snapshot(LegacyTreeImportManifest, rootId, context))?.binding;
      assert(binding?.sourceHash === request.importHash && binding.branches.length === plan.prepared.length, "incomplete copied import");
      assert.equal(binding.importerVersion, IMPORTER_VERSION);
      assert.equal(binding.sourceSessionId, plan.prepared[0]!.sourceSessionId);
      assert.deepEqual(binding.originalEntries, plan.raw);
      assert.deepEqual(binding.plannedBranches, plan.plannedBranches);
      assert.equal(binding.branches[0]!.engineConversationId, rootId);
      assert.equal(new Set(binding.branches.map(branch => branch.engineConversationId)).size, binding.branches.length,
        "aliased copied branches");
      // First appearance owns a source entry. Forks legitimately reuse ancestor IDs.
      const locations = new Map<string, { id: number; conversationId: number }>();
      for (const [index, branch] of binding.branches.entries()) {
        const expectedBranch = plan.prepared[index]!;
        assert.deepEqual(branch.originalEntries, expectedBranch.entries);
        assert.deepEqual([branch.chatJid, branch.chatIncarnation, branch.branchId, branch.sourceSessionId, branch.sourceLeafId],
          [expectedBranch.identity.chatJid, expectedBranch.identity.chatIncarnation, expectedBranch.identity.branchId,
            expectedBranch.sourceSessionId, expectedBranch.sourceLeafId]);
        assert.equal(branch.schemaVersion, 3);
        assert.equal(branch.importerVersion, IMPORTER_VERSION);
        assert.equal(branch.sourceHash, plan.sourceHash);
        const conversationId = branch.engineConversationId as ConversationId;
        const conversation = await harness.conversation(conversationId, context);
        assert(conversation, "missing copied branch");
        assert.deepEqual((await harness.snapshot(LegacyImportManifest, conversationId, context))?.binding, branch,
          "copied branch receipt conflict");
        // Public visible history includes fork ancestors; context alone loses audit/metadata
        // and cannot distinguish identical leaf messages. At most three records per source.
        const history = await conversation.commit(tx => tx.scanEntries({ conversationId, order: "ascending" },
          expectedBranch.entries.length * 3 + 1), context);
        let cursor = 0;
        const mapping: { sourceEntryId: string; durableEntryId: number }[] = [];
        for (const [sourceIndex, source] of expectedBranch.entries.entries()) {
          const owner = locations.get(source.id)?.conversationId ?? conversationId;
          const take = (expected: Omit<EntryRecord, "id" | "conversationId">) => {
            const actual = history.items[cursor++];
            assert(actual, "missing copied entry");
            const { id, conversationId: actualOwner, ...content } = actual;
            assert.equal(actualOwner, owner, "copied entry conversation conflict");
            assert.deepEqual(content, expected, "copied entry content conflict");
            return id;
          };
          let at = take({ kind: "app.legacy-source", data: JSON.parse(JSON.stringify(source)) });
          const model = [...expectedBranch.projection.projected[sourceIndex]!.messages];
          if (source.type === "message") {
            at = take({ kind: source.message.role === "system" ? SystemEntry.kind : "app.legacy-message", model });
          } else if (source.type === "compaction") {
            const head = mapping.find(entry => entry.sourceEntryId === source.firstKeptEntryId)!.durableEntryId;
            at = take({ kind: CompactionEntry.kind, head: head as EntryRecord["head"],
              data: { reason: "manual" }, model: model.filter(message => message.role !== "system") });
            const baseline = model.filter(message => message.role === "system");
            if (baseline.length) at = take({ kind: SystemEntry.kind, model: baseline });
          }
          const previous = locations.get(source.id);
          if (previous) assert.equal(at, previous.id, "copied ancestor mapping conflict");
          else locations.set(source.id, { id: at, conversationId });
          mapping.push({ sourceEntryId: source.id, durableEntryId: at });
        }
        assert.equal(cursor, history.items.length, "unexpected copied entries");
        assert.deepEqual(branch.entries, mapping, "incomplete copied branch mapping");
        assert.deepEqual((await conversation.context(context)).messages, expectedBranch.projection.messages);
      }
      assert.deepEqual(binding.entries, [...locations].map(([sourceEntryId, location]) =>
        ({ sourceEntryId, durableEntryId: location.id })), "incomplete copied tree mapping");
      assert.equal(locations.size, plan.raw.length, "incomplete copied source coverage");
      assert.deepEqual(await harness.inspect(context), { scheduling: "paused", tasks: [], submissions: [] });
      return { receipt, binding };
    },
  });
}
