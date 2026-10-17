// INACTIVE application module. No bootstrap, engine open, queue or production migration.
import type { Database } from "bun:sqlite";
import { initializeHostSchemaTables } from "./host-schema.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../../runtime/src/service-effects/contracts/common.js";
export type Phase = "source" | "copying" | "verified" | "active" | "reconciliation_required";
export interface CutoverIdentity { domain: string; incarnation: string; ownerGeneration: number; sourceEngineId: string; candidateStoreRef: string }
export interface CopiedInstallationBinding {
  kind: "copied-installation"; version: 2;
  sources: readonly { originalSessionId: string; sourceSHA256: string; manifestSHA256: string; importHash: string; rootId: number }[];
}
export interface CutoverRequest { requestKey: string; sourceDigest: string; importHash: string; installation?: CopiedInstallationBinding }
export interface Receipt { sourceDigest: string; receiptHash: string }
interface RollbackCheckpoint { digest: string; accepted: readonly { sourceId: string; evidenceHash: string }[] }
export interface Manifest { phase: Phase; revision: number; writer: string; postCutoverCount: number; request: CutoverRequest; receipt: Receipt | null;
  rollbackCheckpoint?: RollbackCheckpoint | null }
export interface RollbackPlan {
  disposition: "safe_to_restore" | "reconciliation_required";
  revision: number; sourceDigest: string; checkpointDigest: string | null; currentDigest: string | null;
  unresolvedAcceptedUUIDs: readonly string[];
  reasons: readonly ("checkpoint_unavailable" | "source_changed" | "host_not_drained" | "accepted_work_changed" | "recorded_work")[];
}
export interface CutoverPorts {
  /** Synchronous exact domain/incarnation/generation assertion. Must throw on owner loss. */
  assertOwner(identity: Readonly<CutoverIdentity>): void;
  /** Caller must fence real writer admission/effects in this same host SQL domain.
   * A persisted marker alone does NOT fence another process or external effects. */
  assertCurrentWriter(writer: string): void;
  /** Synchronous authoritative SQL queries, including current original-source bytes digest.
   * Invoked again INSIDE writer commit. Source admission must honor that same SQL fence. */
  checkDrained(): { sourceDigest: string; pending: number; inflight: number };
}
export interface Preparation {
  /** Idempotent deterministic owned copy; verify original bytes, not just an import digest. */
  copy(request: Readonly<CutoverRequest>): Promise<Receipt>;
  /** Must query committed importer root or idempotently reexecute importCopiedLegacyTree.
   * Intent precedes effects; a crash before acknowledgement is NOT exactly-once execution. */
  importCopied(request: Readonly<CutoverRequest>): Promise<Receipt>;
}
const fail = () => new Error("Cutover rejected");
function safe<T>(body: () => T): T { try { return body(); } catch { throw fail(); } }
function ref(value: string) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(value)) throw fail();
  return value;
}
function digest(value: string) { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw fail(); return value; }
function requestSnapshot(r: CutoverRequest) {
  const base = { requestKey: ref(r.requestKey), sourceDigest: digest(r.sourceDigest), importHash: digest(r.importHash) };
  if (r.installation === undefined) return Object.freeze(base); // Preserve exact v1 request hashes.
  const binding = r.installation;
  if (binding.kind !== "copied-installation" || binding.version !== 2 || !binding.sources.length) throw fail();
  const sources = binding.sources.map(s => {
    if (typeof s.originalSessionId !== "string" || !s.originalSessionId.length || s.originalSessionId !== s.originalSessionId.trim() ||
      !Number.isSafeInteger(s.rootId) || s.rootId <= 0) throw fail();
    return Object.freeze({ originalSessionId: s.originalSessionId, sourceSHA256: digest(s.sourceSHA256),
      manifestSHA256: digest(s.manifestSHA256), importHash: digest(s.importHash), rootId: s.rootId });
  });
  if (new Set(sources.map(s => s.rootId)).size !== sources.length || new Set(sources.map(s => s.originalSessionId)).size !== sources.length) throw fail();
  return Object.freeze({ ...base, installation: Object.freeze({ kind: "copied-installation" as const, version: 2 as const, sources: Object.freeze(sources) }) });
}
/** Explicit sidecar initializer, never invoked by controller construction. Caller enables FK. */
export function initializeCutoverManifest(db: Database, assertOwner: () => void = () => {}) {
  initializeHostSchemaTables(db, assertOwner, [2, 3]);
}

