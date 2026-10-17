// Explicit default-off transition. Never imported by the production runtime selector.
import type { Context } from "@earendil-works/chord/context";
import type { Conversation, Harness } from "@earendil-works/pi-durable";
import { createApplicationBootstrapBundle, type ApplicationBootstrapOptions } from "./application-bootstrap.js";
import type { prepareCopiedApplicationUpgrade } from "./copied-upgrade.js";
import type { HostCutoverController } from "./host-cutover.js";
import type { BunSqliteDatabase } from "./bun-sqlite.js";

export interface ApplicationUpgradeOptions {
  plan: ReturnType<typeof prepareCopiedApplicationUpgrade> | ReturnType<typeof import("./copied-installation.js").prepareCopiedInstallation>;
  cutover: HostCutoverController;
  /** Owned capture workflow only: full source check outside transactions. */
  validatePreparation?: () => void;
  /** Transaction-safe actual runtime admission capability. */
  assertAdmissionGuard?: () => void;
  application: Omit<ApplicationBootstrapOptions, "manifest" | "sessions">;
  /** Already-owned, paused public SDK conversation on this application's database.
   * close must join/close the harness and its connection, never the global owner/root. */
  importer: { database: BunSqliteDatabase; harness: Harness; conversation: Conversation; close(): Promise<void> };
}

/** Preserved one-branch-per-chat histories. No automatic resume, binding, rollback or publication.
 * A lost writer-commit acknowledgement leaves the active journal intact; retry verifies
 * the same public baseline and candidate writer without re-running begin on active.
 * Once accepted work changes that baseline this intentionally fails closed. */
export async function upgradeApplication(options: ApplicationUpgradeOptions, context: Context) {
  const { plan, cutover, importer } = options;
  const validate = options.validatePreparation?.bind(options);
  const admission = options.assertAdmissionGuard?.bind(options);
  const application = { ...options.application, runtime: { ...options.application.runtime } };
  const capturedCloseImporter = importer.close.bind(importer);
  let importerClosing: Promise<void> | undefined;
  const closeImporter = () => importerClosing ??= Promise.resolve().then(capturedCloseImporter);
  const { database, harness, conversation } = importer;
  let bundle: Awaited<ReturnType<typeof createApplicationBootstrapBundle>> | undefined;
  let lease: ReturnType<ApplicationBootstrapOptions["ownership"]["borrow"]> | undefined;
  const assert = () => { if (!lease) throw Error("Application ownership unavailable"); lease.assertCurrentOwner(); admission?.(); };
  try {
    lease = application.ownership.borrow();
    assert(); validate?.(); database.assertApplicationRoot(application.root);
    plan.assertApplicationScope(application.runtime.incarnation, application.runtime.sessionId);
    plan.assertApplicationBranches(application.root);
    let journal = cutover.inspectApplication(application.root, application.runtime.incarnation, plan.request);
    if ("validateImporter" in plan) {
      await plan.validateImporter(harness, conversation.id, context);
      assert(); validate?.();
    }
    if (!journal || journal.phase === "source" || journal.phase === "copying") {
      journal = plan.checkpoint(cutover);
      validate?.();
      journal = await cutover.begin(journal.revision, {
        async copy() { assert(); return { sourceDigest: plan.request.sourceDigest, receiptHash: plan.request.importHash }; },
        importCopied: () => plan.importCopied(conversation, assert, context, harness),
      });
    }
    assert(); validate?.();
    if (journal.phase === "copying") {
      journal = await cutover.verify(journal.revision, () => plan.verify(harness, conversation.id, context));
      assert(); validate?.();
    }
    if ((journal.phase !== "verified" && journal.phase !== "active") ||
      journal.receipt?.sourceDigest !== plan.request.sourceDigest || journal.receipt.receiptHash !== plan.request.importHash)
      throw Error("Application upgrade journal conflict");
    const bindings = await plan.verifyBindings(harness, conversation.id, context);
    assert(); validate?.();
    await closeImporter();
    assert(); validate?.();
    bundle = await createApplicationBootstrapBundle({ ...application, ...bindings }, context);
    assert(); validate?.();
    const current = cutover.inspectApplication(application.root, application.runtime.incarnation, plan.request);
    if (!current || current.revision !== journal.revision || current.phase !== journal.phase)
      throw Error("Application upgrade journal changed");
    if (current.phase === "verified") cutover.commitWriter(current.revision, admission);
    const active = cutover.inspectApplication(application.root, application.runtime.incarnation, plan.request);
    if (active?.phase !== "active") throw Error("Application writer not active");
    assert();
    return bundle;
  } catch (error) {
    // In particular, NEVER roll back a writer commit whose acknowledgement was lost.
    const errors: unknown[] = [error];
    try { await bundle?.close(); } catch (cleanupError) { errors.push(cleanupError); }
    // A close that failed on the main path is already the primary error. Never
    // invoke the captured callback twice or report the same failure twice.
    if (!importerClosing) {
      try { await closeImporter(); } catch (cleanupError) { errors.push(cleanupError); }
    }
    if (errors.length > 1) throw new AggregateError(errors, "Application upgrade failed; cleanup failed");
    throw error;
  } finally { lease?.release(); }
}
