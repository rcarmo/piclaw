/** Host-owned single-operator context for installed add-ons. No browser/model identity grants. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { getWorkspaceDir } from "../core/config.js";
import { readAccessConfig } from "../core/config-access.js";
import { getChatContext } from "../core/chat-context.js";
import { getExecutionIdentity } from "../core/execution-context.js";
import { getSessionActivitySnapshot } from "../extensions/session-status.js";
import { getDb } from "../db/connection.js";
import {
  parseAddonLocalAuthorityReference,
  withAddonLocalDispatch,
  verifyAddonLocalMessage,
  type AddonLocalAuthorityReference,
} from "./local-dispatch.js";
import type { AuthenticatedPrincipal as WebPrincipal } from "../core/access-types.js";

interface LocalHostRequest { chatJid: string; content: string; mode: 'queue'; source: string }
interface LocalHostReceipt { status: 'ok'; chat_jid: string; row_id?: number | null; thread_id: number | null; queued?: 'followup' | 'steer'; created: boolean }

export interface AddonLocalTarget {
  readonly chatJid: string;
  /** Persisted chat branch ID, independent of Pi session/context rotation. */
  readonly incarnation: string;
  readonly agentName: string;
  readonly label: string;
  readonly active: boolean;
}
export interface AddonLocalTargetSelector { chatJid?: string; agentName?: string; incarnation?: string }
export interface AddonLocalQueueReceipt {
  status: "accepted";
  chatJid: string;
  incarnation: string;
  rowId: number | null;
  threadId: number | null;
  queued: boolean;
}
export interface AddonLocalContext {
  readonly version: 1;
  readonly accessMode: "single-user";
  readonly ownerId: string;
  readonly actorId: string;
  readonly kind: "operator" | "agent";
  readonly workspaceRoot: string;
  readonly workspaceId: string;
  readonly chatJid?: string;
  readonly chatIncarnation?: string;
  readonly reference?: AddonLocalAuthorityReference;
  listTargets(): Promise<AddonLocalTarget[]>;
  resolveTarget(selector: AddonLocalTargetSelector): Promise<AddonLocalTarget | null>;
  enqueue(request: {
    target: Pick<AddonLocalTarget, "chatJid" | "incarnation">;
    content: string;
    mode: "queue";
    reference?: AddonLocalAuthorityReference;
  }): Promise<AddonLocalQueueReceipt>;
}
export class AddonLocalContextError extends Error {
  constructor(public readonly code: string, message: string, public readonly delivery: "rejected" | "unknown" = "rejected") {
    super(message);
    this.name = "AddonLocalContextError";
  }
}
interface Scope {
  ownerId: string;
  actorId: string;
  kind: "operator" | "agent";
  target?: AddonLocalTarget;
  reference?: AddonLocalAuthorityReference;
  active: boolean;
  valid: () => boolean;
  request?: Request;
}
const requests = new WeakMap<Request, { principal: WebPrincipal; stillValid: () => boolean }>();
const scopes = new AsyncLocalStorage<Scope | null>();
interface PromptAdmission { chatJid: string; incarnation: string; reference?: AddonLocalAuthorityReference; consumed: boolean }
const promptAdmissions = new AsyncLocalStorage<PromptAdmission | null>();
const activeAgentScopes = new Map<string, Set<Scope>>();
let enqueueMessage: ((request: LocalHostRequest) => Promise<LocalHostReceipt>) | null = null;
let isActive: (chatJid: string) => boolean = chatJid => Boolean(getSessionActivitySnapshot(chatJid)?.isStreaming);

