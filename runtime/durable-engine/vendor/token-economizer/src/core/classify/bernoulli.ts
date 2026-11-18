// SPDX-License-Identifier: Apache-2.0
import { compareCodePoints } from "../ordering.ts";
import { fingerprint } from "../identity.ts";
import { sigmoid } from "./logistic.ts";
import type { Sample } from "./contracts.ts";
export type BernoulliRows = {tokens:string[];label:0|1}[];
export type BernoulliModel = {vocabulary:string[];counts:[number,number];prior:[number,number];theta:[number[],number[]];base:[number,number]};
/** Raw scorer constructor for analytic tests. Production fitting must use fitBernoulli. */
export function buildBernoulli(rows: BernoulliRows): BernoulliModel {
  const frequency = new Map<string,number>(), classFrequency = [new Map<string,number>(),new Map<string,number>()];
  for (const row of rows) for (const token of new Set(row.tokens)) {frequency.set(token,(frequency.get(token) ?? 0)+1);const own = classFrequency[row.label];own.set(token,(own.get(token) ?? 0)+1);}
  const vocabulary = [...frequency.keys()].sort((a,b) => frequency.get(b)!-frequency.get(a)! || compareCodePoints(a,b)).slice(0,2000);
  const counts: [number,number] = [rows.filter(row => row.label === 0).length,rows.filter(row => row.label === 1).length];
  if (!counts[0] || !counts[1]) throw new Error("Bernoulli fitting requires both relevance classes");
  const prior: [number,number] = [(counts[0]+1)/(rows.length+2),(counts[1]+1)/(rows.length+2)];
  const probabilities = (label:0|1) => vocabulary.map(token => ((classFrequency[label].get(token) ?? 0)+1)/(counts[label]+2));
  const theta: [number[],number[]] = [probabilities(0),probabilities(1)];
  const base: [number,number] = [Math.log(prior[0])+theta[0].reduce((sum,p) => sum+Math.log1p(-p),0),Math.log(prior[1])+theta[1].reduce((sum,p) => sum+Math.log1p(-p),0)];
  return {vocabulary,counts,prior,theta,base};
}
export type BernoulliFit = {kind:"ready";model:BernoulliModel} | {kind:"unready";reason:string};
export function fitBernoulli(samples: Sample[]): BernoulliFit {
  const sessions = new Map<string,Sample>();
  for (const row of samples.filter(row => row.kind === "tool" && row.complete && row.eligible)) {const prior = sessions.get(row.sessionId);if (!prior || compareCodePoints(fingerprint(row.id),fingerprint(prior.id)) < 0) sessions.set(row.sessionId,row);}
  const rows = [...sessions.values()].filter(row => row.label !== null);
  if ([0,1].some(label => rows.filter(row => row.label === label).length < 20)) return {kind:"unready",reason:"insufficient-fit-evidence"};
  const working = new Set<string>();for (const row of rows) for (const token of row.tokens) {working.add(token);if (working.size > 32768) return {kind:"unready",reason:"working-data-limit"};}
  return {kind:"ready",model:buildBernoulli(rows.map(row => ({tokens:row.tokens,label:row.label!})))};
}
export function bernoulliScore(model: BernoulliModel,tokens: string[]): number {
  if (model.vocabulary.length !== model.theta[0].length || model.vocabulary.length !== model.theta[1].length || model.theta.flat().some(p => !Number.isFinite(p) || p <= 0 || p >= 1) || model.base.some(value => !Number.isFinite(value))) throw new Error("Corrupted Bernoulli artifact");
  const present = new Set(tokens), score = [...model.base];
  for (let j = 0; j < model.vocabulary.length; j++) if (present.has(model.vocabulary[j])) for (const c of [0,1]) score[c] += Math.log(model.theta[c][j])-Math.log1p(-model.theta[c][j]);
  return sigmoid(score[1]-score[0]);
}
