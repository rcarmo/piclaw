// SPDX-License-Identifier: Apache-2.0
import { environmentClaim, type EnvironmentState } from "./microskills/envfacts.ts";
import type { Distiller } from "./microskills/distiller.ts";
import { injectable, driftedConfirms, firingRate, type Lifecycle } from "./microskills/lifecycle.ts";
import { factKey, factPermitted, type FactSource, type FactReview, type FactReviews } from "./microskills/feedback.ts";
import { fingerprint } from "./identity.ts";
import { factTextSafe } from "./microskills/distiller.ts";
export type FactSummary = {id:string;claim:string;source:FactSource;status:"in-use"|"quiet"|"checking"|"needs-review"|"rejected"|"stale"|"retired";confirmations:number;contradictions:number;evidence:string[];review:FactReview|null;claimRevision:string;independentConfirmations?:number;exercises?:number;blockingReasons?:string[]};
export type KnowledgeSummary = {facts:FactSummary[];retired:number};
function status(life:Lifecycle,source:FactSource,id:string,claim:string,reviews:FactReviews):FactSummary["status"] {
  const review = reviews[factKey(source,id)];
  if (review?.decision === "rejected" || review?.decision === "stale") return review.decision;
  if (life.state === "RETIRED") return "retired";
  if (!factTextSafe(claim) || !factPermitted(source,id,claim,reviews)) return "needs-review";
  return injectable(life) ? "in-use" : life.state === "ACTIVE" ? "quiet" : "checking";
}
const order = {"needs-review":0,"in-use":1,checking:2,quiet:3,rejected:4,stale:5,retired:6};
/** Read-only summaries include suppressed facts so feedback can be inspected and corrected. */
export function describeKnowledge(environment:EnvironmentState,distiller:Distiller,reviews:FactReviews = {}):KnowledgeSummary {
  const facts:FactSummary[] = [];
  function add(id:string,claim:string,source:FactSource,life:Lifecycle,evidence:string[]) {
    if (!claim) return;
    const review = reviews[factKey(source,id)] ?? null, independent = driftedConfirms(life), blockingReasons:string[] = [];
    if (!review && !factPermitted(source,id,claim,reviews)) blockingReasons.push("The same claim was rejected or marked stale under another fact ID.");
    if (review?.decision === "rejected") blockingReasons.push("Excluded by your Wrong feedback.");
    if (review?.decision === "stale") blockingReasons.push("Excluded because you marked it stale.");
    if (!factTextSafe(claim)) blockingReasons.push("Unsupported or unsafe fact text; confirmation cannot override this.");
    if (review?.decision === "approved" && !factPermitted(source,id,claim,reviews)) blockingReasons.push("The claim changed after your confirmation.");
    if (life.state === "RETIRED") blockingReasons.push("Retired after contradictory evidence.");
    if (life.state === "CANDIDATE") blockingReasons.push(`${independent} of 3 independent confirmations${life.drift ? " with separate edited-file sets" : ""}.`);
    if (life.fire_den < 4) blockingReasons.push(`${life.fire_den} of 4 completed-work evidence groups.`);
    else if (firingRate(life) < .4) blockingReasons.push(`Relevant in ${Math.round(firingRate(life)*100)}% of evidence groups; at least 40% is required.`);
    facts.push({id,claim,source,status:status(life,source,id,claim,reviews),confirmations:life.confirms.length,contradictions:life.contradicts.length,evidence,review,claimRevision:fingerprint(claim),independentConfirmations:independent,exercises:life.fire_den,blockingReasons});
  }
  for (const fact of environment.facts) add(fact.id,environmentClaim(fact),"environment",fact.life,[`Detector: ${fact.family}`,`Observed parameters: ${JSON.stringify(fact.params).slice(0,2000)}`]);
  for (const fact of distiller.facts) {
    const evidence = (fact.spec.cite ?? []).slice(0,8).map(id => {
      const digest = distiller.window.find(row => row.iid === id);
      return digest ? `Evidence group ${id}: ${digest.check_commands.join("; ") || digest.cmd_templates.join("; ")}` : `Evidence group ${id}: digest no longer in the recent window`;
    });
    add(fact.spec.id,fact.spec.injection ?? fact.spec.claim ?? fact.spec.id,"distilled",fact.life,[...evidence,`Detector: ${JSON.stringify(fact.spec.detector)}`]);
  }
  return {facts:facts.sort((a,b) => order[a.status]-order[b.status] || b.confirmations-a.confirmations),retired:facts.filter(fact => fact.status === "retired").length};
}