/** Called only by the HTTP guard after authentication, CSRF and access-mode checks. */
export function admitAddonLocalRequest(req: Request, principal: WebPrincipal | null, stillValid: () => boolean): void {
  requests.delete(req);
  if (readAccessConfig().mode !== "single-user" || principal?.userId !== "default" || principal.mode !== "single-user" || principal.role !== "admin") return;
  requests.set(req, { principal: Object.freeze({ ...principal }), stillValid });
}
export function setAddonLocalContextHost(host: {
  enqueue: (request: LocalHostRequest) => Promise<LocalHostReceipt>;
  isActive?: (chatJid: string) => boolean;
} | null): void {
  enqueueMessage = host?.enqueue ?? null;
  isActive = host?.isActive ?? (chatJid => Boolean(getSessionActivitySnapshot(chatJid)?.isStreaming));
}
function available(): boolean {
  return readAccessConfig().mode === "single-user"
    && (!getExecutionIdentity() || getExecutionIdentity()!.mode === "single-user");
}
/** Read-only persisted single-user targets; does not create an operator context. */
export function listAddonLocalTargets(): AddonLocalTarget[] {
  const rows = getDb().query(`SELECT chat_jid, branch_id, agent_name FROM chat_branches
    WHERE archived_at IS NULL AND handle_owner_id = '' AND chat_jid LIKE 'web:%'
    ORDER BY agent_name, chat_jid`).all() as Array<{ chat_jid: string; branch_id: string; agent_name: string }>;
  return rows.map(row => Object.freeze({ chatJid: row.chat_jid, incarnation: row.branch_id,
    agentName: row.agent_name, label: row.agent_name, active: isActive(row.chat_jid) }));
}
function resolveTarget(selector: AddonLocalTargetSelector): AddonLocalTarget | null {
  if (!selector || typeof selector !== "object") throw new AddonLocalContextError("invalid_target", "A local target selector is required.");
  const chatJid = typeof selector.chatJid === "string" ? selector.chatJid.trim() : "";
  const name = typeof selector.agentName === "string" ? selector.agentName.trim().replace(/^@/, "").toLowerCase() : "";
  if (Boolean(chatJid) === Boolean(name)) throw new AddonLocalContextError("invalid_target", "Provide exactly one chatJid or agentName.");
  const target = listAddonLocalTargets().find(t => chatJid ? t.chatJid === chatJid : t.agentName === name) ?? null;
  if (selector.incarnation !== undefined && (!target || selector.incarnation !== target.incarnation)) return null;
  return target;
}
function assertScope(scope: Scope): void {
  if (!available() || !scope.active || scopes.getStore() !== scope || !scope.valid()) throw new AddonLocalContextError("context_unavailable", "Verified local add-on context is unavailable.");
  if (scope.target && !resolveTarget({ chatJid: scope.target.chatJid, incarnation: scope.target.incarnation })) {
    throw new AddonLocalContextError("stale_caller", "The calling chat lifetime is no longer active.");
  }
}
function contextFor(scope: Scope): AddonLocalContext {
  assertScope(scope);
  const workspaceRoot = realpathSync(getWorkspaceDir());
  const workspaceId = createHash("sha256").update(workspaceRoot).digest("hex");
  const check = () => {
    assertScope(scope);
    if (realpathSync(getWorkspaceDir()) !== workspaceRoot) throw new AddonLocalContextError("workspace_changed", "The configured workspace changed.");
  };
  return Object.freeze({
    version: 1, accessMode: "single-user", ownerId: scope.ownerId, actorId: scope.actorId,
    kind: scope.kind, workspaceRoot, workspaceId,
    ...(scope.target ? { chatJid: scope.target.chatJid, chatIncarnation: scope.target.incarnation } : {}),
    ...(scope.reference ? { reference: scope.reference } : {}),
    async listTargets() { check(); return listAddonLocalTargets(); },
    async resolveTarget(selector: AddonLocalTargetSelector) { check(); return resolveTarget(selector); },
    async enqueue(request: {
      target: Pick<AddonLocalTarget, "chatJid" | "incarnation">;
      content: string;
      mode: "queue";
      reference?: AddonLocalAuthorityReference;
    }) {
      check();
      if (scope.kind !== "operator") throw new AddonLocalContextError("operator_required", "Only the local operator may dispatch add-on work.");
      if (scope.request?.method !== "POST") throw new AddonLocalContextError("mutation_required", "Dispatch requires a guarded POST action.");
      if (request?.mode !== "queue" || typeof request.content !== "string" || !request.content.trim() || Buffer.byteLength(request.content) > 32768) {
        throw new AddonLocalContextError("invalid_message", "A queue-mode message of 1–32768 bytes is required.");
      }
      if (/^\s*[/@]/.test(request.content)) throw new AddonLocalContextError("invalid_message", "Add-on dispatch must be plain instruction text, not a command or routed mention.");
      let reference: AddonLocalAuthorityReference | null;
      try {
        reference = parseAddonLocalAuthorityReference(request.reference);
      } catch {
        throw new AddonLocalContextError("invalid_reference", "Dispatch reference must include bounded addonId and intentId.");
      }
      if (!request.target?.incarnation) throw new AddonLocalContextError("invalid_target", "A target lifetime is required.");
      const target = resolveTarget({ chatJid: request.target.chatJid, incarnation: request.target.incarnation });
      if (!target) throw new AddonLocalContextError("stale_target", "The selected local target is unavailable or has been replaced.");
      if (!enqueueMessage) throw new AddonLocalContextError("queue_unavailable", "The host queue is unavailable.");
      // The host bridge attaches durable provenance. Any optional reference is validated here and bound only to host-owned authority records.
      try {
        const deliver = enqueueMessage;
        const result = await withAddonLocalDispatch(target, request.content, reference, () => deliver({ chatJid: target.chatJid, content: request.content, mode: "queue", source: "addon.local-context" }), {
          signal: scope.request?.signal,
          validate: () => {
            check(); scope.request?.signal.throwIfAborted();
            if (!resolveTarget({ chatJid: target.chatJid, incarnation: target.incarnation })) throw new AddonLocalContextError('stale_target', 'The local target changed before admission.');
          },
        });
        if (result.status !== "ok" || result.chat_jid !== target.chatJid) throw new Error("Unrecognised host queue receipt.");
        return { status: "accepted" as const, chatJid: target.chatJid, incarnation: target.incarnation,
          rowId: result.row_id ?? null, threadId: result.thread_id ?? null, queued: Boolean(result.queued) };
      } catch (error) {
        if (error instanceof AddonLocalContextError) throw error;
        throw new AddonLocalContextError("delivery_unknown", "The host did not return a verified queue receipt; reconcile before retrying.", "unknown");
      }
    },
  });
}
/** Restrict browser context lifetime to the direct registered handler invocation. */
export async function withAddonLocalRequest<T>(req: Request, run: (context: AddonLocalContext | null) => Promise<T>): Promise<T> {
  const admission = requests.get(req);
  if (!admission || !available() || !admission.stillValid()) return scopes.run(null, () => run(null));
  const scope: Scope = { ownerId: admission.principal.userId, actorId: admission.principal.userId,
    kind: "operator", active: true, valid: admission.stillValid, request: req };
  try { return await scopes.run(scope, () => run(contextFor(scope))); }
  finally { scope.active = false; }
}
/** Core-only: enter only after verifying persisted local-dispatch provenance. */
export async function withAddonLocalAgent<T>(chatJid: string, incarnation: string, reference: AddonLocalAuthorityReference | undefined, run: () => Promise<T>): Promise<T> {
  if (!available()) return withoutAddonLocalContext(run);
  const target = resolveTarget({ chatJid, incarnation });
  if (!target) return withoutAddonLocalContext(run);
  const scope: Scope = { ownerId: "default", actorId: target.incarnation, kind: "agent", target,
    ...(reference ? { reference } : {}), active: true, valid: () => getChatContext()?.chatJid === chatJid };
  const set = activeAgentScopes.get(chatJid) ?? new Set<Scope>();
  set.add(scope); activeAgentScopes.set(chatJid, set);
  try { return await scopes.run(scope, run); }
  finally { scope.active = false; set.delete(scope); if (!set.size) activeAgentScopes.delete(chatJid); }
}
export function withoutAddonLocalContext<T>(run: () => Promise<T>): Promise<T> { return scopes.run(null, run); }

