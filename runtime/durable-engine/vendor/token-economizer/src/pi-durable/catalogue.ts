// SPDX-License-Identifier: Apache-2.0
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineExtension, defineTask, type Harness, type ConversationId } from "@earendil-works/pi-durable";
import { emitting, type Policy } from "../core/config.ts";
import { repositoryActivity } from "../core/sessions.ts";
import { scopeKey, type Notice } from "../core/types.ts";
import { applyTools, pendingDelay, restoreTools } from "../core/toolprune/evidence.ts";
import { AutoWaitersDoc, KnowledgeDoc, SessionsDoc, type AutoWaiterItem } from "./documents.ts";
import { detach } from "./detach.ts";
import type { HostDomain, HostSession } from "./domain.ts";
import type { OperationSink } from "./operations.ts";
export function createCataloguePublication(options: {harness:() => Harness;backgroundOwner?:() => ConversationId;domain:HostDomain;policy:(key:string) => Policy;onNotice:(notice:Notice) => Promise<void>;onOperation?:OperationSink}) {
  const repositoryKey = (item:AutoWaiterItem) => JSON.stringify([item.scope.host,item.scope.repository]);
  async function apply(item:AutoWaiterItem,names:string[],named:boolean) {
    const startedAt = Date.now(), operationId = `apply:${crypto.randomUUID()}`;
    const catalogue = await options.domain.catalogue(item.host);
    const result = await options.harness().commit(async tx => {
      const knowledge = await tx.doc(KnowledgeDoc,scopeKey(item.scope),item.scope), next = detach(knowledge.tools), policy = options.policy(item.sessionKey);
      let reason: string|null = null;
      if (!emitting(policy) || policy.pruning === "off" || !named && policy.pruning !== "auto") reason = "Current policy prevents publication";
      else if (!catalogue.complete) reason = "A complete catalogue with provenance is required";
      else if (names.some(name => !catalogue.tools.some(tool => tool.name === name && !tool.protected) || next.used.includes(name) || !named && next.kept.includes(name))) reason = "A proposed tool is protected, retained, used or no longer available";
      if (reason) {
        next.refusal = reason;next.pending = null;knowledge.tools = next;
        await options.onOperation?.(tx,item.host.conversationId,{id:operationId,name:"optimizer.apply-tools",status:"failed",startedAt,at:Date.now(),input:{tools:names,automatic:!named},output:{error:reason}});
        return {added:[],reason};
      }
      // Publication rechecks current protection, rather than trusting the retained description catalogue.
      next.catalogue = next.catalogue.map(tool => ({...tool,protected:catalogue.tools.find(current => current.name === tool.name)?.protected ?? tool.protected}));
      // An explicit named Apply may precede the first evidence fold; do not report a false success.
      if (named) for (const name of names) if (!next.catalogue.some(tool => tool.name === name)) next.catalogue.push({...catalogue.tools.find(tool => tool.name === name)!});
      const added = applyTools(next,names,named);next.pending = null;next.refusal = null;knowledge.tools = next;
      if (added.length) await options.onOperation?.(tx,item.host.conversationId,{id:operationId,name:"optimizer.apply-tools",status:"complete",startedAt,at:Date.now(),input:{tools:names,automatic:!named},output:{hidden:added,effective:"Next session or resume"}});
      return {added,reason:null};
    },BACKGROUND_CONTEXT);
    if (result.added.length || result.reason) await options.onNotice({id:JSON.stringify([scopeKey(item.scope),"publication",result.added,result.reason]),code:result.reason ? "tool-publication-refused" : "tools-applied",text:result.reason ?? `Hid ${result.added.length === 1 ? "1 unused tool" : `${result.added.length} unused tools`} from the next session or resume. Restore them any time in Settings.`,sessionId:item.host.id,runId:null});
    return result;
  }
  const waiter = defineTask<{repository:string},{phase:"wait"},null>({name:"token-economizer.auto-publication",version:1,initial:() => ({phase:"wait"}),phases:{async wait(task,runtime,context) {
    const snapshot = (await runtime.snapshot(AutoWaitersDoc,context))!.repositories[task.input.repository];
    if (!snapshot) throw new Error("Missing automatic publication waiter");
    let delay = 600_000;
    for (const item of snapshot.items) {
      const knowledge = await runtime.snapshot(KnowledgeDoc,scopeKey(item.scope),context), sessions = await runtime.snapshot(SessionsDoc,context), policy = options.policy(item.sessionKey);
      if (!knowledge) throw new Error("Missing pending knowledge scope");
      const wait = pendingDelay(knowledge.tools,policy,runtime.now(),repositoryActivity(Object.values(sessions!.sessions),item.scope));
      if (wait === 0) await apply(item,knowledge.tools.pending!.items,false);
      if (wait === null || wait === 0) await runtime.commit(async tx => {
        const state = await tx.doc(AutoWaitersDoc), knowledge = await tx.doc(KnowledgeDoc,scopeKey(item.scope),item.scope);
        if (wait === null) knowledge.tools.pending = null;
        state.repositories[task.input.repository].items = state.repositories[task.input.repository].items.filter(row => scopeKey(row.scope) !== scopeKey(item.scope));
      },context);
      else delay = Math.min(delay,wait);
    }
    await runtime.commit(async tx => {
      const state = await tx.doc(AutoWaitersDoc), current = state.repositories[task.input.repository];
      if (!current.items.length) {current.task = null;return {status:"terminal",outcome:{status:"completed",result:null}};}
      return {status:"sleeping",until:runtime.now()+delay,checkpoint:{phase:"wait"}};
    },context);
  }},async abort(task,runtime,context) {
    await runtime.commit(async tx => {const row = (await tx.doc(AutoWaitersDoc)).repositories[task.input.repository];if (row) row.task = null;return {status:"terminal",outcome:{status:"aborted",result:null,reason:"Automatic publication cancelled"}};},context);
  }});
  return {extension:defineExtension({name:"token-economizer.catalogue",tasks:[waiter]}),apply,
    async restore(host:HostSession,names?:string[]) {
      const startedAt = Date.now(), operationId = `restore:${crypto.randomUUID()}`;
      const removed = await options.harness().commit(async tx => {
        const knowledge = await tx.doc(KnowledgeDoc,scopeKey(host.scope),host.scope), next = detach(knowledge.tools), requested = names ?? [...next.applied], removed = restoreTools(next,names);next.pending = null;knowledge.tools = next;
        if (removed.length) await options.onOperation?.(tx,host.conversationId,{id:operationId,name:"optimizer.restore-tools",status:"complete",startedAt,at:Date.now(),input:{tools:requested},output:{restored:removed,effective:"Next session or resume",sticky:true}});
        return removed;
      },BACKGROUND_CONTEXT);
      if (removed.length) await options.onNotice({id:JSON.stringify([scopeKey(host.scope),"restore",removed]),code:"tools-restored",text:`Restored ${removed.length === 1 ? "1 hidden tool" : `${removed.length} hidden tools`} from the next session or resume. They won’t be hidden again unless you ask.`,sessionId:host.id,runId:null});return removed;
    },
    async wait(item:AutoWaiterItem) {
      await options.harness().commit(async tx => {
        const knowledge = await tx.doc(KnowledgeDoc,scopeKey(item.scope),item.scope), policy = options.policy(item.sessionKey);
        if (!emitting(policy) || policy.pruning !== "auto") {knowledge.tools.pending = null;return;}
        if (!knowledge.tools.pending) return;
        const state = await tx.doc(AutoWaitersDoc), key = repositoryKey(item), current = state.repositories[key] ?? {task:null,items:[]};
        current.items = [...current.items.filter(row => scopeKey(row.scope) !== scopeKey(item.scope)),item];
        if (current.task) {const task = await tx.task(current.task);if (task?.state.status === "terminal") current.task = null;}
        if (!current.task) current.task = await tx.createTask(waiter,{repository:key},{ownership:{kind:"conversation"},conversationId:options.backgroundOwner?.() ?? item.host.conversationId,background:true});
        state.repositories[key] = current;
      },BACKGROUND_CONTEXT);
    },
  };
}
