// SPDX-License-Identifier: Apache-2.0
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineExtension, defineTask, type Harness, type ConversationId, type Tx } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { inferenceAllowed, observing, type Policy } from "../core/config.ts";
import { fingerprint } from "../core/identity.ts";
import { auditSelected } from "../core/savers.ts";
import { logisticScore } from "../core/classify/logistic.ts";
import { classificationScore, loopDecision } from "../core/classify/routing.ts";
import { provenanceMatches } from "../core/classify/artifacts.ts";
import { retainSamples } from "../core/classify/samples.ts";
import type { Sample } from "../core/classify/contracts.ts";
import { judgePrompt, parseJudge } from "../core/loopguard/judge.ts";
import { writerPrompt, parseWriter } from "../core/loopguard/writer.ts";
import type { JudgeVerdict } from "../core/loopguard/rules.ts";
import { scopeKey, type InferenceRequest } from "../core/types.ts";
import { ClassifiersDoc, ReuseDoc, GuardJobsDoc, JobsDoc, RunDoc, type GuardJob } from "./documents.ts";
import { detach } from "./detach.ts";
import type { createInferenceQueue } from "./sidecall.ts";
const classifierSchema = Type.Object({label:Type.Union([Type.String(),Type.Null()]),probabilities:Type.Record(Type.String(),Type.Number())});
export function createGuardJobs(options: {harness:() => Harness;backgroundOwner?:() => ConversationId;policy:(key:string) => Policy;queue:ReturnType<typeof createInferenceQueue>}) {
  async function call(job:GuardJob,purpose:"loop-judge"|"writer"|"classifier"|"audit",prompt:string,policy:Policy) {
    const model = purpose === "classifier" ? job.classifier : purpose === "writer" ? job.writerModel : job.model;if (!model) return null;
    const id = job.effect.id+"/"+purpose;
    const classification = purpose === "classifier" ? {id,model,purpose:"loop" as const,state:job.effect.digest,labels:{productive:"The process is making progress",stuck:"A repetitive unproductive dead-end",uncertain:"Insufficient evidence"},deadlineMs:policy.budget.deadlineMs} : undefined;
    const request:InferenceRequest = {id,purpose,model,prompt,maxOutputTokens:policy.budget.maxOutputTokens,deadlineMs:policy.budget.deadlineMs};
    if (classification) request.classification = classification;
    if (purpose === "audit") request.auditFor = "loop";
    const admitted = await options.queue.enqueue(job.host.conversationId,request,{sessionKey:job.sessionKey,account:JSON.stringify([job.host.scope.host,model.provider]),runId:job.effect.runId,revision:job.revision,digest:fingerprint(job.effect.digest),estimatedMaximumCost:null});
    if (!admitted.job?.taskId) return null;
    await options.harness().waitForTask(admitted.job.taskId,BACKGROUND_CONTEXT);
    const result = (await options.harness().snapshot(JobsDoc,BACKGROUND_CONTEXT))!.jobs[id];return result.status === "complete" ? result.result : null;
  }
  const worker = defineTask<{id:string},{phase:"judge"},null>({name:"token-economizer.guard-judge",version:1,initial:() => ({phase:"judge"}),phases:{async judge(task,runtime,context) {
    const source = (await runtime.snapshot(GuardJobsDoc,context))!.jobs[task.input.id];if (!source) throw new Error("Missing guard pipeline");
    const job = structuredClone(source), policy = options.policy(job.sessionKey), scope = scopeKey(job.host.scope);
    if (!observing(policy) || policy.loop !== "judge") {
      await runtime.commit(async tx => {const row = (await tx.doc(GuardJobsDoc)).jobs[job.effect.id];row.status = "complete";row.result = {id:job.effect.id,runId:job.effect.runId,segment:job.effect.segment,verdict:null,writer:null};return {status:"terminal",outcome:{status:"completed",result:null}};},context);return;
    }
    let verdict: JudgeVerdict | null = null, written: string | null = null, reference: JudgeVerdict | null = null, textScore: number | null = null, local = false, reused = false;
    let localMs = 0, localPredictions = 0;
    let referenceModel = job.model, classifierModel = job.classifier;
    const cache = job.reuse && policy.savers.reuse ? (await runtime.snapshot(ReuseDoc,context))?.items[job.reuse.key] : null;
    if (cache && cache.canonical === job.reuse!.canonical) {verdict = cache.verdict;written = cache.writer;local = true;reused = true;}
    const data = await runtime.snapshot(ClassifiersDoc,scope,context), artifact = data?.loop, frozenSample = data?.samples.find(row => row.id === job.sampleId);
    if (!verdict && policy.savers.localLoop && job.features && frozenSample && artifact?.model && artifact.identity.id === job.artifactId && provenanceMatches(artifact.identity.provenance,frozenSample,null)) {
      const began = performance.now(), decision = loopDecision(logisticScore(artifact.model,job.features),artifact.identity,policy.savers.authorizeLocalStuck);
      localMs += performance.now()-began;localPredictions++;
      if (decision.kind === "label") {verdict = {stuck:decision.label === "stuck",confidence:1,reason:"local-approved-band"};local = true;}
    }
    if (!verdict && ["classifier","cascade"].includes(policy.judge) && inferenceAllowed(policy) && job.classifier) {
      const result = await call(job,"classifier",job.effect.digest,policy);
      if (result) {
        classifierModel = result.model;
        // Host classifier transport emits its canonical result as JSON, never provider-specific payloads.
        try {
          const raw: unknown = JSON.parse(result.text);Value.Assert(classifierSchema,raw);
          textScore = classificationScore({...raw,model:job.classifier,usage:result.usage,cost:result.cost,error:result.error,authUnavailable:result.authUnavailable,durationMs:result.durationMs},["productive","stuck","uncertain"],"stuck");
        } catch {textScore = null;}
        const textArtifact = data?.text.find(artifact => artifact.tool === null && frozenSample?.complete && provenanceMatches(artifact.provenance,frozenSample,job.classifier));
        const decision = loopDecision(textScore,textArtifact ?? null,policy.savers.authorizeLocalStuck);
        if (decision.kind === "label") {verdict = {stuck:decision.label === "stuck",confidence:1,reason:"text-approved-band"};local = true;}
      }
    }
    if (!verdict && ["generative","cascade"].includes(policy.judge) && inferenceAllowed(policy)) {
      const result = await call(job,"loop-judge",judgePrompt(job.effect.digest),policy);reference = result ? parseJudge(result.text) : null;if (result) referenceModel = result.model;verdict = reference;
    }
    const audited = (local || job.compactFull !== null) && auditSelected(scope,job.effect.id,policy.savers.auditPercent) && inferenceAllowed(options.policy(job.sessionKey));
    if (audited) {const result = await call(job,"audit",judgePrompt(job.compactFull ?? job.effect.digest),policy);reference = result ? parseJudge(result.text) : null;if (result) referenceModel = result.model;}
    if (job.compactFull && !audited) reference = null;
    // Deliberately no run-freshness/budget-count check here: reference worker writing precedes publication,
    // even when the originating run already ended. The queue still enforces current master and spend limits.
    if (!reused && verdict?.stuck && verdict.confidence >= job.threshold && !job.template && inferenceAllowed(options.policy(job.sessionKey))) {
      const result = await call(job,"writer",writerPrompt(job.effect.digest),policy);written = result ? parseWriter(result.text) : null;
    }
    runtime.signal.throwIfAborted();
    await runtime.commit(async tx => {
      const jobs = await tx.doc(GuardJobsDoc), current = jobs.jobs[job.effect.id], classifiers = await tx.doc(ClassifiersDoc,scope,null);
      const enabled = observing(options.policy(job.sessionKey)) && options.policy(job.sessionKey).loop === "judge";
      current.status = "complete";current.result = {id:job.effect.id,runId:job.effect.runId,segment:job.effect.segment,verdict:enabled ? verdict : null,writer:enabled ? written : null};
      const run = await tx.doc(RunDoc,job.sessionKey,null), fresh = !run.closed && run.guard?.runId === job.effect.runId && run.guard.segment === job.effect.segment && run.guard.judge_pending?.id === job.effect.id;
      const sample = classifiers.samples.find(row => row.id === job.sampleId);
      if (enabled && fresh && sample && reference && (reference.stuck === false || reference.stuck === true && reference.confidence >= job.threshold)) {
        sample.label = reference.stuck ? 1 : 0;sample.source = audited ? "audit" : "reference";
        sample.uniform = audited || !local && !(policy.savers.localLoop && artifact?.identity.state === "active_bands") && !data?.text.some(artifact => artifact.state === "active_bands" && artifact.provenance.featureVersion === frozenSample?.featureVersion && artifact.provenance.backend?.id === job.classifier?.id);
        sample.teacher = referenceModel;sample.classifier = classifierModel;sample.textScore = textScore;
      }
      if (enabled && job.reuse && verdict && verdict.stuck !== null && !reused) {const cache = await tx.doc(ReuseDoc);cache.items[job.reuse.key] = {canonical:job.reuse.canonical,verdict,writer:written};const keys = Object.keys(cache.items);for (const key of keys.slice(0,Math.max(0,keys.length-64))) delete cache.items[key];}
      if (enabled && reused) (await tx.doc(ReuseDoc)).hits++;
      classifiers.local.predictMs += localMs;classifiers.local.predictions += localPredictions;
      if (enabled && local) classifiers.skipped++;
      if (enabled && audited) {classifiers.audits++;if (!reference || reference.stuck === null) classifiers.auditMissing++;else if (reference.stuck !== verdict?.stuck) classifiers.disagreements++;}
      return {status:"terminal",outcome:{status:"completed",result:null}};
    },context);
  }},async abort(task,runtime,context) {
    await runtime.commit(async tx => {const row = (await tx.doc(GuardJobsDoc)).jobs[task.input.id];if (row) {row.status = "complete";row.result = {id:row.effect.id,runId:row.effect.runId,segment:row.effect.segment,verdict:null,writer:null};}return {status:"terminal",outcome:{status:"aborted",result:null,reason:"Guard job cancelled"}};},context);
  }});
  async function schedule(tx:Tx,job:GuardJob,sample:Sample) {
    const jobs = await tx.doc(GuardJobsDoc);if (Object.hasOwn(jobs.jobs,job.effect.id)) return true;
    if (!observing(options.policy(job.sessionKey)) || options.policy(job.sessionKey).loop !== "judge") return false;
    const classifiers = await tx.doc(ClassifiersDoc,scopeKey(job.host.scope),null);classifiers.samples = retainSamples(detach({samples:classifiers.samples}).samples,[sample]);
    jobs.jobs[job.effect.id] = job;
    await tx.createTask(worker,{id:job.effect.id},{ownership:{kind:"conversation"},conversationId:options.backgroundOwner?.() ?? job.host.conversationId,background:true});
    return true;
  }
  return {extension:defineExtension({name:"token-economizer.guard-jobs",tasks:[worker]}),schedule,
    async enqueue(job:GuardJob,sample:Sample) {await options.harness().commit(tx => schedule(tx,job,sample),BACKGROUND_CONTEXT);},
  };
}
