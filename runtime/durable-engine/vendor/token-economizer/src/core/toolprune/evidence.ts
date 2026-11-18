// SPDX-License-Identifier: Apache-2.0
// Modified TypeScript port of Microsoft TokenEconomizer, revision 81e32e56bb3c4c1b4c9756b429be91e3960116ca; see ../../../LICENSE.
// Adapted from TokenEconomizer plugin/fold.py and toolprune/stage.py (Apache-2.0).
import { emitting, observing, type Policy } from "../config.ts";
import { compareCodePoints } from "../ordering.ts";
import type { ToolInfo } from "../types.ts";
export type ToolEvidence = { sessions: number; prompts: number; streaks: Record<string, number>; promptStreaks: Record<string, number>; used: string[]; catalogue: ToolInfo[]; applied: string[]; kept: string[]; proposal: string[]; pending: { items: string[]; since: number } | null; refusal: string | null };
export function emptyEvidence(): ToolEvidence { return { sessions: 0, prompts: 0, streaks: {}, promptStreaks: {}, used: [], catalogue: [], applied: [], kept: [], proposal: [], pending: null, refusal: null }; }
export function enoughEvidence(sessions: number, prompts: number, highRisk: boolean, policy: Policy): boolean {
  const k = highRisk ? 3 : 1;
  return sessions >= policy.evidenceMinSessions && prompts >= policy.evidencePrompts * k || sessions >= policy.evidenceSessions * k;
}
/** One evidence update. Live checkpoints count their logical session only once; subsequent prompts add no session/streak vote. */
export function foldEvidence(prior: ToolEvidence, usedTools: string[], catalogue: ToolInfo[], prompts: number | null, policy: Policy, now: number,unmasked = true,countSession = true): ToolEvidence {
  if (prompts === 0 && countSession || !observing(policy) || policy.pruning === "off") return structuredClone(prior);
  const state = structuredClone(prior);
  state.used = [...new Set([...state.used, ...usedTools])].sort(compareCodePoints);
  const protectedNames = new Set(catalogue.filter(tool => tool.protected).map(tool => tool.name));
  if (emitting(policy)) {
    const restored = state.applied.filter(name => protectedNames.has(name));
    state.applied = state.applied.filter(name => !restored.includes(name));state.kept = [...new Set([...state.kept,...restored])].sort(compareCodePoints);
  }
  if (!prior.applied.length && unmasked) {
    const merged = new Map(state.catalogue.map(tool => [tool.name, tool]));
    for (const tool of catalogue) merged.set(tool.name, structuredClone(tool));
    state.catalogue = [...merged.values()];
  }
  state.catalogue = state.catalogue.map(tool => ({...tool,protected:catalogue.find(current => current.name === tool.name)?.protected ?? tool.protected}));
  for (const tool of state.catalogue) {
    const used = usedTools.includes(tool.name);
    state.streaks[tool.name] = used ? 0 : (state.streaks[tool.name] ?? 0) + (countSession ? 1 : 0);
    state.promptStreaks[tool.name] = used ? 0 : (state.promptStreaks[tool.name] ?? 0) + (prompts ?? 1);
  }
  if (countSession) state.sessions++;
  state.prompts += prompts ?? 0;
  state.proposal = state.catalogue.filter(tool => !tool.protected && !state.used.includes(tool.name) && !state.kept.includes(tool.name) && !state.applied.includes(tool.name) && enoughEvidence(state.streaks[tool.name] ?? 0, state.promptStreaks[tool.name] ?? 0, tool.highRisk, policy)).map(t => t.name).sort(compareCodePoints);
  state.pending = state.proposal.length && policy.pruning === "auto" && policy.mode === "active" ? { items: [...state.proposal], since: prior.pending?.since ?? now } : null;
  return state;
}
export function pendingDelay(evidence: ToolEvidence, policy: Policy, now: number, lastActivity: number): number | null {
  if (!evidence.pending || !policy.enabled || policy.mode !== "active" || policy.pruning !== "auto") return null;
  const quiet = policy.quietMinutes * 60_000 - (now - lastActivity);
  const age = 86_400_000 - (now - evidence.pending.since);
  return quiet <= 0 || age <= 0 ? 0 : Math.min(quiet, age, 600_000);
}
export function applyTools(evidence: ToolEvidence, names: string[], named: boolean): string[] {
  const added = names.filter(name => {
    const tool = evidence.catalogue.find(t => t.name === name);
    return tool && !tool.protected && !evidence.applied.includes(name) && !evidence.used.includes(name) && (named || !evidence.kept.includes(name));
  });
  evidence.applied = [...new Set([...evidence.applied, ...added])].sort(compareCodePoints);
  evidence.proposal = evidence.proposal.filter(name => !added.includes(name));
  if (named) evidence.kept = evidence.kept.filter(name => !added.includes(name));
  return added;
}
export function restoreTools(evidence: ToolEvidence, names = evidence.applied): string[] {
  const removed = evidence.applied.filter(name => names.includes(name));
  evidence.applied = evidence.applied.filter(name => !removed.includes(name));
  evidence.kept = [...new Set([...evidence.kept, ...removed])].sort(compareCodePoints);
  evidence.proposal = evidence.proposal.filter(name => !removed.includes(name));
  return removed;
}
