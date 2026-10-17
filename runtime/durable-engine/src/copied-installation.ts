// Inactive installation composition: separate real trees, one journal and writer.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Context } from "@earendil-works/chord/context";
import type { Conversation, ConversationId, Harness } from "@earendil-works/pi-durable";
import { prepareCopiedApplicationUpgrade } from "./copied-upgrade.js";
import type { GetLegacyContext } from "./legacy-import.js";
import type { HostCutoverController } from "./host-cutover.js";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface CopiedInstallationInput {
  sourceJSONL: string; manifestJSON: string;
  expected: { sourceSHA256: string; manifestSHA256: string };
}
/** Roots are authoritative caller assignments, created under the existing owner and
 * paused harness BEFORE this workflow. Never allocate on retry. Complete assignments
 * are persisted in the existing journal request before any source import. */
export function prepareCopiedInstallation(inputs: readonly CopiedInstallationInput[],
  roots: ReadonlyMap<string, ConversationId>, bridge: GetLegacyContext) {
  assert(inputs.length > 0, "Empty installation");
  // Prepare EVERY source before exposing any operation capable of writing.
  const plans = inputs.map(input => prepareCopiedApplicationUpgrade(Buffer.from(input.sourceJSONL),
    Buffer.from(input.manifestJSON), input.expected, bridge)).sort((a, b) =>
      a.sourceSessionId < b.sourceSessionId ? -1 : a.sourceSessionId > b.sourceSessionId ? 1 : a.sourceSHA256.localeCompare(b.sourceSHA256));
  const sessions = new Set<string>(), chats = new Set<string>(), branches = new Set<string>();
  for (const plan of plans) {
    assert(!sessions.has(plan.sourceSessionId), "Duplicate installation session"); sessions.add(plan.sourceSessionId);
    for (const identity of plan.identities) {
      // "main" is the existing chat-scoped synthetic route, not a global branch ID.
      assert(!chats.has(identity.chatJid) && (identity.branchId === "main" || !branches.has(identity.branchId)), "Conflicting installation branch/chat");
      chats.add(identity.chatJid); branches.add(identity.branchId);
    }
  }
  assert(roots.size === plans.length, "Exact installation root assignments required");
  const sources = plans.map(plan => Object.freeze({ originalSessionId: plan.sourceSessionId,
    sourceSHA256: plan.sourceSHA256, manifestSHA256: plan.manifestSHA256,
    importHash: plan.request.importHash, rootId: roots.get(plan.sourceSHA256)! }));
  assert(sources.every(s => Number.isSafeInteger(s.rootId) && s.rootId > 0) &&
    new Set(sources.map(s => s.rootId)).size === sources.length, "Invalid installation roots");
  const installation = Object.freeze({ kind: "copied-installation" as const, version: 2 as const, sources: Object.freeze(sources) });
  const request = Object.freeze({ requestKey: `installation:${hash(installation)}`,
    sourceDigest: copiedInstallationSourceDigest(inputs), importHash: hash(installation), installation });
  const receipt = Object.freeze({ sourceDigest: request.sourceDigest, receiptHash: request.importHash });
  const first = sources[0]!;
  const checkRoot = (id: ConversationId) => assert.equal(id, first.rootId, "Installation importer root conflict");
  async function bindings(harness: Harness, rootId: ConversationId, context: Context) {
    checkRoot(rootId);
    const manifest = [], sessions = new Map<string, string>();
    for (const [index, plan] of plans.entries()) {
      const binding = await plan.verifyBindings(harness, sources[index]!.rootId, context);
      manifest.push(...binding.manifest);
      for (const [chat, session] of binding.sessions) sessions.set(chat, session);
    }
    assert.equal(new Set(manifest.map(b => b.conversationId)).size, manifest.length, "Aliased installation conversations");
    return { manifest: Object.freeze(manifest), sessions };
  }
  return Object.freeze({ request, sourceSessionId: first.originalSessionId,
    assertApplicationScope(incarnation: string, sessionId: string) {
      assert.equal(sessionId, first.originalSessionId);
      for (const plan of plans) plan.assertApplicationScope(incarnation, plan.sourceSessionId);
    },
    assertApplicationBranches(root: Parameters<(typeof plans)[number]["assertApplicationBranches"]>[0]) {
      for (const plan of plans) plan.assertApplicationBranches(root);
    },
    async validateImporter(harness: Harness, rootId: ConversationId, context: Context) {
      checkRoot(rootId);
      assert.deepEqual(await harness.inspect(context), { scheduling: "paused", tasks: [], submissions: [] });
      const conversations = await Promise.all(sources.map(s => harness.conversation(s.rootId, context)));
      assert(conversations.every(Boolean), "Missing installation root");
    },
    checkpoint(controller: HostCutoverController) { return controller.preflight(request); },
    async importCopied(root: Conversation, owner: () => void, context: Context, harness?: Harness) {
      checkRoot(root.id); assert(harness, "Installation harness required");
      // Resolve ALL supplied roots before importing any source.
      const conversations = await Promise.all(sources.map(s => harness.conversation(s.rootId, context)));
      assert(conversations.every(Boolean), "Missing installation root");
      for (const [index, plan] of plans.entries()) {
        owner(); await plan.importCopied(conversations[index]!, owner, context);
      }
      return receipt;
    },
    async verify(harness: Harness, rootId: ConversationId, context: Context) { await bindings(harness, rootId, context); return receipt; },
    verifyBindings: bindings,
  });
}
/** Host checkDrained must recompute this exact ordered source inventory digest. */
export function copiedInstallationSourceDigest(inputs: readonly CopiedInstallationInput[]) {
  const identities = inputs.map(input => ({ originalSessionId: JSON.parse(input.sourceJSONL.split("\n")[0]!).id as string,
    sourceSHA256: input.expected.sourceSHA256, manifestSHA256: input.expected.manifestSHA256 }));
  identities.sort((a, b) => a.originalSessionId < b.originalSessionId ? -1 : a.originalSessionId > b.originalSessionId ? 1 : a.sourceSHA256.localeCompare(b.sourceSHA256));
  return hash(identities);
}
