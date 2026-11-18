// SPDX-License-Identifier: Apache-2.0
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Harness } from "@earendil-works/pi-durable";
import { fingerprint } from "../core/identity.ts";
import { inferenceAllowed, modelFor } from "../core/config.ts";
import { buildProposerPrompt, completeProposal, updateDistiller } from "../core/microskills/distiller.ts";
import { detectorVerdict } from "../core/microskills/detectors.ts";
import { creditLearning } from "../core/microskills/lifecycle.ts";
import { genericDigest } from "../core/microskills/digest.ts";
import { renderFacts } from "../core/microskills/render.ts";
import { renderEnvironment, updateEnvironment } from "../core/microskills/envfacts.ts";
import { observeEnvironment } from "../core/microskills/observe.ts";
import { foldEvidence } from "../core/toolprune/evidence.ts";
import { noveltyGate, auditSelected } from "../core/savers.ts";
import { JobsDoc, type Knowledge } from "./documents.ts";
import type { HostDomain } from "./domain.ts";
import type { SessionFolder } from "./lifecycle.ts";
import type { createInferenceQueue } from "./sidecall.ts";
export function createMechanismFolder(options: {harness:() => Harness;domain:HostDomain;queue:ReturnType<typeof createInferenceQueue>;now?:() => number}): SessionFolder {
  return async ({knowledge,policy,session,host,trajectory,signal,incremental}) => {
    const learning = session.learning ? structuredClone(session.learning) : undefined;
    // Partial calls cannot supply facts, but must not veto unrelated complete evidence.
    const relevant = trajectory.observations.filter(call => call.semantic === "shell" || call.semantic === "edit");
    const partial = relevant.filter(call => call.coverage !== "complete");
    const uncertainIntents = new Set(observeEnvironment(partial,host.repositoryRoot).obs.map(call => call.intent));
    const observations = relevant.filter(call => call.coverage === "complete"
      && !partial.some(other => other.command.trim() === call.command.trim() || other.targets.some(path => call.targets.includes(path)))
      && !observeEnvironment([call],host.repositoryRoot).obs.some(observation => uncertainIntents.has(observation.intent)));
    // Partial output may hide a contradiction about the same command/intent.
    // Hold that subject back while still using unrelated complete observations.
    const hasEvidence = observations.length > 0, incomplete = partial.length, held = relevant.length-partial.length-observations.length;
    // One vote per committed user-request run, not per tool call. Same-run tails
    // and retries reuse credits. Carry legacy credits into the first group so
    // upgrading cannot award old observations a second vote.
    const evidenceGroup = learning?.lastRun ? JSON.stringify([session.id,learning.lastRun]) : session.id;
    if (learning && hasEvidence) {
      if (learning.evidenceGroup !== undefined && learning.evidenceGroup !== evidenceGroup) learning.credits = {confirms:[],contradicts:[],exercises:[]};
      learning.evidenceGroup = evidenceGroup;learning.ticks++;
    }
    const now = (options.now ?? Date.now)();
    // Live proposals need three evidence-bearing checkpoints; all attempts share a ten-minute cooldown.
    // Session end retains the original proposer cadence when there has been no live attempt.
    // Existing budget, auth pause and novelty gates still apply. Basic never calls a model.
    const proposalDue = !learning || !incremental && learning.lastProposalAt === null || learning.ticks >= Math.max(3,policy.proposeEvery) && (learning.lastProposalAt === null || now-learning.lastProposalAt >= 600_000);
    let novelty = structuredClone(knowledge.novelty);
    let environment = knowledge.environment, distiller = knowledge.distiller, render = knowledge.render, injectedIds = knowledge.injectedIds;
    const complete = incomplete === 0;
    const diagnostics = {at:now,observations:trajectory.observations.length,factObservations:observations.length,incomplete,proposer:!hasEvidence && incomplete ? "incomplete-evidence" : "not-selected",notes:held ? [`${held} complete results held back because partial results concern the same subject.`] : Array<string>()};
    if (learning) learning.lastCheck = diagnostics;
    const envSelected = policy.microSkills === "envfacts" || policy.microSkills === "both", paidSelected = policy.microSkills === "distiller" || policy.microSkills === "both";
    if (envSelected && (!learning || hasEvidence)) environment = updateEnvironment(environment,hasEvidence || !relevant.length ? observeEnvironment(observations,host.repositoryRoot) : null,session.injectedIds,learning?.credits);
    const renders:NonNullable<Knowledge["renders"]> = knowledge.renders ? structuredClone(knowledge.renders) : {environment:"",distilled:"",ids:[]};
    const free = renderEnvironment(environment,policy.maxFacts,policy.maxFactTokens,knowledge.factReviews);
    const distillObservations = learning ? observations.slice(-64).map(call => ({...call,command:call.command.slice(0,2048),output:call.output.slice(-1024)})) : observations;
    if (paidSelected && (!learning || hasEvidence || !incremental)) {
      const model = modelFor(policy,"proposer"), account = model ? JSON.stringify([host.scope.host,model.provider]) : "";
      const paused = (await options.harness().snapshot(JobsDoc,BACKGROUND_CONTEXT))?.paused.includes(account) ?? false;
      diagnostics.proposer = !hasEvidence && incomplete ? "incomplete-evidence" : !inferenceAllowed(policy) ? "inference-disabled" : !model ? "no-model" : paused ? "auth-paused" : !proposalDue ? learning?.lastProposalAt ? "cooldown-or-cadence" : "waiting-for-checkpoints" : "waiting-for-cadence";
      const tick = learning && !hasEvidence ? {state:distiller,prompt:!incomplete && proposalDue && inferenceAllowed(policy) && model && !paused && distiller.window.length && distiller.now-distiller.last_propose >= policy.proposeEvery ? buildProposerPrompt(host.scope.repository,distiller,[],envSelected ? free.claims : []) : null} : updateDistiller(distiller,hasEvidence || !relevant.length ? genericDigest(distillObservations,evidenceGroup,[host.repositoryRoot],"") : null,distillObservations.filter(call => call.semantic === "shell").map(call => ({command:call.command,output:call.output})),policy.proposeEvery,(hasEvidence || !learning) && inferenceAllowed(policy) && model !== null && !paused && proposalDue,host.scope.repository,envSelected ? free.claims : [],learning?.credits);
      distiller = tick.state;
      if (tick.prompt && model && (!policy.savers.novelty || distiller.now-novelty.lastSkip >= policy.proposeEvery)) {
        const signals = [host.environmentRevision,JSON.stringify(distiller.window.map(({iid:_iid,...digest}) => digest)),JSON.stringify(distiller.facts.map(fact => fact.spec)),JSON.stringify(distiller.extractors),JSON.stringify(distiller.raw_window)];
        const proposalDigest = fingerprint(JSON.stringify([host.environmentRevision,
          distiller.window.map(({iid:_iid,n_cmds:_count,_cmd_blob:_commands,_out_blob:_output,...digest}) => digest),
          distiller.facts.map(fact => fact.spec),distiller.extractors,
          [...new Set(distiller.raw_window.flat().map(call => JSON.stringify(call)))].sort()]));
        const unchanged = learning?.lastProposalDigest === proposalDigest;
        const evaluated = policy.savers.novelty ? noveltyGate(novelty,signals,complete,distiller.now) : null;
        const skip = evaluated?.skip === true, audit = skip && policy.mode === "observe" && auditSelected(host.id,String(distiller.now),policy.savers.auditPercent);
        if (skip) novelty = {...novelty,...evaluated!.state};
        const key = JSON.stringify([host.scope.host,host.scope.repository,host.scope.environment,host.id,"proposer",distiller.now]);
        const admission = !unchanged && (!skip || audit) ? await options.queue.enqueue(host.conversationId,{id:key,purpose:audit ? "audit" : "proposer",auditFor:"proposer",model,prompt:tick.prompt,maxOutputTokens:policy.budget.maxOutputTokens,deadlineMs:policy.budget.deadlineMs},{sessionKey:JSON.stringify([JSON.stringify([host.scope.host,host.scope.repository,host.scope.environment]),host.id]),account,runId:null,revision:String(policy.version),digest:key,estimatedMaximumCost:null}) : {job:null};
        diagnostics.proposer = unchanged ? "unchanged-evidence" : skip && !audit ? "novelty-skip" : admission.job ? "attempted" : "budget-or-policy-blocked";
        // No budget or paused runner makes no attempt and must not consume the cadence.
        if (admission.job?.taskId) {
          if (learning) {learning.lastProposalAt = now;learning.lastProposalDigest = proposalDigest;learning.ticks = 0;}
          await options.harness().waitForTask(admission.job.taskId,BACKGROUND_CONTEXT);signal.throwIfAborted();
          const job = (await options.harness().snapshot(JobsDoc,BACKGROUND_CONTEXT))!.jobs[key];
          if (job.status !== "cancelled") {
            if (audit) {novelty.audits++;const preview = completeProposal(distiller,job.status === "complete" ? job.result!.text : null).state;novelty.missed += preview.facts.filter(fact => !distiller.facts.some(prior => prior.spec.id === fact.spec.id)).length;}
            else {if (evaluated) novelty = {...novelty,...evaluated.state};const completed = completeProposal(distiller,job.status === "complete" ? job.result!.text : null);distiller = completed.state;
              diagnostics.proposer = job.status === "complete" ? "completed" : job.status;
              diagnostics.notes = [...diagnostics.notes,...(job.error ? [job.error] : completed.diagnostics)].slice(0,8).map(note => note.slice(0,160));
              // Grounding may have credited a newly admitted fact using this very session.
              const digest = distiller.window.find(row => row.iid === evidenceGroup);
              if (learning && digest) for (const fact of distiller.facts) {
                const verdict = detectorVerdict(fact.spec.detector,digest);
                creditLearning(learning.credits,`fact:${fact.spec.id}`,verdict.verdict,verdict.fired,verdict.exercised);
              }
            }
          }
        }
      }
    }
    const selected = renderFacts(environment,distiller,host.scope.repository,policy,knowledge.factReviews);
    renders.environment = selected.environment;renders.distilled = selected.distilled;renders.ids = selected.ids;
    render = selected.text;injectedIds = selected.ids;
    let tools = structuredClone(knowledge.tools);
    const catalogue = await options.domain.catalogue(host);
    // Final fold reconciles the complete session; checkpoints contribute only new prompts.
    const source = !incremental && session.learning?.cutoff ? await options.domain.trajectory(host,trajectory.cutoff) : trajectory;
    if (source.kind !== "ready") throw new Error("Complete tool-evidence trajectory is not ready");
    const prompts = learning && !incremental && source.prompts !== null ? Math.max(0,source.prompts-(learning.toolPrompts ?? 0)) : source.prompts;
    const countSession = !learning?.toolCounted;
    if (catalogue.complete) {
      tools = foldEvidence(tools,source.observations.filter(call => call.semantic !== "wrapper").map(call => call.tool),catalogue.tools,prompts,policy,now,session.frozenMask.length === 0,countSession);
      if (learning && policy.pruning !== "off" && policy.enabled && policy.mode !== "off" && (prompts !== 0 || !countSession)) {
        learning.toolCounted = true;learning.toolPrompts = (learning.toolPrompts ?? 0)+(prompts ?? 0);
      }
    }
    if (learning) {learning.cutoff = trajectory.cutoff;learning.processed = learning.requested;}
    return {environment,distiller,render,injectedIds,tools,novelty,renders,learning};
  };
}
