// SPDX-License-Identifier: Apache-2.0
import type { Mode, Scope } from "./types.ts";
import { scopeKey } from "./types.ts";
import { compareCodePoints } from "./ordering.ts";
export const contextSection = "token-economizer";
export type LearningSession = {
  id: string; scope: Scope; conversation: string; group: string; started: number; ended: number | null;
  transcriptActivity: number; recordActivity: number; folded: boolean; foldedAt: number | null;
  cutoff: string | null; claim: string | null; foldError: string | null;
  /** Optional for journals predating live learning. Cursor advances atomically with learned state. */
  learning?: { cutoff: string | null; evidenceGroup?:string; credits: import("./microskills/lifecycle.ts").LearningCredits; ticks: number; lastProposalAt: number | null; lastProposalDigest?: string; requested: number; processed: number; lastRun: string | null; toolCounted?: boolean; toolPrompts?: number; finalRequested?: boolean; lastCheck?: {at:number;observations:number;factObservations:number;incomplete:number;proposer:string;notes:string[]} };
  /** Explicit per-session removal survives later learning. */
  factsSuppressed?: boolean;
  /** Stable system-prefix snapshot; live additions are appended to model context instead. */
  initialSection?: string;
  section: string; injectedIds: string[]; frozenMask: string[]; appendedAfterFold: boolean;
};
function copySession(prior: LearningSession): LearningSession {
  const next = { ...prior, scope: { ...prior.scope }, injectedIds: [...prior.injectedIds], frozenMask: [...prior.frozenMask] };
  if (prior.learning) next.learning = {...prior.learning,credits:{confirms:[...prior.learning.credits.confirms],contradicts:[...prior.learning.credits.contradicts],exercises:[...prior.learning.credits.exercises]}};
  if (next.learning && prior.learning?.lastCheck) next.learning.lastCheck = {...prior.learning.lastCheck,notes:[...prior.learning.lastCheck.notes]};
  return next;
}

export type SessionPreparation = {
  id: string; scope: Scope; conversation: string; group: string; now: number;
  event: "startup" | "new" | "resume" | "fork" | "reload"; visibleHistory: boolean;
  carriedSections: Record<string, string>; carriedIds: string[];
  cachedSection: string; cachedIds: string[]; publishedMask: string[]; mode: Mode;
};
export function sessionKey(scope: Scope, id: string): string { return JSON.stringify([scopeKey(scope), id]); }
export function prepareSession(prior: LearningSession | null, input: SessionPreparation): LearningSession {
  if (prior && (scopeKey(prior.scope) !== scopeKey(input.scope) || prior.id !== input.id)) throw new Error("Learning session identity changed");
  const resume = input.visibleHistory || !["startup", "new"].includes(input.event);
  if (prior) return { ...copySession(prior), initialSection: prior.initialSection ?? prior.section, ended: null, recordActivity: input.now, frozenMask: [...input.publishedMask] };
  const freshInjection = !resume && input.mode === "active";
  const selectedSection = freshInjection ? input.cachedSection : resume ? input.carriedSections[contextSection] ?? "" : "";
  return { id: input.id, scope: structuredClone(input.scope), conversation: input.conversation, group: input.group,
    started: input.now, ended: null, transcriptActivity: input.now, recordActivity: input.now,
    folded: false, foldedAt: null, cutoff: null, claim: null, foldError: null,
    section: selectedSection, initialSection: selectedSection,
    injectedIds: freshInjection ? [...input.cachedIds] : resume ? [...input.carriedIds] : [],
    frozenMask: [...input.publishedMask], appendedAfterFold: false };
}
/** An ordinary unrelated patch preserves the section; compaction replaces the complete map. */
export function replaySections(prior: LearningSession, sections: Record<string, string>, compacted: boolean, now: number): LearningSession {
  const next = copySession(prior);
  if (compacted || Object.hasOwn(sections, contextSection)) {
    next.section = sections[contextSection] ?? "";
    if (next.section !== prior.section || !next.section) next.injectedIds = [];
  }
  next.recordActivity = now;
  return next;
}
export function transcriptChanged(prior: LearningSession, now: number): LearningSession {
  return { ...copySession(prior), transcriptActivity: now, recordActivity: now, appendedAfterFold: prior.appendedAfterFold || prior.folded };
}
export function endSession(prior: LearningSession, now: number): LearningSession {
  return { ...copySession(prior), ended: prior.ended ?? now, recordActivity: now };
}
export function recoverableSessions(sessions: LearningSession[], scope: Scope, currentId: string, now: number): LearningSession[] {
  return sessions.filter(row => scopeKey(row.scope) === scopeKey(scope) && row.id !== currentId && !row.folded
    && (row.ended !== null || now-row.transcriptActivity >= 600_000))
    .sort((a,b) => a.started-b.started || compareCodePoints(a.id,b.id));
}
export type FoldAdmission = { kind: "admitted"; session: LearningSession } | { kind: "folded" | "busy" };
export function claimFold(prior: LearningSession, claim: string, cutoff: string, now: number, incremental = false): FoldAdmission {
  if (prior.folded && !incremental) return { kind: "folded" };
  if (prior.claim !== null) return { kind: "busy" };
  return { kind: "admitted", session: { ...copySession(prior), claim, cutoff, recordActivity: now } };
}
export function finishFold(prior: LearningSession, claim: string, now: number, terminalError: string | null = null): LearningSession {
  if (prior.claim !== claim || prior.folded) throw new Error("Fold claim is not current");
  return { ...copySession(prior), claim: null, folded: true, foldedAt: now, foldError: terminalError, recordActivity: now };
}
export function deferFold(prior: LearningSession, claim: string, now: number, incremental = false): LearningSession {
  if (prior.claim !== claim || prior.folded && !incremental) throw new Error("Fold claim is not current");
  return { ...copySession(prior), claim: null, cutoff: null, recordActivity: now };
}
export function repositoryActivity(sessions: LearningSession[], scope: Scope): number {
  return Math.max(0, ...sessions.filter(row => row.scope.host === scope.host && row.scope.repository === scope.repository).flatMap(row => [row.transcriptActivity,row.recordActivity]));
}
