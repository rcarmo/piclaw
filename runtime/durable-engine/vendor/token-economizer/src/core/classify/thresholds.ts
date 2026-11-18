// SPDX-License-Identifier: Apache-2.0
import type { Band, ScoredSample } from "./contracts.ts";
import { representatives } from "./samples.ts";
export function wilsonUpper(errors: number,n: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(errors) || n < 0 || errors < 0 || errors > n) throw new Error("Invalid independent risk counts");
  if (!n) return 1;const z = 1.96,p = errors/n;
  return (p+z*z/(2*n)+z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n)))/(1+z*z/n);
}
function risk(rows: ScoredSample[],threshold: number,direction: "low"|"high") {
  const selectedIds = new Set(representatives(rows.map(row => row.sample)).map(row => row.id));
  const selected = rows.filter(row => selectedIds.has(row.sample.id) && (row.sample.kind !== "tool" || row.sample.dropEligible !== false) && row.sample.label !== null && Number.isFinite(row.score) && (direction === "low" ? row.score <= threshold : row.score >= threshold));
  const errors = selected.filter(row => row.sample.label === (direction === "low" ? 1 : 0)).length;
  return {selected:selected.length,errors,upper:wilsonUpper(errors,selected.length),reviewed:selected.length > 0 && selected.every(row => row.sample.reviewed)};
}
export function selectBand(rows: ScoredSample[],direction: "low"|"high",limit: number): Band | null {
  const scores = [...new Set(rows.map(row => row.score).filter(Number.isFinite))].sort((a,b) => direction === "low" ? b-a : a-b);
  for (const threshold of scores) {const measured = risk(rows,threshold,direction);if (measured.selected && measured.upper <= limit) return {threshold,direction,errorLimit:limit,...measured,approved:false};}
  return null;
}
/** No threshold search is allowed here: the held-out split confirms the one locked candidate. */
export function acceptBand(candidate: Band | null,rows: ScoredSample[],requireReview: boolean): Band | null {
  if (!candidate) return null;const measured = risk(rows,candidate.threshold,candidate.direction);
  return {...candidate,...measured,approved:measured.selected > 0 && measured.upper <= candidate.errorLimit && (!requireReview || measured.reviewed)};
}
export function inApprovedBand(band: Band | null,score: number): boolean {return band?.approved === true && Number.isFinite(score) && (band.direction === "low" ? score <= band.threshold : score >= band.threshold);}
