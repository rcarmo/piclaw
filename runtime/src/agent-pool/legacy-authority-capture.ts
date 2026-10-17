// Inactive read-only capture: no SDK construction, source selection or persistence.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import type { AgentQueue } from "../queue.js";
import type { PoolEntry } from "./session-manager.js";
import { inventoryLegacySources } from "./legacy-source-inventory.js";
import { snapshotLegacyHostFrontier } from "./legacy-host-frontier.js";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => JSON.stringify(value);
export interface LegacyCaptureCoordinator {
  /** Host capability, not an operator boolean. Must assert the held admission fence
   * over ALL accepted input, controls, source/candidate controllers and their tails.
   * Keep it held until preparation/cutover is abandoned or completed. */
  assertSealedAndDrained(): void;
  /** Existing trusted cutover-controller scope. This is the NEW migration identity;
   * legacy has no persisted incarnation and capture never claims otherwise. */
  migrationIncarnation(): string;
}
export type LegacyCaptureOptions = Parameters<typeof inventoryLegacySources>[0] & {
  coordinator: LegacyCaptureCoordinator;
  queue: Pick<AgentQueue, "assertLegacyCaptureDrained">;
};

/** Called only by the existing pool with its resident map, never by offline selection.
 * All public live data is detached synchronously before the first filesystem await.
 * Every leaf of a selected file needs a resident host binding; no discarded history. */
