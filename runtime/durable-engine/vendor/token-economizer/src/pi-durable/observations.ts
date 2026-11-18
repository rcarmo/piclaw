import { runIdentity } from "./run-identity.ts";
// SPDX-License-Identifier: Apache-2.0
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { JsonValue } from "@earendil-works/chord/json";
import { runnerVerdict, statusOfTests } from "../core/loopguard/verification.ts";
import { contentText } from "@earendil-works/pi-ai";
import { defineExtension, hook, LiveDoc, NestedCallDoc, ToolResultEntry, ToolTask, type ConversationId, type Harness, type LiveState, type TaskId } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { observing, type Policy } from "../core/config.ts";
import { makeObservation, redact } from "../core/observations.ts";
import { sessionKey } from "../core/sessions.ts";
import type { Observation } from "../core/types.ts";
import { ObservationsDoc, ToolMetadataDoc } from "./documents.ts";
import type { HostDomain, HostSession, ToolResultData } from "./domain.ts";
const liveResultSchema = Type.Array(Type.Object({taskId:Type.Optional(Type.Number()),details:Type.Optional(Type.Unknown())}));
const nestedSchema = Type.Object({isError:Type.Boolean(),structuredOutput:Type.Optional(Type.Unknown()),details:Type.Optional(Type.Unknown()),diagnostics:Type.Array(Type.Object({message:Type.String(),code:Type.Optional(Type.String())}))});
export function createCommittedObservations(options: {harness:() => Harness;domain:HostDomain;policy:(key:string) => Policy;onObservation:(host:HostSession,observation:Observation,live:boolean) => Promise<void>;onLive?:(conversationId:ConversationId,live:LiveState) => Promise<void>;onActivity?:(conversationId:ConversationId,at:number) => Promise<void>;onError:(error:Error) => void}) {
  let tail: Promise<void> = Promise.resolve();
  const tracked = new Set<TaskId>();
  const liveSignatures = new Map<ConversationId,string>();
  function queue(taskId: TaskId,result:ToolResultData,liveBoundary = true) {
    if (!tracked.has(taskId)) return;
    // The publication's exact result is retained before its source can retire. Queueing the SDK commit happens
    // in the next microtask, never from inside a synchronous observer. SDK dispatch precedes tool waiters.
    queueMicrotask(() => {
      const receipt = options.harness().commit(async tx => {
        const metadata = (await tx.doc(ToolMetadataDoc,String(taskId),null)).value;
        if (!metadata) return null;
        const key = sessionKey(metadata.host.scope,metadata.host.id);
        if (!observing(options.policy(key)) || metadata.mapping.semantic === "wrapper") return null;
        const decoded = options.domain.decode({...result,name:metadata.name}), truncated = decoded.output.length > 16_384;
        const status = metadata.mapping.semantic === "shell" ? statusOfTests(metadata.command) : null, verdict = runnerVerdict(decoded.output);
        const verification = status === null ? null : verdict !== null ? verdict ? "failed" : "passed" : status === "own" && decoded.exitCode !== null ? decoded.exitCode === 0 ? "passed" : "failed" : null;
        const observation = makeObservation({source:{conversation:String(metadata.host.conversationId),outerCall:String(metadata.outerTask),nestedKey:metadata.key,phase:"result"},sessionId:metadata.host.id,runId:metadata.runId,tool:metadata.name,mapping:metadata.mapping,completedNonProcess:metadata.mapping.semantic !== "shell",command:metadata.command,targets:metadata.targets,output:decoded.output.slice(-16_384),isError:result.isError,exitCode:decoded.exitCode,timedOut:decoded.timedOut,aborted:decoded.aborted,coverage:truncated || metadata.partial ? "partial" : decoded.coverage,at:metadata.at,verification});
        const state = await tx.doc(ObservationsDoc,key,null);
        if (state.ids.includes(observation.id)) return null;
        state.ids.push(observation.id);state.observations.push(observation);
        await tx.retireDoc(ToolMetadataDoc,String(taskId));
        return {host:{...metadata.host,scope:{...metadata.host.scope}},observation};
      },BACKGROUND_CONTEXT);
      const processed = tail.then(async () => {const recorded = await receipt;if (recorded) {tracked.delete(taskId);await options.onObservation(recorded.host,recorded.observation,liveBoundary);}});
      // Observe failures immediately even while an earlier guard event owns the processing line.
      void receipt.catch(() => {});
      tail = processed.catch(error => {options.onError(Error.isError(error) ? error : new Error(String(error)));});
    });
  }
  return {
    extension:defineExtension({name:"token-economizer.observations",hooks:[hook(ToolTask,{
      async afterTool(call,result,api,context) {
        const host = await options.domain.session(api.conversationId);
        if (!host || host.delegated || !observing(options.policy(sessionKey(host.scope,host.id)))) return result;
        const args = options.domain.arguments(call.name,call.arguments), mapping = options.domain.tool(call.name);
        if (mapping.semantic === "wrapper") return result;
        const stored = await options.harness().commit(async tx => {
          const live = await tx.doc(LiveDoc,api.conversationId);
          if (!observing(options.policy(sessionKey(host.scope,host.id)))) return false;
          (await tx.doc(ToolMetadataDoc,String(api.taskId),null)).value = {host,key:call.parent ? call.id.split("/").at(-1)! : null,outerTask:call.parent?.taskId ?? api.taskId,taskId:api.taskId,runId:live.run ? runIdentity(live.run) ?? "unanchored" : "ended",name:call.name,command:redact(args.command).slice(0,16_384),targets:args.targets.slice(0,128).map(redact),partial:args.coverage === "partial" || args.command.length > 16_384 || args.targets.length > 128,mapping,at:Date.now()};
          return true;
        },context);
        if (stored) tracked.add(api.taskId);
        return result;
      },
    })]}),
    attach() {
      return options.harness().observeCommits({
        advance(publication) {
          for (const change of publication.changes) {
            if (change.type === "document" && change.kind === "change" && change.record.kind === NestedCallDoc.definition.kind && Object.hasOwn(change.value,"result")) {
              const raw = change.value.result;Value.Assert(nestedSchema,raw);
              const task = publication.changes.find(candidate => candidate.type === "task" && candidate.value.id === change.value.taskId);
              if (!task || task.type !== "task") throw new Error("Nested result publication lacks its task receipt");
              // SAFETY: The SDK committed result contains only strict JSON; schema validation above preserves those values.
              const structured = (raw.structuredOutput ?? null) as JsonValue;
              // SAFETY: As above, details come from the SDK's strict-JSON document value.
              const details = (raw.details ?? null) as JsonValue;
              queue(task.value.id,{name:"",structured,details,output:"",isError:raw.isError,diagnostics:raw.diagnostics.map(diagnostic => ({code:diagnostic.code ?? "",message:diagnostic.message}))});
            }
            if (change.type === "entry" && ToolResultEntry.is(change.value)) {
              const message = change.value.model?.find(message => message.role === "toolResult");if (!message || message.role !== "toolResult") continue;
              const taskId = change.value.byTaskId;if (!taskId) continue;
              const live = publication.changes.find(candidate => candidate.type === "document" && candidate.kind === "change" && candidate.record.kind === LiveDoc.definition.kind);
              let details: JsonValue = message.details === undefined ? null : JSON.parse(JSON.stringify(message.details));
              if (details === null && live?.type === "document" && live.kind === "change" && live.value.tools !== undefined) {
                const slots = live.value.tools;Value.Assert(liveResultSchema,slots);
                // SAFETY: Public LiveDoc publication data is strict JSON; only its shape is narrowed above.
                details = (slots.find(slot => slot.taskId === taskId)?.details ?? null) as JsonValue;
              }
              queue(taskId,{name:message.toolName,structured:null,details,output:contentText(message.content),isError:message.isError,diagnostics:change.value.data.diagnostics.map(d => ({code:d.code ?? "",message:d.message}))});
            }
          }
          if (options.onActivity) for (const change of publication.changes) if (change.type === "entry") {
            const id = change.value.conversationId, at = Date.now();
            queueMicrotask(() => {tail = tail.then(() => options.onActivity!(id,at)).catch(error => options.onError(Error.isError(error) ? error : new Error(String(error))));});
          }
          if (options.onLive) for (const change of publication.changes) if (change.type === "document" && change.kind === "change" && change.record.kind === LiveDoc.definition.kind && change.conversationId !== undefined) {
            const id = change.conversationId;
            // SAFETY: This is the immutable public LiveDoc value published by the pinned SDK, selected by its definition kind.
            const live = change.value as LiveState;
            const signature = JSON.stringify([live.run?.taskId ?? null,live.run?.inputs ?? [],Boolean(live.run?.afterRun),live.runFailure?.taskId ?? null]);
            if (liveSignatures.get(id) === signature) continue;
            liveSignatures.set(id,signature);
            queueMicrotask(() => {tail = tail.then(() => options.onLive!(id,live)).catch(error => options.onError(Error.isError(error) ? error : new Error(String(error))));});
          }
        },end() {},
      });
    },
    async recover(host:HostSession) {
      const key = sessionKey(host.scope,host.id);
      if (!observing(options.policy(key)) || host.delegated) return;
      const prior = await options.harness().snapshot(ObservationsDoc,key,BACKGROUND_CONTEXT);
      for (const observation of prior?.observations ?? []) await options.onObservation(host,observation,false);
      const live = await options.harness().snapshot(LiveDoc,host.conversationId,BACKGROUND_CONTEXT);
      for (const slot of live?.tools ?? []) {
        if (slot.status !== "done" || !slot.taskId || !slot.entry) continue;
        const metadata = (await options.harness().snapshot(ToolMetadataDoc,String(slot.taskId),BACKGROUND_CONTEXT))?.value;
        if (!metadata) continue;
        const entry = await options.harness().commit(tx => tx.entry(ToolResultEntry,slot.entry!),BACKGROUND_CONTEXT);
        const message = entry?.model?.find(message => message.role === "toolResult");
        if (!entry || !message || message.role !== "toolResult") continue;
        tracked.add(slot.taskId);
        queue(slot.taskId,{name:slot.name,structured:null,details:message.details === undefined ? slot.details ?? null : JSON.parse(JSON.stringify(message.details)),output:contentText(message.content),isError:message.isError,diagnostics:entry.data.diagnostics.map(d => ({code:d.code ?? "",message:d.message}))},false);
      }
      for (const slot of live?.nestedTools ?? []) {
        if (slot.status !== "done") continue;
        const metadata = (await options.harness().snapshot(ToolMetadataDoc,String(slot.taskId),BACKGROUND_CONTEXT))?.value;
        if (!metadata?.key) continue;
        const source = await options.harness().snapshot(NestedCallDoc,slot.parentTaskId,metadata.key,BACKGROUND_CONTEXT);
        if (!source?.result) continue;
        tracked.add(slot.taskId);
        queue(slot.taskId,{name:slot.name,structured:source.result.structuredOutput ?? null,details:source.result.details ?? null,output:"",isError:source.result.isError,diagnostics:source.result.diagnostics.map(d => ({code:d.code ?? "",message:d.message}))},false);
      }
      // A crash can occur after the run's idle commit but before its observer queued learning.
      // Reconcile the saved live boundary after receipt recovery; run identity deduplicates it.
      await this.drained();
      if (live) await options.onLive?.(host.conversationId,live);
    },
    async drained() {await new Promise<void>(resolve => queueMicrotask(resolve));await tail;},
  };
}
