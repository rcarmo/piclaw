// SPDX-License-Identifier: Apache-2.0
// Modified TypeScript port of Microsoft TokenEconomizer, revision 81e32e56bb3c4c1b4c9756b429be91e3960116ca; see ../../../LICENSE.
// Ported from TokenEconomizer microskills/envfacts.py. Native privacy allowlisting is applied by the observer.
import { createLifecycle, firingRate, injectable, updateEnvironmentLifecycle, creditLearning, type LearningCredits, type Lifecycle, type Verdict } from "./lifecycle.ts";
import { compareCodePoints } from "../ordering.ts";
import { factTextSafe } from "./distiller.ts";
import { safeEnvironmentName, safeEnvironmentValue } from "../privacy.ts";
import { factPermitted, type FactReviews } from "./feedback.ts";
export type EnvironmentObservation = {call:number;intent:string;form:string;head:string;prefix:string;segment:string;hosts:string[];probe:string|null;outcome:string|null;labels:string[];label_err:boolean;loaded:boolean;tests_ran:boolean;env:boolean;not_found:boolean};
export type EnvironmentDigest = {obs:EnvironmentObservation[];edited:string[];n_calls:number;env:{need:string[];sets:Record<string,string>;ok:boolean;call:number}[]};
type Fact<F extends string,P> = {id:string;family:F;params:P;life:Lifecycle};
export type EnvironmentFact =
  | Fact<"form_repair",{intent:string;a:string;b_counts:Record<string,number>;error_counts:Record<string,number>;b_fails:Record<string,number>;contra_streak:number}>
  | Fact<"arg_repair",{form:string;kind:string;param:string;examples:Record<string,number>}>
  | Fact<"env_value",{var:string;good:Record<string,number>;bad:Record<string,number>}>
  | Fact<"boundary",{hosts:Record<string,number>}>
  | Fact<"absent_tool",{tool:string;intent:string}>
  | Fact<"empty_probe",{kinds:Record<string,number>}>;
