// SPDX-License-Identifier: Apache-2.0
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { defineDoc, defineDocFamily, defineExtension, defineTask, type Harness, type ConversationId, type TaskId, type Tx, type JsonObject } from "@earendil-works/pi-durable";
import { observing, modelFor, type Policy } from "../core/config.ts";
import { scopeKey } from "../core/types.ts";
import { compatible, fitLoopArtifact, fitToolArtifact, textClassifierArtifact, type ToolArtifact } from "../core/classify/artifacts.ts";
import { chronologicalSplit } from "../core/classify/samples.ts";
import { prepareLogistic, initializeOptimizer, advanceOptimizer, type PreparedLogistic, type Optimizer, type LogisticFit } from "../core/classify/logistic.ts";
import { buildBM25, lexicalCorpus, type BM25, type ToolDocument } from "../core/classify/bm25.ts";
import { tokenize, tokeniserVersion } from "../core/classify/text.ts";
import { loopFeatureVersion } from "../core/classify/loop-features.ts";
import type { ArtifactIdentity, Provenance, Sample } from "../core/classify/contracts.ts";
import { sessionKey } from "../core/sessions.ts";
import { ClassifiersDoc } from "./documents.ts";
import { detach } from "./detach.ts";
import type { HostDomain, HostSession } from "./domain.ts";
import type { OperationSink, OptimizerOperation } from "./operations.ts";
const FitQueue = defineDoc<{active:TaskId|null;waiting:TaskId[]}>({kind:"token-economizer.fit-queue",version:1,scope:"session",initial:() => ({active:null,waiting:[]}),checkpointWhen:() => false});
async function release(tx:Tx,id:TaskId) {const queue = await tx.doc(FitQueue);if (queue.active === id) queue.active = null;queue.waiting = queue.waiting.filter(item => item !== id);}
const FitsDoc = defineDocFamily<{startedAt?:number;samples:Sample[];used:string[];prepared:PreparedLogistic|null;optimizer:Optimizer|null;provenance:Provenance|null;generation:number;groups:number;tools:ToolArtifact[];text:ArtifactIdentity[];toolNames:string[];toolIndex:number;toolProvenance:Provenance|null;lexicalDocuments:ToolDocument[];lexical:BM25;lexicalIndex:number;lexicalLength:number},null>({kind:"token-economizer.fit",version:1,scope:"session",family:true,initial:() => ({samples:[],used:[],prepared:null,optimizer:null,provenance:null,generation:0,groups:0,tools:[],text:[],toolNames:[],toolIndex:0,toolProvenance:null,lexicalDocuments:[],lexical:buildBM25([]),lexicalIndex:0,lexicalLength:0}),checkpointWhen:() => false});
function enabled(policy:Policy) {return observing(policy) && (policy.loop === "judge" && (policy.savers.localLoop || policy.judge !== "generative") || policy.pruning !== "off" && (policy.savers.toolPrefilter || policy.savers.localToolDrops || ["classifier","cascade"].includes(policy.toolJudge)));}
function consumed(identity:ArtifactIdentity):string[] {return Object.values(identity.bands).some(band => band !== null) ? identity.acceptanceGroups : [];}
export function createClassifierTraining(options:{harness:() => Harness;backgroundOwner?:() => ConversationId;domain:HostDomain;policy:(key:string) => Policy;onOperation?:OperationSink}) {
  async function report(tx:Tx,host:HostSession,id:TaskId,status:OptimizerOperation["status"],at:number,output:JsonObject|null) {
    if (!options.onOperation) return;
    const fit = await tx.doc(FitsDoc,String(id),null);if (fit.startedAt === undefined) return;
    await options.onOperation(tx,host.conversationId,{id:`fit:${id}`,name:"optimizer.fit",status,startedAt:fit.startedAt,at,input:{samples:fit.samples.length,groups:fit.groups,tools:fit.toolNames.length},output});
  }
  const worker = defineTask<{host:HostSession;key:string;scope:string;generation:number},{phase:"prepare"|"optimize"|"tools"|"lexical"|"publish"},null>({name:"token-economizer.fit",version:1,initial:() => ({phase:"prepare"}),phases:{
    async prepare(task,runtime,context) {
      const {scope,key,host} = task.input, policy = options.policy(key), catalogue = await options.domain.catalogue(host);
      await runtime.commit(async tx => {
        const state = await tx.doc(ClassifiersDoc,scope,null), fit = await tx.doc(FitsDoc,String(task.id),null);
        if (!enabled(options.policy(key)) || state.generation !== task.input.generation) {state.fitTask = null;await release(tx,task.id);await report(tx,task.input.host,task.id,"cancelled",runtime.now(),{reason:"Settings or evidence changed"});return {status:"terminal",outcome:{status:"completed",result:null}};}
        const queue = await tx.doc(FitQueue);
        while (queue.waiting.length) {const first = await tx.task(queue.waiting[0]);if (!first) throw new Error("Missing pure fitting queue owner");if (first.state.status !== "terminal") break;if (queue.active === queue.waiting[0]) queue.active = null;queue.waiting.shift();}
        if (queue.waiting[0] !== task.id || queue.active !== null && queue.active !== task.id) return {status:"sleeping",until:runtime.now()+20,checkpoint:{phase:"prepare"}};queue.active = task.id;
        const began = performance.now();
        fit.samples = detach({rows:state.samples}).rows;fit.used = [...state.usedAcceptanceGroups];fit.generation = state.generation;fit.groups = new Set(fit.samples.map(row => row.group)).size;
        const latest = fit.samples.filter(row => row.kind === "loop" && row.featureVersion === loopFeatureVersion).at(-1);
        fit.provenance = {scope,featureVersion:loopFeatureVersion,labelPolicy:latest?.labelPolicy ?? "reference-loop-v1",catalogueRevision:catalogue.revision,environmentRevision:host.environmentRevision,teacher:modelFor(policy,"loopJudge"),backend:null};
        fit.prepared = policy.loop === "judge" && policy.savers.localLoop ? prepareLogistic(chronologicalSplit(compatible(fit.samples,fit.provenance).filter(row => row.kind === "loop")).fit) : {kind:"unready",reason:"local-loop-disabled"};
        fit.toolNames = policy.pruning !== "off" ? catalogue.tools.map(tool => tool.name) : [];fit.toolProvenance = {...detach(fit.provenance!),featureVersion:tokeniserVersion,labelPolicy:"reference-tool-v1",teacher:modelFor(policy,"toolJudge")};
        const lexicalFit = chronologicalSplit(compatible(fit.samples,fit.toolProvenance!).filter(row => row.kind === "tool")).fit;
        fit.lexicalDocuments = lexicalCorpus(catalogue.tools.map(tool => ({tool:tool.name,tokens:tokenize(tool.name+" "+tool.description).tokens})),lexicalFit.filter(row => row.label === 1 && row.complete && row.eligible).map(row => ({tool:row.tool!,tokens:row.tokens})));
        fit.optimizer = fit.prepared.kind === "prepared" ? initializeOptimizer(fit.prepared.data) : null;
        state.local.fitMs += performance.now()-began;
        fit.startedAt ??= runtime.now();await report(tx,host,task.id,"running",runtime.now(),null);
        return {status:"running",checkpoint:{phase:fit.optimizer && policy.savers.localLoop ? "optimize" : "tools"}};
      },context);
    },
    async optimize(task,runtime,context) {
      await runtime.commit(async tx => {
        const fit = await tx.doc(FitsDoc,String(task.id),null), state = await tx.doc(ClassifiersDoc,task.input.scope,null);
        if (!enabled(options.policy(task.input.key)) || state.generation !== fit.generation) {state.fitTask = null;await release(tx,task.id);await report(tx,task.input.host,task.id,"cancelled",runtime.now(),{reason:"Settings or evidence changed"});return {status:"terminal",outcome:{status:"completed",result:null}};}
        const policy = options.policy(task.input.key);if (policy.loop !== "judge" || !policy.savers.localLoop) return {status:"running",checkpoint:{phase:"tools"}};
        if (fit.prepared?.kind !== "prepared" || !fit.optimizer) throw new Error("Missing frozen logistic fit");
        const began = performance.now();fit.optimizer = advanceOptimizer(detach(fit.optimizer),detach(fit.prepared.data),8);
        state.local.fitMs += performance.now()-began;
        return fit.optimizer.status === "running" ? {status:"sleeping",until:runtime.now()+1,checkpoint:{phase:"optimize"}} : {status:"running",checkpoint:{phase:"tools"}};
      },context);
    },
    async tools(task,runtime,context) {
      const fit = await runtime.snapshot(FitsDoc,String(task.id),context);if (!fit?.toolProvenance) throw new Error("Missing tool fit provenance");
      const policy = options.policy(task.input.key), name = fit.toolNames[fit.toolIndex], frozen = fit;
      const began = performance.now(), eligible = policy.pruning !== "off" && name !== undefined;
      const model = eligible && (policy.savers.localToolDrops || policy.savers.toolPrefilter) ? fitToolArtifact(frozen.samples,frozen.toolProvenance!,name,frozen.used) : null;
      const backend = modelFor(policy,"toolClassifier"), scores = Object.fromEntries(frozen.samples.filter(row => row.textScore !== null).map(row => [row.id,row.textScore!]));
      const text = eligible && backend && ["classifier","cascade"].includes(policy.toolJudge) ? textClassifierArtifact(frozen.samples,{...frozen.toolProvenance!,backend},scores,name,frozen.used) : null;
      const elapsed = performance.now()-began;
      await runtime.commit(async tx => {const row = await tx.doc(FitsDoc,String(task.id),null), state = await tx.doc(ClassifiersDoc,task.input.scope,null);if (!enabled(options.policy(task.input.key)) || row.generation !== state.generation) {state.fitTask = null;await release(tx,task.id);await report(tx,task.input.host,task.id,"cancelled",runtime.now(),{reason:"Settings or evidence changed"});return {status:"terminal",outcome:{status:"completed",result:null}};}
        state.local.fitMs += elapsed;if (model) row.tools.push(model);if (text) row.text.push(text);row.toolIndex++;
        return row.toolIndex < row.toolNames.length ? {status:"sleeping",until:runtime.now()+1,checkpoint:{phase:"tools"}} : {status:"running",checkpoint:{phase:"lexical"}};
      },context);
    },
    async lexical(task,runtime,context) {
      await runtime.commit(async tx => {
        const fit = await tx.doc(FitsDoc,String(task.id),null), state = await tx.doc(ClassifiersDoc,task.input.scope,null), policy = options.policy(task.input.key);
        if (!enabled(policy) || fit.generation !== state.generation) {state.fitTask = null;await release(tx,task.id);await report(tx,task.input.host,task.id,"cancelled",runtime.now(),{reason:"Settings or evidence changed"});return {status:"terminal",outcome:{status:"completed",result:null}};}
        if (policy.pruning === "off" || !policy.savers.toolPrefilter) return {status:"running",checkpoint:{phase:"publish"}};
        const began = performance.now(), limit = Math.min(fit.lexicalDocuments.length,fit.lexicalIndex+16);
        for (;fit.lexicalIndex < limit;fit.lexicalIndex++) {
          const document = fit.lexicalDocuments[fit.lexicalIndex];fit.lexical.documents.push(document);fit.lexicalLength += document.tokens.length;
          for (const token of new Set(document.tokens)) fit.lexical.frequency[token] = (Object.hasOwn(fit.lexical.frequency,token) ? fit.lexical.frequency[token] : 0)+1;
        }
        fit.lexical.averageLength = fit.lexical.documents.length ? fit.lexicalLength/fit.lexical.documents.length : 0;
        state.local.fitMs += performance.now()-began;
        return fit.lexicalIndex < fit.lexicalDocuments.length ? {status:"sleeping",until:runtime.now()+1,checkpoint:{phase:"lexical"}} : {status:"running",checkpoint:{phase:"publish"}};
      },context);
    },
    async publish(task,runtime,context) {
      const frozen = await runtime.snapshot(FitsDoc,String(task.id),context);if (!frozen?.provenance) throw new Error("Missing fit provenance");
      const fit = structuredClone(frozen), {host,key,scope} = task.input, policy = options.policy(key), catalogue = await options.domain.catalogue(host);
      const began = performance.now(), provenance = fit.provenance!;
      let pretrained:LogisticFit = {kind:"unready",reason:"insufficient-fit-evidence"};
      if (fit.prepared?.kind === "prepared" && fit.optimizer) pretrained = fit.optimizer.status === "converged" ? {kind:"ready",model:{scaler:fit.prepared.scaler,parameters:fit.optimizer.parameters,iterations:fit.optimizer.iteration,loss:fit.optimizer.loss}} : {kind:"unready",reason:fit.optimizer.reason ?? "incomplete-fit"};
      const loop = policy.loop === "judge" && policy.savers.localLoop ? fitLoopArtifact(fit.samples,provenance,fit.used,pretrained) : null;
      const tools = fit.tools, text = fit.text, scores = Object.fromEntries(fit.samples.filter(row => row.textScore !== null).map(row => [row.id,row.textScore!]));
      const loopBackend = modelFor(policy,"loopClassifier");
      if (policy.loop === "judge" && policy.judge !== "generative" && loopBackend) text.push(textClassifierArtifact(fit.samples,{...provenance,backend:loopBackend},scores,null,fit.used));
      const lexical = fit.lexical, elapsed = performance.now()-began;
      await runtime.commit(async tx => {
        const state = await tx.doc(ClassifiersDoc,scope,null), currentPolicy = options.policy(key);state.local.fitMs += elapsed;
        const published = enabled(currentPolicy) && state.generation === fit.generation && catalogue.revision === provenance.catalogueRevision && host.environmentRevision === provenance.environmentRevision && JSON.stringify(modelFor(options.policy(key),"loopJudge")) === JSON.stringify(provenance.teacher);
        if (published) {
          if (currentPolicy.loop === "judge" && currentPolicy.savers.localLoop && loop?.model) state.loop = loop;
          if (currentPolicy.pruning !== "off" && (currentPolicy.savers.localToolDrops || currentPolicy.savers.toolPrefilter) && JSON.stringify(modelFor(currentPolicy,"toolJudge")) === JSON.stringify(fit.toolProvenance?.teacher)) state.tools = tools;
          if (currentPolicy.pruning !== "off" && currentPolicy.savers.toolPrefilter) state.lexical = lexical;
          const eligibleText = text.filter(artifact => artifact.tool === null ? currentPolicy.loop === "judge" && currentPolicy.judge !== "generative" && JSON.stringify(artifact.provenance.backend) === JSON.stringify(modelFor(currentPolicy,"loopClassifier")) : currentPolicy.pruning !== "off" && ["classifier","cascade"].includes(currentPolicy.toolJudge) && JSON.stringify(artifact.provenance.backend) === JSON.stringify(modelFor(currentPolicy,"toolClassifier")));
          state.text = [...state.text.filter(artifact => !eligibleText.some(next => next.tool === artifact.tool && next.provenance.featureVersion === artifact.provenance.featureVersion)),...eligibleText];state.lastFitGroups = fit.groups;state.local.lastFitAt = runtime.now();state.lastError = loop?.identity.invalidReason ?? null;
          state.usedAcceptanceGroups = [...new Set([...state.usedAcceptanceGroups,...[...(loop ? [loop.identity] : []),...tools.map(tool => tool.identity),...text].flatMap(consumed)])];
        }
        state.fitTask = null;await release(tx,task.id);
        await report(tx,host,task.id,"complete",runtime.now(),{published,loop:state.loop?.identity.state ?? null,toolModels:state.tools.map(tool => ({tool:tool.tool,state:tool.identity.state})),textModels:state.text.length,lexicalDocuments:state.lexical?.documents.length ?? 0,lastError:state.lastError});
        return {status:"terminal",outcome:{status:"completed",result:null}};
      },context);
    },
  },async abort(task,runtime,context) {await runtime.commit(async tx => {(await tx.doc(ClassifiersDoc,task.input.scope,null)).fitTask = null;await release(tx,task.id);await report(tx,task.input.host,task.id,"cancelled",runtime.now(),{reason:"Classifier fit cancelled"});return {status:"terminal",outcome:{status:"aborted",result:null,reason:"Classifier fit cancelled"}};},context);}});
  return {extension:defineExtension({name:"token-economizer.training",tasks:[worker]}),
    async rebuild(host:HostSession,force = false) {
      const key = sessionKey(host.scope,host.id);if (!enabled(options.policy(key))) return false;
      return options.harness().commit(async tx => {
        const state = await tx.doc(ClassifiersDoc,scopeKey(host.scope),null), groups = new Set(state.samples.map(row => row.group)).size;
        if (state.fitTask !== null) {const prior = await tx.task(state.fitTask);if (!prior || prior.state.status !== "terminal") return false;state.fitTask = null;state.lastError = "Previous fit did not publish; retrying with current evidence";}
        if (!force && (groups === 0 || groups < Math.max(1,Math.ceil(state.lastFitGroups*1.2)))) return false;
        const queue = await tx.doc(FitQueue);if (queue.waiting.length >= 32) return false;
        state.fitTask = await tx.createTask(worker,{host,key,scope:scopeKey(host.scope),generation:state.generation},{ownership:{kind:"conversation"},conversationId:options.backgroundOwner?.() ?? host.conversationId,background:true});queue.waiting.push(state.fitTask);return true;
      },BACKGROUND_CONTEXT);
    },
    async clear(host:HostSession) {await options.harness().commit(async tx => {const state = await tx.doc(ClassifiersDoc,scopeKey(host.scope),null);state.generation++;state.loop = null;state.tools = [];state.lexical = null;state.text = [];state.lastError = null;state.lastFitGroups = new Set(state.samples.map(row => row.group)).size;},BACKGROUND_CONTEXT);},
    async review(host:HostSession,id:string,label:0|1,unsafeArtifactId:string|null) {
      await options.harness().commit(async tx => {
        const state = await tx.doc(ClassifiersDoc,scopeKey(host.scope),null), sample = state.samples.find(row => row.id === id);if (!sample) throw new Error("Unknown retained classifier sample");
        sample.label = label;sample.reviewed = true;sample.source = "review";
        if (unsafeArtifactId) {
          const artifact = [state.loop?.identity,...state.tools.map(tool => tool.identity),...state.text].find(row => row?.id === unsafeArtifactId);if (!artifact) throw new Error("Unknown classifier artifact");
          artifact.state = "invalidated";artifact.invalidReason = "reviewed-unsafe-action";artifact.bands = {spare:null,stuck:null,drop:null};state.generation++;
        }
      },BACKGROUND_CONTEXT);
    },
  };
}