export async function withVerifiedAddonMessage<T>(chatJid: string, message: { id?: string; content?: string; content_blocks?: unknown[] }, run: () => Promise<T>): Promise<T> {
  const authority = await verifyAddonLocalMessage(chatJid, message);
  if (!authority) return promptAdmissions.run(null, () => withoutAddonLocalContext(run));
  return promptAdmissions.run({ chatJid, incarnation: authority.incarnation, ...(authority.reference ? { reference: authority.reference } : {}), consumed: false }, () => withoutAddonLocalContext(run));
}

/** Consume at the real prompt orchestrator; nested prompts must never inherit authority. */
export function withAddonLocalPrompt<T>(chatJid: string, eligible: boolean, run: () => Promise<T>): Promise<T> {
  const admission = promptAdmissions.getStore();
  if (!eligible || !admission || admission.consumed || admission.chatJid !== chatJid) return withoutAddonLocalContext(run);
  admission.consumed = true;
  return withAddonLocalAgent(chatJid, admission.incarnation, admission.reference, run);
}

/** Direct injection into a running Pi session invalidates scoped agent authority. */
export function revokeAddonLocalAgent(chatJid: string): void {
  for (const scope of activeAgentScopes.get(chatJid) ?? []) scope.active = false;
}
export const addonLocalContextApi = Object.freeze({
  version: 1 as const,
  getRequestContext(req: Request): AddonLocalContext | null {
    const scope = scopes.getStore();
    if (!requests.has(req) || scope?.kind !== "operator" || scope.request !== req) return null;
    try { return contextFor(scope); } catch { return null; }
  },
  getToolContext(): AddonLocalContext | null {
    const scope = scopes.getStore();
    if (scope?.kind !== "agent") return null;
    try { return contextFor(scope); } catch { return null; }
  },
});
