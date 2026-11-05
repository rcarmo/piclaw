import type { Database } from "bun:sqlite";
import { admitSqliteWrite } from "../../src/db/sqlite-async-admission.js";
import { apply } from "@earendil-works/chord/delta";
import { hashCanonicalRequest } from "../../src/service-effects/contracts/common.js";
import { storeMessageInDatabase } from "../../src/db/messages.js";
import type { StoreWebMessageOptions } from "../../src/channels/web/messaging/message-store.js";

export interface NativeSessionTarget {
  readonly domain: string;
  readonly chatJid: string;
  readonly branchId: string;
  readonly conversationId: number;
  readonly sessionId: string;
  readonly revision: string;
}
export interface ApplicationHostInput {
  source: "remote_peer" | "regrets.command";
  sourceId: string;
  text: string;
  queuedAt: string;
  /** Supplied by verified ingress, never inferred from a model/tool source. */
  principal: { id: string; revision: string };
  target: NativeSessionTarget;
  mode?: "queue";
  /** Synchronous current owner/peer policy check. Never persisted. */
  assertCurrent(): void;
}
type Route = Omit<NativeSessionTarget, "domain" | "revision">;

/** Application-owned ingress; no runner, task lifetime, session emulation or provider IO. */
export function createApplicationHostInput(options: {
  root: Database; domain: string; assertCurrent(): void; routes(): readonly Route[];
  admission(chat: string, provenance: string): StoreWebMessageOptions["acceptSource"];
  submit(chat: string, sourceId: string, rowId: number, whenBusy: "steer" | "followUp"): Promise<{submission_id:number;queued:boolean}>;
}) {
  const { root } = options;
  const canonical = (s: unknown): s is string => typeof s === "string" && !!s && s.trim() === s;
  function mapping(): { domain: string; bindings: Route[] } | undefined {
    const docs = root.query(`SELECT id FROM documents WHERE kind='"app.application-conversations"'
      AND scope_kind='conversation' AND owner_id=1 AND retired_at IS NULL`).all() as { id: number }[];
    if (!docs.length) return undefined; // copied public-SDK bundles have an explicit manifest instead
    if (docs.length !== 1) throw Error("Ambiguous application mapping");
    let value: any;
    for (const row of root.query("SELECT kind,version,content FROM document_revisions WHERE document_id=? ORDER BY seq").all(docs[0].id) as { kind: string; version: number; content: string }[]) {
      if (row.version !== 1) throw Error("Unsupported application mapping version");
      if (row.kind === "base") value = JSON.parse(row.content);
      else if (row.kind === "delta" && value) value = apply(value, JSON.parse(row.content));
      else throw Error("Invalid application mapping");
    }
    if (!value || value.domain !== options.domain || !Array.isArray(value.bindings)) throw Error("Invalid application mapping");
    return value;
  }
  function list(): readonly NativeSessionTarget[] {
    options.assertCurrent();
    const doc = mapping();
    return Object.freeze(options.routes().map(route => {
      const identity = { domain: options.domain, chatJid: route.chatJid, branchId: route.branchId,
        conversationId: route.conversationId, sessionId: route.sessionId };
      if (doc && !doc.bindings.some(b => b.chatJid === route.chatJid && b.branchId === route.branchId &&
        b.conversationId === route.conversationId && b.sessionId === route.sessionId)) throw Error("Application routing changed");
      return Object.freeze({ ...identity, revision: hashCanonicalRequest(identity) });
    }));
  }
  function resolve(target: NativeSessionTarget): NativeSessionTarget {
    const found = list().find(b => b.chatJid === target.chatJid);
    if (!found || Object.keys(found).some(k => found[k as keyof NativeSessionTarget] !== target[k as keyof NativeSessionTarget]))
      throw Error("Exact native session target required");
    return found;
  }
  async function admitApplicationInput(raw: ApplicationHostInput, whenBusy: "steer" | "followUp" = "followUp") {
    // Copy all persisted authority before callbacks can mutate caller-owned objects.
    const input = { ...raw, target: { ...raw.target }, principal: { ...raw.principal } };
    if (!["remote_peer", "regrets.command"].includes(input.source) || (input.mode !== undefined && input.mode !== "queue"))
      throw Error("Unsupported application input source or mode");
    if (![input.sourceId, input.principal.id, input.principal.revision].every(canonical) ||
      typeof input.text !== "string" || !input.text.trim() || input.text.length > 100_000 ||
      !canonical(input.queuedAt) || !Number.isFinite(Date.parse(input.queuedAt)) || typeof input.assertCurrent !== "function")
      throw Error("Invalid application input authority or payload");
    const check = () => {
      options.assertCurrent(); resolve(input.target);
      const result: unknown = input.assertCurrent();
      if (result !== undefined) { void Promise.resolve(result).catch(() => {}); throw Error("Application input guard must be synchronous"); }
      options.assertCurrent(); resolve(input.target);
    };
    const receipt=await admitSqliteWrite(root, () => {
      const provenance=`application:pi-durable:${hashCanonicalRequest({source:input.source,principal:input.principal,target:input.target})}`;
      const admit=options.admission(input.target.chatJid,provenance);
      if(!admit)throw Error("Native source admission unavailable");
      const prior=root.query("SELECT rowid,content,timestamp,is_bot_message FROM messages WHERE chat_jid=? AND id=?").get(input.target.chatJid,input.sourceId) as {rowid:number;content:string;timestamp:string;is_bot_message:number}|null;
      if(prior&&(prior.content!==input.text||prior.is_bot_message!==0))throw Error("Application input identity conflict");
      const message={id:input.sourceId,chat_jid:input.target.chatJid,sender:input.source,sender_name:input.principal.id,content:input.text,
        timestamp:prior?.timestamp??input.queuedAt,is_from_me:false,is_bot_message:false,
        ...(input.source==="remote_peer"?{content_blocks:[{type:"peer_message",peer_instance_id:input.principal.id,message_id:input.sourceId}]}: {})};
      const rowId=prior?.rowid??storeMessageInDatabase(root,message);
      check();admit({message,rowId,database:root});check();
      return Object.freeze({ sourceId: input.sourceId, chatJid: input.target.chatJid, rowId, target: Object.freeze(input.target) });
    }, check);
    // The verified ingress grant was committed above. Submit the same accepted
    // source to the SDK; transport disconnect is not permission to replay it.
    options.assertCurrent();resolve(input.target);
    const submitted=await options.submit(receipt.chatJid,receipt.sourceId,receipt.rowId,whenBusy);
    return Object.freeze({...receipt,submission_id:submitted.submission_id,mode:whenBusy==="steer"&&submitted.queued?"steer" as const:"new_input" as const});
  }
  const steerApplicationInput=(input:ApplicationHostInput)=>admitApplicationInput(input,"steer");
  return Object.freeze({ steerApplicationInput, sessionTargets: Object.freeze({ list, resolve }), admitApplicationInput });
}
