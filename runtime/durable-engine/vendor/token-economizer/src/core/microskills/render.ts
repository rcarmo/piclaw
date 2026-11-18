// SPDX-License-Identifier: Apache-2.0
// Kintsugi safety controls for the Modified TypeScript port of Microsoft TokenEconomizer.
// Upstream baseline: 81e32e56bb3c4c1b4c9756b429be91e3960116ca; see ../../../LICENSE.
import type { Policy } from "../config.ts";
import { renderEnvironment, type EnvironmentState } from "./envfacts.ts";
import { renderDistiller, type Distiller } from "./distiller.ts";
import type { FactReviews } from "./feedback.ts";
export function renderFacts(environment:EnvironmentState,distiller:Distiller,repository:string,policy:Policy,reviews:FactReviews = {}) {
  const envSelected = policy.microSkills === "envfacts" || policy.microSkills === "both";
  const paidSelected = policy.microSkills === "distiller" || policy.microSkills === "both";
  const free = envSelected ? renderEnvironment(environment,policy.maxFacts,policy.maxFactTokens,reviews) : {text:"",ids:[],claims:[]};
  // Both mechanisms share one budget. Count the separator as well as both headings.
  const remaining = Math.max(0,policy.maxFactTokens-(Array.from(free.text).length+(free.text ? 1 : 0))/4);
  const distilled = paidSelected ? renderDistiller(distiller,repository,Math.max(0,policy.maxFacts-free.ids.length),remaining,reviews) : "";
  const ids = distiller.facts.filter(fact => distilled.split("\n").includes(`- ${fact.spec.injection ?? fact.spec.claim ?? fact.spec.id}`)).map(fact => `distilled:${fact.spec.id}`);
  return {text:[free.text,distilled].filter(Boolean).join("\n"),environment:free.text,distilled,ids:[...free.ids,...ids]};
}
/** Keep a frozen snapshot, but never carry unreviewed, rejected or over-budget facts into another request. */
export function permittedFactSection(section:string,environment:EnvironmentState,distiller:Distiller,repository:string,policy:Policy,reviews:FactReviews = {}):string {
  const allowed = renderFacts(environment,distiller,repository,{...policy,maxFacts:Number.MAX_SAFE_INTEGER,maxFactTokens:Number.MAX_SAFE_INTEGER},reviews).text.split("\n").filter(line => line.startsWith("- "));
  let count = 0, size = 0;
  const lines = section.split("\n").filter(line => {
    if (!line.startsWith("- ")) return true;
    if (!allowed.includes(line) || count >= policy.maxFacts || size+Array.from(line).length+1 > policy.maxFactTokens*4) return false;
    count++;size+=Array.from(line).length+1;return true;
  });
  if (!count) return "";
  // Rendering headers are part of the same budget; wrappers/instructions are host-owned.
  while (Array.from(lines.filter(line => !line.startsWith("<") && !line.startsWith("Learned repository facts")).join("\n")).length > policy.maxFactTokens*4) {
    const index = lines.findLastIndex(line => line.startsWith("- "));if (index < 0) return "";
    lines.splice(index,1);if (!--count) return "";
  }
  return lines.join("\n");
}
