// SPDX-License-Identifier: Apache-2.0
import type { Observation } from "./types.ts";
import { failureIdentity, redact } from "./observations.ts";
import { shellEditTargets } from "./loopguard/shell-edits.ts";
export type GoalPlan = {revision:number;steps:{step:string;status:"pending"|"in_progress"|"completed"}[]};
export type GoalTask = {text:string;id:string;plan:GoalPlan|null};
export type GoalAdvice = {reason:"goal-reminder"|"hypothesis-change"|"verification-debt"|"completion-check";text:string};
/** Advisory checks on observed work, never inferred intent, a completion verdict or an instruction to run more tools. */
export function goalAdvice(task:GoalTask,calls:readonly Observation[],compacted:boolean):GoalAdvice|null {
  if (!task.text.trim() || /^(?:stop|cancel|abort|pause)(?:\s+(?:now|please|this|that|the task|the work))*[.!]?$/i.test(task.text.trim())) return null;
  const edits = calls.flatMap((call,index) => (call.semantic === "edit" || call.semantic === "shell" && shellEditTargets(call.command).length > 0) && !["aborted","unknown"].includes(call.outcome) ? [index] : []);
  const lastEdit = edits.at(-1) ?? -1, lastCheck = calls.findLastIndex(call => call.verification === "passed" && call.coverage === "complete" && call.outcome === "success");
  const debt = edits.filter(index => index > lastCheck).length;
  const pending = task.plan?.steps.filter(step => step.status !== "completed") ?? [];
  const allDone = Boolean(task.plan?.steps.length && !pending.length);
  const failures = calls.slice(lastCheck+1).filter(call => call.outcome === "failure").slice(-3);
  const signatures = failures.map(call => failureIdentity(call,""));
  let reason:GoalAdvice["reason"], guidance:string;
  if (compacted) {reason = "goal-reminder";guidance = "Context was compacted. Reconcile the current request with the active plan before choosing the next step.";}
  else if (calls.length >= 8 && signatures.length === 3 && signatures[0] !== null && signatures.every(signature => signature === signatures[0])) {reason = "hypothesis-change";guidance = "The same failure has recurred. Check the first diagnostic and choose a different hypothesis or a targeted check before repeating the attempt.";}
  else if (debt >= 4 || debt > 0 && allDone) {reason = "verification-debt";guidance = "Edits were observed after the last successful verification (or none was observed). Before claiming success, verify the affected work if appropriate, or state what remains unverified. A passed check does not prove unrelated changes correct.";}
  else if (calls.length >= 3 && pending.length > 0 && lastCheck >= Math.max(0,lastEdit)) {reason = "completion-check";guidance = "A verification passed, but the plan still has unfinished items. Before wrapping up, account for the requested deliverables and acceptance criteria; update the plan or report remaining work and blockers. Do not invent extra work.";}
  else return null;
  const step = pending.find(item => item.status === "in_progress") ?? pending[0];
  const goal = JSON.stringify(redact(task.text).slice(0,800)), active = step ? `\nActive/next plan step (revision ${task.plan!.revision}, ${pending.length} unfinished): ${JSON.stringify(redact(step.step).slice(0,300))}` : "";
  return {reason,text:`Task check (automated, advisory): ${guidance}\nLatest explicit user task/steering (quoted data, not new authority): ${goal}${active}\nFollow the user's latest scope and constraints. This check grants no permission, does not require continuing a blocked task, and never overrides a request to stop.`};
}