export type EnvironmentState = {now:number;facts:EnvironmentFact[];lastInjected:string[]};
export function emptyEnvironment(): EnvironmentState {return {now:0,facts:[],lastInjected:[]};}
const formErrors = new Set(["module_missing","command_missing","script_missing","usage_error","permission_denied"]);
const networkErrors = new Set(["connection_refused","name_resolution","unreachable"]);
export function formFailed(o: EnvironmentObservation): boolean {return o.outcome !== null && formErrors.has(o.outcome) && !o.label_err && !(o.intent === "run_tests" && o.outcome === "usage_error");}
export function formWorked(o: EnvironmentObservation): boolean {return o.outcome === "ran" && (o.intent !== "run_tests" || o.tests_ran);}
export function isBare(form: string): boolean {return !form.split(/\s+/)[0].includes("/") && !form.includes(" activate ") && !form.includes(" run ") && !/^(?:conda run|poetry run|pipenv run|uv run|npx |uvx )/.test(form);}
const runWords = new Set(["run","npx","uv","uvx","pipx","poetry","pipenv","conda","-m","python","python3"]);
function repairs(form: string, failing: string, intent: string): boolean {
  if (form === failing) return false;
  if (intent === "run_build") return form.split(/\s+/).some(word => failing.split(/\s+/).includes(word) && !runWords.has(word));
  return intent === "run_tests" || !isBare(form);
}
function toolOf(form: string): string {return form.split(/\s+/).at(-1)?.split("/").at(-1) ?? "";}
function movesShell(form: string): boolean {return form.startsWith("cd ") && form.includes(" && ");}
function usage(form: string,args = " …"): string {return movesShell(form) ? `\`(${form}${args})\`` : `\`${form}${args}\``;}
function root(form: string): string {
  if (form.includes(" && ")) return form.split(" && ")[0];
  if (/^(?:conda run|poetry run|pipenv run|uv run|npx)/.test(form)) return form.split(/\s+/).slice(0,3).join(" ");
  const head = form.split(/\s+/)[0];return head.includes("/") ? head.slice(0,head.lastIndexOf("/")) : head;
}
function join(items: string[]): string {return items.length === 0 ? "the hosts it tried" : items.length === 1 ? items[0] : items.slice(0,-1).join(", ")+" and "+items.at(-1);}
function best(counts: Record<string,number>): string | null {return Object.keys(counts).sort((a,b) => counts[b]-counts[a])[0] ?? null;}
function increment(counts: Record<string,number>,key: string,amount = 1) {Object.defineProperty(counts,key,{value:(Object.hasOwn(counts,key) ? counts[key] : 0)+amount,enumerable:true,writable:true,configurable:true});}
export function workingForm(fact: Extract<EnvironmentFact,{family:"form_repair"}>): string | null {
  const p = fact.params, net = Object.fromEntries(Object.entries(p.b_counts).filter(([key,value]) => value > (p.b_fails[key] ?? 0)).map(([key,value]) => [key,value-(p.b_fails[key] ?? 0)]));
  const stationary = Object.keys(net).filter(form => !movesShell(form)), pool = stationary.length ? stationary : Object.keys(net);
  return pool.sort((a,b) => net[b]-net[a] || p.b_counts[b]-p.b_counts[a])[0] ?? null;
}
const errorPhrases = new Map([["module_missing","ModuleNotFoundError"],["command_missing","command not found"],["script_missing","a file-not-found error"],["usage_error","a usage error"],["permission_denied","permission denied"]]);
export function environmentClaim(fact: EnvironmentFact): string {
  switch (fact.family) {
    case "form_repair": {const form = workingForm(fact);const error = best(fact.params.error_counts) ?? "module_missing";return form ? `${usage(fact.params.a)} fails here with ${errorPhrases.get(error) ?? error}; ${usage(form)} works.` : "";}
    case "boundary": return `Outbound connections to ${join(Object.keys(fact.params.hosts).sort((a,b) => fact.params.hosts[b]-fact.params.hosts[a]).slice(0,3))} failed in earlier observed requests. This does not establish a permanent network restriction.`;
    case "arg_repair": {
      if (fact.params.kind === "sep") return `${usage(fact.params.form,"")} takes dotted test labels (\`module.Class.test\`, not \`module::Class::test\`).`;
      const example = Object.keys(fact.params.examples).sort((a,b) => a.split(" ")[0].length-b.split(" ")[0].length)[0] ?? "x x", space = example.indexOf(" ");
      return `${usage(fact.params.form,"")} takes test labels without the \`${fact.params.param}\` prefix (\`${example.slice(space+1)}\`, not \`${example.slice(0,space)}\`).`;
    }
    case "env_value": {const good = best(fact.params.good) ?? "", bad = Object.keys(fact.params.bad).sort(compareCodePoints).filter(value => value !== good)[0];return `Earlier project commands requested \`${fact.params.var}\` set here: \`${fact.params.var}=${good}\` works`+(bad ? `, \`${bad}\` does not.` : ".");}
    case "absent_tool": return `\`${fact.params.tool} …\` reported command not found in earlier observed attempts. Other invocation methods were not established.`;
    case "empty_probe": {
      const labels = new Map([["remote","remotes"],["branch","remote branches"],["tag","version tags"],["fsck","unreachable objects"],["stash","stashes"],["refs","refs"]]);
      const checked = Object.keys(fact.params.kinds).flatMap(kind => labels.has(kind) ? [labels.get(kind)!] : []);
      return checked.length ? `Earlier VCS probes returned no ${join(checked)}. Other history was not established by these probes.` : "";
    }
  }
}
export function labelRule(a: string,b: string): [string,string] | null {
  if (a.includes("::") && !b.includes("::")) {const dotted = a.replaceAll("::",".");if (b === dotted || dotted.startsWith(b+".") || b.startsWith(dotted+".")) return ["sep","::"];}
  for (const separator of [".","/"]) if (a.includes(separator)) {const prefix = a.split(separator)[0]+separator, rest = a.slice(prefix.length);if (rest && !b.startsWith(prefix) && (b === rest || rest.startsWith(b+separator) || b.startsWith(rest+separator))) return ["strip",prefix];}
  return null;
}
export function updateEnvironment(prior: EnvironmentState,digest: EnvironmentDigest | null,injectedIds: string[], credits?: LearningCredits): EnvironmentState {
  const state = structuredClone(prior), injected = new Set(injectedIds); state.lastInjected = [];
  if (!digest) {state.now++;return state;}
  digest = {...digest,env:digest.env.map(call => ({...call,need:call.need.filter(safeEnvironmentName),sets:Object.fromEntries(Object.entries(call.sets).filter(([key,value]) => safeEnvironmentValue(key,value)))}))};
  const obs = digest.obs, byIntent = (intent: string) => obs.filter(o => o.intent === intent);
  const fold = (fact: EnvironmentFact,verdict: Verdict,fired: boolean,exercised: boolean) => {
    ({verdict,fired,exercised} = creditLearning(credits,`env:${fact.id}`,verdict,fired,exercised));
    const next = updateEnvironmentLifecycle({life:fact.life,contradictionStreak:fact.family === "form_repair" ? fact.params.contra_streak : 0,family:fact.family},state.now,verdict,fired,exercised,digest.edited);
    fact.life = next.life;if (fact.family === "form_repair") fact.params.contra_streak = next.contradictionStreak;
  };
  for (const intent of ["run_interpreter","run_tests","run_build","package_tool"]) {
    const seq = byIntent(intent), failed = seq.filter(o => formFailed(o) && (["run_tests","run_build"].includes(intent) || isBare(o.form)));
    for (const a of failed) {
      if (!seq.some(o => formWorked(o) && !o.env && o.call > a.call && repairs(o.form,a.form,intent))) continue;
      const id = `form_repair:${intent}:${a.form}`;let fact = state.facts.find(f => f.id === id);
      if (!fact) {fact = {id,family:"form_repair",life:createLifecycle(id,false,false),params:{intent,a:a.form,b_counts:{},b_fails:{},error_counts:{},contra_streak:0}};state.facts.push(fact);}
      if (fact.family === "form_repair") increment(fact.params.error_counts,a.outcome!);
    }
    const ok = new Set(seq.filter(o => formWorked(o) && !o.env).map(o => o.form)), failures = new Set(seq.filter(o => formFailed(o) && !o.env && !ok.has(o.form)).map(o => o.form));
    for (const f of state.facts) if (f.family === "form_repair" && f.params.intent === intent) {
      for (const form of ok) if (repairs(form,f.params.a,intent)) increment(f.params.b_counts,form);
      for (const form of failures) if (Object.hasOwn(f.params.b_counts,form)) increment(f.params.b_fails,form);
    }
  }
  for (const f of state.facts) if (f.family === "form_repair") {
    const seq = byIntent(f.params.intent), aFailed = seq.some(o => o.form === f.params.a && formFailed(o));
    const bRan = seq.some(o => Object.hasOwn(f.params.b_counts,o.form) && formWorked(o)) || seq.some(o => formWorked(o) && !isBare(o.form) && repairs(o.form,f.params.a,f.params.intent));
    const aOk = byIntent(f.params.intent === "run_build" ? "run_build" : "run_tests").some(o => o.form === f.params.a && formWorked(o));
    fold(f,aFailed || bRan && !aOk ? "confirm" : aOk ? "contradict" : null,aFailed || injected.has(f.id) && bRan && !aFailed,seq.length > 0);
  }
  const repaired = new Set(state.facts.flatMap(f => f.family === "form_repair" && workingForm(f) !== null ? [f.params.a] : []));
  const worked = new Set(obs.filter(formWorked).map(o => toolOf(o.form)));
  for (const o of obs) if (["run_build","run_tests","package_tool"].includes(o.intent) && o.outcome === "command_missing" && o.not_found && isBare(o.form) && !o.form.includes(" ") && !repaired.has(o.form) && !worked.has(o.form)) {
    const id = `absent_tool:${o.form}`;if (!state.facts.some(f => f.id === id)) state.facts.push({id,family:"absent_tool",life:createLifecycle(id,true,false),params:{tool:o.form,intent:o.intent}});
  }
  for (const f of state.facts) if (f.family === "absent_tool") {
    const seen = obs.filter(o => toolOf(o.form) === f.params.tool), contradicted = repaired.has(f.params.tool) || seen.some(formWorked);
    const missing = seen.some(o => o.outcome === "command_missing" && o.not_found && o.form === f.params.tool && isBare(o.form));
    const fired = missing || injected.has(f.id) && !contradicted && obs.some(o => o.intent === f.params.intent);
    fold(f,contradicted ? "contradict" : fired ? "confirm" : null,fired,fired || contradicted);
  }
  const runs = byIntent("run_tests").filter(o => o.labels.length);
  for (const [index,a] of runs.entries()) if (a.label_err) for (const label of a.labels) for (const b of runs.slice(index+1)) {
    if (b.form !== a.form || !b.loaded) continue;
    const match = b.labels.map(good => ({good,rule:labelRule(label,good)})).find(row => row.rule !== null);if (!match?.rule) continue;
    const [kind,param] = match.rule, id = `arg_repair:${a.form}:${kind}:${param}`;let fact = state.facts.find(f => f.id === id);
    if (!fact) {fact = {id,family:"arg_repair",life:createLifecycle(id,false,false),params:{form:a.form,kind,param,examples:{}}};state.facts.push(fact);}
    if (fact.family === "arg_repair") increment(fact.params.examples,`${label} ${match.good}`);break;
  }
  for (const f of state.facts) if (f.family === "arg_repair") {
    const mine = runs.filter(o => o.form === f.params.form), bad = (label: string) => f.params.kind === "sep" ? label.includes("::") : label.startsWith(f.params.param);
    const failed = mine.some(o => o.label_err && o.labels.some(bad)), loaded = mine.some(o => o.loaded && o.labels.some(bad)), good = mine.some(o => o.loaded && o.labels.some(label => !bad(label)));
    fold(f,loaded ? "contradict" : failed || good ? "confirm" : null,failed || injected.has(f.id) && good && !failed,mine.length > 0);
  }
  for (const [index,call] of digest.env.entries()) for (const variable of call.need) {
    const later = digest.env.slice(index+1).filter(row => Object.hasOwn(row.sets,variable)), good = later.filter(row => row.ok && !row.need.includes(variable)).map(row => row.sets[variable]);if (!good.length) continue;
    const id = `env_value:${variable}`;let fact = state.facts.find(f => f.id === id);
    if (!fact) {fact = {id,family:"env_value",life:createLifecycle(id,false,false),params:{var:variable,good:{},bad:{}}};state.facts.push(fact);}
    if (fact.family === "env_value") {increment(fact.params.good,good[0]);for (const row of later) if (!row.ok && row.sets[variable] !== good[0]) increment(fact.params.bad,row.sets[variable]);}
  }
  for (const f of state.facts) if (f.family === "env_value") {
    const variable = f.params.var, good = best(f.params.good), asked = digest.env.some(call => call.need.includes(variable)), ok = digest.env.some(call => call.sets[variable] === good && call.ok), failed = digest.env.some(call => call.sets[variable] === good && call.need.includes(variable));
    fold(f,failed ? "contradict" : ok ? "confirm" : null,asked || injected.has(f.id) && ok,asked || digest.env.some(call => Object.hasOwn(call.sets,variable)));
  }
  const fetches = byIntent("fetch_remote"), failures = fetches.filter(o => o.outcome !== null && networkErrors.has(o.outcome)).flatMap(o => o.hosts), okHosts = new Set(fetches.filter(o => o.outcome === "ran").flatMap(o => o.hosts));
  let boundary = state.facts.find(f => f.family === "boundary");
  if (!boundary && failures.length) {boundary = {id:"boundary:fetch_remote",family:"boundary",life:createLifecycle("boundary:fetch_remote",true,false),params:{hosts:{}}};state.facts.push(boundary);}
  if (boundary?.family === "boundary") {
    for (const host of failures) increment(boundary.params.hosts,host);
    const contradicted = Object.keys(boundary.params.hosts).some(host => okHosts.has(host));
    fold(boundary,contradicted ? "contradict" : failures.length ? "confirm" : null,failures.length > 0,fetches.some(o => o.hosts.length > 0));
  }
  const probes = byIntent("probe_vcs_refs").filter(o => o.outcome === "hit" || o.outcome === "empty");let probe = state.facts.find(f => f.family === "empty_probe");
  if (!probe && probes.length) {probe = {id:"empty_probe:vcs_refs",family:"empty_probe",life:createLifecycle("empty_probe:vcs_refs",true,false),params:{kinds:{}}};state.facts.push(probe);}
  if (probe?.family === "empty_probe") {for (const o of probes) increment(probe.params.kinds,o.probe!);fold(probe,probes.some(o => o.outcome === "hit") ? "contradict" : probes.length ? "confirm" : null,probes.length > 0,probes.length > 0);}
  state.now++; return state;
}
const header = "# environment facts learned from earlier sessions in this repository";
function mergedLines(facts: EnvironmentFact[]): string[] {
  const lines = facts.filter(f => f.family !== "form_repair").map(environmentClaim), groups = new Map<string,Extract<EnvironmentFact,{family:"form_repair"}>[]>();
  for (const fact of facts) if (fact.family === "form_repair") {const key = root(workingForm(fact) ?? "");groups.set(key,[...groups.get(key) ?? [],fact]);}
  for (const group of groups.values()) {
    if (group.length === 1) {lines.unshift(environmentClaim(group[0]));continue;}
    const errors = [...new Set(group.map(f => errorPhrases.get(best(f.params.error_counts) ?? "") ?? ""))].filter(Boolean).sort(compareCodePoints), forms = [...new Set(group.map(f => usage(workingForm(f)!)))].sort(compareCodePoints);
    lines.unshift(`${join(group.map(f => usage(f.params.a)))} fail here (${errors.join(", ") || "environment error"}); ${join(forms)} ${forms.length === 1 ? "works" : "work"}.`);
  }
  return lines;
}
export type EnvironmentRender = {text:string;ids:string[];claims:string[]};
export function renderEnvironment(state: EnvironmentState,maxFacts: number,maxTokens: number,reviews:FactReviews = {}): EnvironmentRender {
  const priority = {form_repair:0,arg_repair:1,env_value:2,absent_tool:3,empty_probe:4,boundary:5};
  const candidates = state.facts.filter(f => injectable(f.life) && environmentClaim(f) && factTextSafe(environmentClaim(f)) && factPermitted("environment",f.id,environmentClaim(f),reviews)).sort((a,b) => priority[a.family]-priority[b.family] || (a.family === "form_repair" && a.params.intent === "run_interpreter" ? 0 : 1)-(b.family === "form_repair" && b.params.intent === "run_interpreter" ? 0 : 1) || firingRate(b.life)-firingRate(a.life));
  let chosen: EnvironmentFact[] = [];
  for (const fact of candidates) {const trial = [...chosen,fact];if (trial.length > maxFacts) break;if (Array.from(header+"\n"+mergedLines(trial).map(line => `- ${line}`).join("\n")+"\n").length <= maxTokens*4) chosen = trial;}
  return {text:chosen.length ? header+"\n"+mergedLines(chosen).map(line => `- ${line}`).join("\n")+"\n" : "",ids:chosen.map(f => f.id).sort(compareCodePoints),claims:chosen.map(environmentClaim)};
}