export class HostCutoverController {
  private readonly identity: Readonly<CutoverIdentity>;
  private readonly ports: CutoverPorts;
  constructor(private readonly db: Database, identity: CutoverIdentity, ports: CutoverPorts) {
    this.identity = safe(() => Object.freeze({ domain: ref(identity.domain), incarnation: ref(identity.incarnation),
      ownerGeneration: identity.ownerGeneration, sourceEngineId: ref(identity.sourceEngineId), candidateStoreRef: ref(identity.candidateStoreRef) }));
    if (!Number.isSafeInteger(this.identity.ownerGeneration) || this.identity.ownerGeneration < 1 || this.identity.sourceEngineId === this.identity.candidateStoreRef) throw fail();
    this.ports = safe(() => Object.freeze({ assertOwner: ports.assertOwner.bind(ports),
      assertCurrentWriter: ports.assertCurrentWriter.bind(ports), checkDrained: ports.checkDrained.bind(ports) }));
  }
  private owner() { this.ports.assertOwner(this.identity); }
  private read() {
    const row = this.db.query("SELECT identity, request_hash, manifest FROM qualification_cutover_v1 WHERE domain=?")
      .get(this.identity.domain) as { identity: string; request_hash: string; manifest: string } | null;
    if (row && row.identity !== JSON.stringify(this.identity)) throw fail();
    return row;
  }
  private manifest(json: string): Manifest {
    const m: Manifest = JSON.parse(json);
    m.postCutoverCount = (this.db.query("SELECT count(*) AS n FROM qualification_cutover_work_v1 WHERE domain=?")
      .get(this.identity.domain) as { n: number }).n;
    return m;
  }
  inspect(): Manifest | null { return safe(() => { this.owner(); const row = this.read(); return row ? this.manifest(row.manifest) : null; }); }
  /** Application composition reuses this controller's trusted generation and SQL fence. */
  inspectApplication(root: Database, incarnation: string, request: CutoverRequest): Manifest | null {
    return safe(() => {
      if (root !== this.db || this.identity.domain !== incarnation || this.identity.incarnation !== incarnation) throw fail();
      this.owner();
      const row = this.read();
      if (row && row.request_hash !== hashCanonicalRequest(requestSnapshot(request))) throw fail();
      const m = row ? this.manifest(row.manifest) : null;
      this.ports.assertCurrentWriter(m?.writer ?? this.identity.sourceEngineId);
      if (m && m.writer !== (m.phase === "active" ? this.identity.candidateStoreRef : this.identity.sourceEngineId)) throw fail();
      this.owner(); return m;
    });
  }
  private drained(r: CutoverRequest) {
    const { sourceDigest, pending, inflight } = this.ports.checkDrained();
    if (sourceDigest !== r.sourceDigest || pending !== 0 || inflight !== 0) throw fail();
  }
  preflight(request: CutoverRequest): Manifest {
    return safe(() => {
      const r = requestSnapshot(request);
      return this.db.transaction(() => {
        this.owner(); this.ports.assertCurrentWriter(this.identity.sourceEngineId); this.drained(r);
        const prior = this.read(), hash = hashCanonicalRequest(r);
        if (prior) { if (prior.request_hash !== hash) throw fail(); this.owner(); return this.manifest(prior.manifest); }
        const m: Manifest = { phase: "source", revision: 0, writer: this.identity.sourceEngineId, postCutoverCount: 0, request: r, receipt: null };
        this.db.query("INSERT INTO qualification_cutover_v1 VALUES (?,?,?,?)").run(this.identity.domain, JSON.stringify(this.identity), hash, JSON.stringify(m));
        this.owner(); return m;
      }).immediate();
    });
  }
  private change(expected: number, phases: Phase[], body: (m: Manifest) => void, finalCheck?: () => void): Manifest {
    return safe(() => this.db.transaction(() => {
      this.owner(); const row = this.read(); if (!row) throw fail();
      const m: Manifest = this.manifest(row.manifest);
      if (m.revision !== expected || !phases.includes(m.phase)) throw fail();
      this.ports.assertCurrentWriter(m.writer); body(m); this.owner(); finalCheck?.(); m.revision++;
      // BEGIN IMMEDIATE serializes contenders; revision and phase were compared within this TX.
      this.db.query("UPDATE qualification_cutover_v1 SET manifest=? WHERE domain=? AND manifest=?")
        .run(JSON.stringify(m), this.identity.domain, row.manifest);
      this.owner(); finalCheck?.(); return m;
    }).immediate());
  }
  private receipt(value: Receipt, request: CutoverRequest) {
    const copy = Object.freeze({ sourceDigest: digest(value.sourceDigest), receiptHash: digest(value.receiptHash) });
    if (copy.sourceDigest !== request.sourceDigest || copy.receiptHash !== request.importHash) throw fail();
    return copy;
  }
  async begin(expectedRevision: number, preparation: Preparation): Promise<Manifest> {
    try {
      // Capture BOTH callbacks before the first await, never re-read caller options.
      const copy = preparation.copy.bind(preparation), importCopied = preparation.importCopied.bind(preparation);
      const intent = this.change(expectedRevision, ["source", "copying"], m => { this.drained(m.request); m.phase = "copying"; });
      const request = requestSnapshot(intent.request);
      this.receipt(await copy(request), request); this.owner();
      const receipt = this.receipt(await importCopied(request), request); this.owner();
      return this.change(intent.revision, ["copying"], m => { this.drained(m.request); m.receipt = receipt; });
    } catch { throw fail(); }
  }
  async verify(expectedRevision: number, verifier: (request: Readonly<CutoverRequest>, receipt: Readonly<Receipt>) => Promise<Receipt>) {
    try {
      const m = this.inspect(); if (!m || m.revision !== expectedRevision || m.phase !== "copying" || !m.receipt) throw fail();
      const request = requestSnapshot(m.request), receipt = Object.freeze({ ...m.receipt });
      const verified = this.receipt(await verifier(request, receipt), request); this.owner();
      return this.change(expectedRevision, ["copying"], next => { this.drained(next.request); next.phase = "verified"; next.receipt = verified; });
    } catch { throw fail(); }
  }
  /** Returns candidateReady data; caller alone may subsequently open the inactive host runtime. */
  commitWriter(expectedRevision: number, assertAdmissionGuard?: () => void) {
    return this.change(expectedRevision, ["verified"], m => {
      assertAdmissionGuard?.();
      this.drained(m.request); if (!m.receipt) throw fail();
      m.rollbackCheckpoint = this.rollbackFrontier();
      m.phase = "active"; m.writer = this.identity.candidateStoreRef;
    }, assertAdmissionGuard);
  }
  /** Call in the host acceptance transaction with the actual immutable operation binding.
   * Trusted caller port, not a queue. Does not deduplicate timeline publication or effects. */
  recordPostCutoverWork(expectedRevision: number, operation: { operationId: string; contentHash: string }) {
    return safe(() => {
      const id = ref(operation.operationId), hash = digest(operation.contentHash);
      return this.change(expectedRevision, ["active", "reconciliation_required"], m => {
        const prior = this.db.query("SELECT content_hash FROM qualification_cutover_work_v1 WHERE domain=? AND operation_id=?")
          .get(this.identity.domain, id) as { content_hash: string } | null;
        if (prior) { if (prior.content_hash !== hash) throw fail(); return; }
        this.db.query("INSERT INTO qualification_cutover_work_v1 VALUES (?,?,?)").run(this.identity.domain, id, hash);
        m.postCutoverCount = this.manifest(JSON.stringify(m)).postCutoverCount;
      });
    });
  }
  /** Concrete, read-only shared-host frontier. Missing composition schemas fail closed.
   * The authority domain is this entire host SQL store (conservative across chats).
   * Runtime submission/tool/answer commits require an accepted host source; bindings
   * are correlation evidence, never a caller's assertion of reconciliation. */
  private rollbackFrontier(): RollbackCheckpoint | null {
    const tables = ["service_effect_s01_sources", "service_effect_s01_operations", "service_effect_s01_operation_sources",
      "service_effect_s01_intents", "service_effect_s01_queued_inputs", "service_effect_s02_commits",
      "piclaw_durable_bindings_v1", "piclaw_durable_intent_bindings_v1"];
    if (tables.some(name => !this.db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))) return null;
    const rows = tables.map(table => this.db.query<Record<string, unknown>, []>(`SELECT * FROM ${table}`).all().map(row => {
      const copy: Record<string, string | number | null> = {};
      for (const [key, value] of Object.entries(row)) {
        // These host schemas contain JSON scalars only. Reject blobs/bigints rather
        // than silently coercing them (or hashing a Uint8Array as an object).
        if (value !== null && typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) throw fail();
        copy[key] = value;
      }
      return copy;
    }));
    // Canonical hashes are order independent; use exact rows, not MAX(seq)/counts.
    const hashes = (items: readonly CanonicalJsonValue[]) => items.map(row => hashCanonicalRequest(row)).sort();
    const sources = rows[0]!, operations = rows[1]!, memberships = rows[2]!;
    const accepted = sources.map(source => {
      const ids = new Set(memberships.filter(row => row.chat_jid === source.chat_jid && row.source_seq === source.source_seq)
        .map(row => row.operation_id));
      const evidence = rows.map((items, index) => hashes(index === 0 ? [source] : items.filter(row =>
        index >= 6 ? row.chat_jid === source.chat_jid && row.source_seq === source.source_seq : ids.has(row.operation_id))));
      // Cancellation/control sources may target an operation without being claimed.
      evidence.push(hashes(operations.filter(row => row.operation_id === source.target_operation_id)));
      if (typeof source.source_id !== "string") throw fail();
      return { sourceId: source.source_id, evidenceHash: hashCanonicalRequest(evidence) };
    }).sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.evidenceHash.localeCompare(b.evidenceHash));
    return { digest: hashCanonicalRequest(rows.map(hashes)), accepted };
  }
  private rollbackPlan(m: Manifest): RollbackPlan {
    const reasons: RollbackPlan["reasons"][number][] = [];
    const active = m.writer === this.identity.candidateStoreRef;
    const current = active ? this.rollbackFrontier() : null, checkpoint = m.rollbackCheckpoint;
    if (active && (!current || !checkpoint)) reasons.push("checkpoint_unavailable");
    const drained = this.ports.checkDrained();
    if (drained.sourceDigest !== m.request.sourceDigest) reasons.push("source_changed");
    if (drained.pending !== 0 || drained.inflight !== 0) reasons.push("host_not_drained");
    if (active && current && checkpoint && current.digest !== checkpoint.digest) reasons.push("accepted_work_changed");
    if (m.postCutoverCount) reasons.push("recorded_work");
    const unresolved = current?.accepted.filter(row => !checkpoint?.accepted.some(prior =>
      prior.sourceId === row.sourceId && prior.evidenceHash === row.evidenceHash)).map(row => row.sourceId) ?? [];
    return Object.freeze({ disposition: reasons.length ? "reconciliation_required" : "safe_to_restore", revision: m.revision,
      sourceDigest: m.request.sourceDigest, checkpointDigest: checkpoint?.digest ?? null, currentDigest: current?.digest ?? null,
      unresolvedAcceptedUUIDs: Object.freeze([...new Set(unresolved)].sort()), reasons: Object.freeze(reasons) });
  }
  /** Advisory only. No restore/activation API, reconciliation boolean, or ledger mutation.
   * Old journals without an actual host checkpoint cannot authorize active rollback. */
  prepareRollback(expectedRevision: number): RollbackPlan {
    return safe(() => this.db.transaction(() => {
      this.owner(); const row = this.read(); if (!row) throw fail();
      const m: Manifest = this.manifest(row.manifest);
      if (m.revision !== expectedRevision) throw fail();
      this.ports.assertCurrentWriter(m.writer);
      const plan = this.rollbackPlan(m); this.owner(); return plan;
    }).immediate());
  }
  rollback(expectedRevision: number) {
    // A blocked attempt must preserve revision, journal, accepted data and writer.
    if (this.prepareRollback(expectedRevision).disposition !== "safe_to_restore") throw new Error("Reconciliation required");
    let original: Manifest;
    const recheck = () => {
      if (this.rollbackPlan(original).disposition !== "safe_to_restore") throw fail();
      this.drained(original.request);
    };
    return this.change(expectedRevision, ["source", "copying", "verified", "active", "reconciliation_required"], m => {
      original = JSON.parse(JSON.stringify(m));
      if (this.rollbackPlan(m).disposition !== "safe_to_restore") throw fail();
      // Exact original snapshot and drained host admission are checked at the final
      // synchronous switch, inside the SAME SQL writer fence. No await/restore here.
      this.drained(m.request);
      m.phase = "source"; m.writer = this.identity.sourceEngineId; m.receipt = null;
    }, recheck);
  }
}
