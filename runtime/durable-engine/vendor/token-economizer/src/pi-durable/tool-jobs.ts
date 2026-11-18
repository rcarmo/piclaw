// SPDX-License-Identifier: Apache-2.0
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Harness } from "@earendil-works/pi-durable";
import { inferenceAllowed, modelFor, observing, type Policy } from "../core/config.ts";
import { fingerprint } from "../core/identity.ts";
import { sessionKey } from "../core/sessions.ts";
import { scopeKey, type ToolInfo, type InferenceRequest } from "../core/types.ts";
import { taskCandidates, toolJudgePrompt, parseToolJudge } from "../core/toolprune/judge.ts";
import { tokenize, textInDomain, tokeniserVersion, type AttachmentType } from "../core/classify/text.ts";
import { lexicalKeeps } from "../core/classify/bm25.ts";
import { bernoulliScore } from "../core/classify/bernoulli.ts";
import { classificationScore, toolDecision } from "../core/classify/routing.ts";
import { provenanceMatches } from "../core/classify/artifacts.ts";
import { retainSamples } from "../core/classify/samples.ts";
import { auditSelected } from "../core/savers.ts";
import type { Sample } from "../core/classify/contracts.ts";
import { ClassifiersDoc, JobsDoc } from "./documents.ts";
import type { HostSession, CatalogueSnapshot } from "./domain.ts";
import { detach } from "./detach.ts";
import type { createInferenceQueue } from "./sidecall.ts";
const classifierOutput = Type.Object({label:Type.Union([Type.String(),Type.Null()]),probabilities:Type.Record(Type.String(),Type.Number())});
export function createTaskToolJudge(options:{harness:() => Harness;policy:(key:string) => Policy;queue:ReturnType<typeof createInferenceQueue>}) {
  return async (host:HostSession,task:string,catalogue:CatalogueSnapshot,evidence:string[],used:string[],kept:string[],attachments:AttachmentType[] = [],requestId = "",isCurrent:() => Promise<boolean> = async () => true,expiresAt?:number) => {
    const key = sessionKey(host.scope,host.id), scope = scopeKey(host.scope), policy = options.policy(key), decisions:Record<string,boolean> = {};
    if (!observing(policy) || policy.pruning === "off" || policy.toolJudge === "none" && !policy.savers.toolPrefilter && !policy.savers.localToolDrops || !catalogue.complete || !task.trim()) return decisions;
    const candidates = taskCandidates(catalogue.tools,used,kept,evidence), tokenized = tokenize(task,attachments), teacher = modelFor(policy,"toolJudge"), classifier = modelFor(policy,"toolClassifier");
    const recordId = fingerprint(JSON.stringify([key,requestId,task,catalogue.revision,evidence,policy]));
    const data = await options.harness().snapshot(ClassifiersDoc,scope,BACKGROUND_CONTEXT), beganLexical = performance.now();
    const lexical = policy.savers.toolPrefilter && data?.lexical ? lexicalKeeps(data.lexical,tokenized.tokens) : [];
    const lexicalMs = performance.now()-beganLexical;
    const samples:Sample[] = candidates.map(tool => ({id:fingerprint(JSON.stringify([recordId,tool.name])),recordId,scope,group:host.classificationGroup,sessionId:host.id,at:Date.now(),kind:"tool",tool:tool.name,features:[],tokens:tokenized.tokens,label:null,reviewed:false,source:"reference",complete:!tokenized.omitted,eligible:true,dropEligible:!lexical.includes(tool.name),uniform:true,featureVersion:tokeniserVersion,labelPolicy:"reference-tool-v1",catalogueRevision:catalogue.revision,environmentRevision:host.environmentRevision,teacher,classifier:null,textScore:null}));
    await options.harness().commit(async tx => {if (!observing(options.policy(key)) || options.policy(key).pruning === "off") return;const data = await tx.doc(ClassifiersDoc,scope,null);data.samples = retainSamples(detach({rows:data.samples}).rows,samples);},BACKGROUND_CONTEXT);
    const local = new Set<string>(), scores = new Map<string,number>(), audits = new Set<string>();
    let localMs = lexicalMs, localPredictions = policy.savers.toolPrefilter && data?.lexical ? 1 : 0;
    async function call(request:InferenceRequest) {
      if (!await isCurrent()) return null;
      const remaining = expiresAt === undefined ? request.deadlineMs : Math.min(request.deadlineMs,Math.floor(expiresAt-Date.now()));
      if (remaining <= 0) return null;
      const admission = await options.queue.enqueue(host.conversationId,{...request,deadlineMs:remaining},{sessionKey:key,account:JSON.stringify([host.scope.host,request.model.provider]),runId:null,revision:fingerprint(JSON.stringify(policy)),digest:fingerprint(request.prompt),estimatedMaximumCost:null,expiresAt});
      if (!admission.job?.taskId) return null;
      await options.harness().waitForTask(admission.job.taskId,BACKGROUND_CONTEXT);
      const row = (await options.harness().snapshot(JobsDoc,BACKGROUND_CONTEXT))!.jobs[request.id];return row.status === "complete" ? row.result : null;
    }
    for (const sample of samples) {
      const tool = sample.tool!, artifact = data?.tools.find(row => row.tool === tool && provenanceMatches(row.identity.provenance,sample,null));
      let verdict:{kind:"label";label:"keep"|"drop_candidate"}|null = lexical.includes(tool) ? {kind:"label",label:"keep"} : null;
      if (!verdict && (policy.savers.toolPrefilter || policy.savers.localToolDrops) && artifact?.model) {
        const began = performance.now(), decision = toolDecision(bernoulliScore(artifact.model,tokenized.tokens),artifact.identity,policy.savers.localToolDrops,textInDomain(tokenized,artifact.model.vocabulary));
        localMs += performance.now()-began;localPredictions++;
        if (decision.kind === "label") verdict = decision;
      }
      if (!verdict && ["classifier","cascade"].includes(policy.toolJudge) && classifier && inferenceAllowed(options.policy(key))) {
        const id = sample.id+"/classifier", result = await call({id,purpose:"classifier",model:classifier,prompt:toolJudgePrompt(task,candidates.filter(row => row.name === tool)),maxOutputTokens:policy.budget.maxOutputTokens,deadlineMs:policy.budget.deadlineMs,classification:{id,model:classifier,purpose:"tools",state:toolJudgePrompt(task,candidates.filter(row => row.name === tool)),labels:{keep:"Plausibly useful for this task",drop:"Confidently irrelevant to this task",uncertain:"Insufficient evidence"},deadlineMs:policy.budget.deadlineMs}});
        let score:number|null = null;
        if (result) {try {const raw:unknown = JSON.parse(result.text);Value.Assert(classifierOutput,raw);score = classificationScore({...raw,model:result.model,usage:result.usage,cost:result.cost,error:result.error,authUnavailable:result.authUnavailable,durationMs:result.durationMs},["keep","drop","uncertain"],"keep");} catch {score = null;}}
        if (score !== null) {
          scores.set(sample.id,score);
          const identity = data?.text.find(row => row.tool === tool && provenanceMatches(row.provenance,sample,classifier)), vocabulary = identity?.vocabulary ?? [];
          const decision = toolDecision(score,identity ?? null,true,textInDomain(tokenized,vocabulary));if (decision.kind === "label") verdict = decision;
        }
      }
      if (verdict) {decisions[tool] = verdict.label === "keep";local.add(tool);if (auditSelected(scope,sample.id,policy.savers.auditPercent)) audits.add(tool);}
    }
    const unresolved = candidates.filter(tool => !Object.hasOwn(decisions,tool.name)), toAudit = candidates.filter(tool => audits.has(tool.name));
    const infer = async (tools:ToolInfo[],audit:boolean) => {
      if (!tools.length || !teacher || !inferenceAllowed(options.policy(key))) return {};
      const request:InferenceRequest = {id:recordId+(audit ? "/audit" : "/teacher"),purpose:audit ? "audit" : "tool-judge",model:teacher,prompt:toolJudgePrompt(task,tools),maxOutputTokens:policy.budget.maxOutputTokens,deadlineMs:policy.budget.deadlineMs};
      if (audit) request.auditFor = "tools";
      const result = await call(request);
      return result ? parseToolJudge(result.text,tools) : {};
    };
    const reference = ["generative","cascade"].includes(policy.toolJudge) ? await infer(unresolved,false) : {};
    Object.assign(reference,await infer(toAudit,true));
    for (const [tool,keep] of Object.entries(reference)) if (!Object.hasOwn(decisions,tool)) decisions[tool] = keep;
    const fresh = await isCurrent();
    await options.harness().commit(async tx => {
      if (!fresh || !observing(options.policy(key)) || options.policy(key).pruning === "off") return;
      const state = await tx.doc(ClassifiersDoc,scope,null);state.local.predictMs += localMs;state.local.predictions += localPredictions;
      for (const frozen of samples) {
        const sample = state.samples.find(row => row.id === frozen.id), tool = frozen.tool!;if (!sample) continue;
        if (Object.hasOwn(reference,tool)) {sample.label = reference[tool] ? 1 : 0;sample.source = audits.has(tool) ? "audit" : "reference";sample.uniform = audits.has(tool) || local.size === 0;sample.classifier = classifier;sample.textScore = scores.get(sample.id) ?? null;}
        if (local.has(tool)) state.skipped++;
        if (audits.has(tool)) {state.audits++;if (!Object.hasOwn(reference,tool)) state.auditMissing++;else if (reference[tool] !== decisions[tool]) state.disagreements++;}
      }
    },BACKGROUND_CONTEXT);
    return decisions;
  };
}