export async function captureResidentLegacyUpgradeBindings(options: LegacyCaptureOptions,
  pool: ReadonlyMap<string, PoolEntry>, assertPoolIdle: () => void) {
  const { coordinator, queue } = options;
  const assertFence = coordinator.assertSealedAndDrained.bind(coordinator);
  const incarnation = coordinator.migrationIncarnation.bind(coordinator);
  const assertQueue = queue.assertLegacyCaptureDrained.bind(queue);
  const check = () => {
    assert(!options.root.inTransaction, "Root DB transaction active; committed frontier required");
    options.owner.assertCurrentOwner(); assertFence(); assertQueue(); assertPoolIdle();
  };
  check();
  const migrationIncarnation = incarnation();
  assert(migrationIncarnation && migrationIncarnation.trim() === migrationIncarnation, "Missing migration controller identity");
  const inventory = inventoryLegacySources(options);
  const legacyFrontier = () => snapshotLegacyHostFrontier(options.root);
  const capturedFrontier = legacyFrontier();
  const snapshots = inventory.references.map(reference => {
    const entry = pool.get(reference.chatJid);
    assert(entry, `Missing resident legacy authority: ${reference.chatJid}`);
    const session = entry.runtime.session, manager = session.sessionManager;
    const snapshot = () => {
      assert(!session.isStreaming && !session.isCompacting && !session.isRetrying && !session.isBashRunning &&
        !session.hasPendingBashMessages && session.pendingMessageCount === 0, "Legacy session not quiescent");
      return { sessionId: manager.getSessionId(), file: manager.getSessionFile(), leaf: manager.getLeafId(),
        header: manager.getHeader(), entries: manager.getEntries(), baseline: session.systemPrompt,
        messages: convertToLlm(session.messages), context: convertToLlm(manager.buildSessionContext().messages) };
    };
    const capturedJSON = json(snapshot()), captured = JSON.parse(capturedJSON) as ReturnType<typeof snapshot>;
    assert(captured.file, "Missing file-backed legacy authority");
    // A public manager can retain an alias outside the inventory tree. Bind that
    // exact filename to its captured canonical target, not just its current bytes.
    const canonicalFile = realpathSync(captured.file);
    check();
    assert.equal(json(snapshot()), capturedJSON, "Resident legacy authority changed");
    const source = inventory.sources.find(source => source.canonicalPath === canonicalFile &&
      source.chatJids.includes(reference.chatJid));
    assert(source, "Resident source outside captured canonical inventory");
    assert(reference.branchId && captured.leaf && captured.baseline, "Missing resident branch/leaf/baseline authority");
    assert(captured.sessionId === source.sourceSessionId && captured.header?.id === captured.sessionId,
      "Resident source session mismatch");
    assert.deepEqual(captured.messages, captured.context, "Resident model context differs from public legacy projection");
    const unresolvedTools = new Set<string>();
    for (const message of captured.messages) {
      if (message.role === "assistant") {
        for (const block of message.content) if (block.type === "toolCall") unresolvedTools.add(block.id);
      } else if (message.role === "toolResult") unresolvedTools.delete(message.toolCallId);
    }
    assert(unresolvedTools.size === 0, "Legacy context has unresolved tool execution");
    const [header, ...entries] = Buffer.from(source.sourceBytesBase64, "base64").toString("utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(header, captured.header, "Resident header differs from exact source");
    assert.deepEqual(entries, captured.entries, "Resident entries differ from exact source");
    assert(source.leafIds.includes(captured.leaf), "Resident selected position is not a complete source leaf");
    return { source, reference, captured, revalidate() {
      assert(pool.get(reference.chatJid) === entry && entry.runtime.session === session && session.sessionManager === manager,
        "Resident legacy authority replaced");
      assert.equal(json(snapshot()), capturedJSON, "Resident legacy authority changed");
      // Resolve only: never read through the alias before matching the inventory.
      assert.equal(realpathSync(captured.file!), source.canonicalPath, "Resident source canonical target changed");
      check();
      assert.equal(json(snapshot()), capturedJSON, "Resident legacy authority changed");
    } };
  });
  const revalidate = () => {
    check(); assert.equal(incarnation(), migrationIncarnation, "Migration controller identity changed");
    snapshots.forEach(snapshot => snapshot.revalidate());
    // Inventory verifies the canonical source's dev/ino/stamp and exact SHA.
    inventory.revalidate(); snapshots.forEach(snapshot => snapshot.revalidate()); check();
  };
  revalidate();
  const inputs = [];
  for (const source of inventory.sources.filter(source => snapshots.some(s => s.source === source))) {
    const bindings = snapshots.filter(s => s.source === source);
    assert(bindings.length === source.leafIds.length && new Set(bindings.map(s => s.captured.leaf)).size === source.leafIds.length,
      "Missing resident authority for every source leaf");
    const bytes = await readFile(source.canonicalPath);
    revalidate();
    assert(sha(bytes) === source.sourceSHA256, "Exact legacy source bytes changed");
    // Current resident prompt is not proof of the original persisted baseline.
    // Existing copied-upgrade preparation must still validate it against source.
    const hostBranchBindings = Object.fromEntries(bindings.map(({ reference, captured }) => [captured.leaf!, {
      chatJid: reference.chatJid, branchId: reference.branchId!, chatIncarnation: migrationIncarnation, hostBaseline: captured.baseline,
    }]));
    const manifestJSON = json({ version: 1, sourceCopied: true, expectedSourceSHA256: source.sourceSHA256,
      pending: 0, inflight: 0, hostBranchBindings });
    inputs.push(Object.freeze({ sourceJSONL: bytes.toString("utf8"), manifestJSON,
      expected: Object.freeze({ sourceSHA256: source.sourceSHA256, manifestSHA256: sha(manifestJSON) }) }));
  }
  revalidate();
  // Unlike revalidate(), this permits candidate-only journal/SDK/schema writes,
  // never changes to the original host routing, history or selected authority.
  const revalidateForUpgrade = () => {
    check();
    assert.equal(incarnation(), migrationIncarnation, "Migration controller identity changed");
    assert.equal(legacyFrontier(), capturedFrontier, "Legacy host frontier changed");
    snapshots.forEach(snapshot => snapshot.revalidate());
    inventory.revalidateSources();
    snapshots.forEach(snapshot => snapshot.revalidate());
    check();
  };
  return Object.freeze({ dbSHA256: inventory.dbSHA256, migrationIncarnation,
    legacyIncarnation: null, inputs: Object.freeze(inputs),
    unselectedSourcePaths: Object.freeze(inventory.sources.filter(source => !snapshots.some(s => s.source === source))
      .map(source => source.canonicalPath)),
    identities: Object.freeze(snapshots.map(({ reference, captured }) => Object.freeze({ chatJid: reference.chatJid,
      branchId: reference.branchId, originalSessionId: captured.sessionId, selectedLeafId: captured.leaf,
      migrationIncarnation, legacyIncarnation: null }))), revalidate, revalidateForUpgrade });
}
