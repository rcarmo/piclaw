// SPDX-License-Identifier: Apache-2.0
import { fingerprint } from "../identity.ts";
import { compareCodePoints } from "../ordering.ts";
import type { Sample } from "./contracts.ts";
export function chronologicalSplit(samples: Sample[]) {
  const times = new Map<string,number>();for (const sample of samples) times.set(sample.group,Math.min(times.get(sample.group) ?? Infinity,sample.at));
  const groups = [...times.keys()].sort((a,b) => times.get(a)!-times.get(b)! || compareCodePoints(a,b)), first = Math.floor(groups.length*.6), second = Math.floor(groups.length*.8);
  const fit = new Set(groups.slice(0,first)), selection = new Set(groups.slice(first,second));
  return {fit:samples.filter(row => fit.has(row.group)),selection:samples.filter(row => selection.has(row.group)),acceptance:samples.filter(row => !fit.has(row.group) && !selection.has(row.group))};
}
/** Pick before looking at labels/scores; missing labels do not cause another window to be selected. */
export function representatives(samples: Sample[]): Sample[] {
  const selected = new Map<string,Sample>();
  for (const sample of samples) {
    if (!sample.complete || !sample.eligible || !sample.uniform) continue;
    const prior = selected.get(sample.group);
    if (!prior || compareCodePoints(fingerprint("representative-v1:"+sample.id),fingerprint("representative-v1:"+prior.id)) < 0) selected.set(sample.group,sample);
  }
  return [...selected.values()];
}
export function sessionWeights(samples: Pick<Sample,"sessionId">[]): number[] {
  const counts = new Map<string,number>();for (const sample of samples) counts.set(sample.sessionId,(counts.get(sample.sessionId) ?? 0)+1);
  return samples.map(sample => 1/(counts.size*counts.get(sample.sessionId)!));
}
export function retainSamples(prior: Sample[],incoming: Sample[]): Sample[] {
  let rows = [...new Map([...prior,...incoming].map(sample => [sample.id,sample])).values()];
  const times = new Map<string,number>();for (const row of rows) times.set(row.group,Math.min(times.get(row.group) ?? Infinity,row.at));
  const groups = [...times.keys()].sort((a,b) => times.get(a)!-times.get(b)! || compareCodePoints(a,b));
  while (rows.length && (rows.filter(row => row.kind === "loop").length > 4096 || new Set(rows.filter(row => row.kind === "tool").map(row => row.recordId)).size > 4096 || new TextEncoder().encode(JSON.stringify(rows)).byteLength > 64*1024*1024)) {
    const group = groups.shift();rows = rows.filter(row => row.group !== group);
  }
  return rows;
}
