// SPDX-License-Identifier: Apache-2.0
import type { Sample } from "./contracts.ts";
import { compareCodePoints } from "../ordering.ts";
import { sessionWeights } from "./samples.ts";
export function sigmoid(z: number): number {return z >= 0 ? 1/(1+Math.exp(-z)) : Math.exp(z)/(1+Math.exp(z));}
export function softplus(z: number): number {return Math.max(z,0)+Math.log1p(Math.exp(-Math.abs(z)));}
export type FitRows = {x:number[][];y:number[];a:number[]};
export type Parameters = {weights:number[];bias:number};
export function objective(rows: FitRows,parameters: Parameters) {
  const gradient = parameters.weights.map(w => .1*w);let biasGradient = 0, loss = .05*parameters.weights.reduce((sum,w) => sum+w*w,0);
  for (let i = 0; i < rows.x.length; i++) {
    const z = parameters.bias+parameters.weights.reduce((sum,w,j) => sum+w*rows.x[i][j],0), delta = rows.a[i]*(sigmoid(z)-rows.y[i]);
    loss += rows.a[i]*(softplus(z)-rows.y[i]*z);biasGradient += delta;
    for (let j = 0; j < gradient.length; j++) gradient[j] += delta*rows.x[i][j];
  }
  return {loss,gradient,biasGradient};
}
export type Optimizer = {parameters:Parameters;iteration:number;step:number;loss:number;status:"running"|"converged"|"failed";reason:string|null};
export function initializeOptimizer(rows: FitRows): Optimizer {
  if (!rows.x.length || rows.x.length !== rows.y.length || rows.x.length !== rows.a.length || rows.x.some(row => row.length !== rows.x[0].length || row.some(value => !Number.isFinite(value))) || rows.y.some(y => y !== 0 && y !== 1) || rows.a.some(a => !Number.isFinite(a) || a <= 0) || Math.abs(rows.a.reduce((a,b) => a+b,0)-1) > 1e-8) throw new Error("Invalid logistic fit rows");
  const parameters = {weights:rows.x[0].map(() => 0),bias:0};
  return {parameters,iteration:0,step:1/(.25*Math.max(...rows.x.map(row => 1+row.reduce((sum,x) => sum+x*x,0)))+.1),loss:objective(rows,parameters).loss,status:"running",reason:null};
}
/** Durable runners call this between checkpoints, yielding after each bounded chunk. */
export function advanceOptimizer(prior: Optimizer,rows: FitRows,iterations = 64): Optimizer {
  const state = structuredClone(prior);
  for (let i = 0; i < iterations && state.status === "running"; i++) {
    const current = objective(rows,state.parameters), maximum = Math.max(Math.abs(current.biasGradient),...current.gradient.map(Math.abs));
    if (!Number.isFinite(current.loss) || !Number.isFinite(maximum)) {state.status = "failed";state.reason = "non-finite-fit";break;}
    if (maximum <= 1e-6) {state.status = "converged";break;}
    if (state.iteration >= 2000) {state.status = "failed";state.reason = "non-convergence";break;}
    const next = {bias:state.parameters.bias-state.step*current.biasGradient,weights:state.parameters.weights.map((w,j) => w-state.step*current.gradient[j])}, loss = objective(rows,next).loss;
    if (!Number.isFinite(loss) || loss-current.loss > 1e-10*Math.max(1,Math.abs(current.loss))) {state.status = "failed";state.reason = "loss-increase";break;}
    state.parameters = next;state.loss = loss;state.iteration++;
  }
  return state;
}
export type Scaler = {means:number[];deviations:number[]};
export function fitScaler(x: number[][],weights: number[]): Scaler {
  const constant = x[0].map((value,j) => x.every(row => row[j] === value));
  const means = x[0].map((value,j) => constant[j] ? value : x.reduce((sum,row,i) => sum+weights[i]*row[j],0));
  const deviations = means.map((mean,j) => constant[j] ? 0 : Math.sqrt(x.reduce((sum,row,i) => sum+weights[i]*(row[j]-mean)**2,0)));
  return {means,deviations};
}
export function standardize(x: number[],scaler: Scaler): number[] | null {
  if (x.length !== scaler.means.length || x.some(value => !Number.isFinite(value))) return null;
  const output = x.map((value,j) => scaler.deviations[j] ? (value-scaler.means[j])/scaler.deviations[j] : value === scaler.means[j] ? 0 : NaN);
  return output.every(value => Number.isFinite(value) && Math.abs(value) <= 8) ? output : null;
}
export type LogisticModel = {scaler:Scaler;parameters:Parameters;iterations:number;loss:number};
export type LogisticFit = {kind:"ready";model:LogisticModel} | {kind:"unready";reason:string};
export type PreparedLogistic = {kind:"prepared";data:FitRows;scaler:Scaler}|{kind:"unready";reason:string};
export function prepareLogistic(samples:Sample[]):PreparedLogistic {
  const rows = samples.filter(row => row.label !== null && row.complete && row.eligible).sort((a,b) => a.at-b.at || compareCodePoints(a.id,b.id)), classes = [0,1].map(label => rows.filter(row => row.label === label).length);
  if (rows.length < 200 || classes.some(count => count < 30)) return {kind:"unready",reason:"insufficient-fit-evidence"};
  if (rows.some(row => row.features.length !== 14 || row.features.some(value => !Number.isFinite(value)))) return {kind:"unready",reason:"invalid-fit-features"};
  const a = sessionWeights(rows), raw = rows.map(row => row.features), scaler = fitScaler(raw,a), x = raw.map(row => standardize(row,scaler));
  if (x.some(row => row === null)) return {kind:"unready",reason:"out-of-domain-fit"};
  return {kind:"prepared",data:{x:x.filter(row => row !== null),y:rows.map(row => row.label!),a},scaler};
}
export function fitLogistic(samples:Sample[]):LogisticFit {
  const prepared = prepareLogistic(samples);if (prepared.kind === "unready") return prepared;
  const {data,scaler} = prepared;let state = initializeOptimizer(data);
  while (state.status === "running") state = advanceOptimizer(state,data);
  return state.status === "converged" ? {kind:"ready",model:{scaler,parameters:state.parameters,iterations:state.iteration,loss:state.loss}} : {kind:"unready",reason:state.reason!};
}
export function logisticScore(model: LogisticModel,x: number[]): number | null {
  if (model.parameters.weights.length !== model.scaler.means.length || model.scaler.deviations.length !== model.scaler.means.length || [...model.parameters.weights,model.parameters.bias,...model.scaler.means,...model.scaler.deviations].some(value => !Number.isFinite(value)) || model.scaler.deviations.some(value => value < 0)) throw new Error("Corrupted logistic artifact");
  const standardized = standardize(x,model.scaler);if (!standardized) return null;
  return sigmoid(model.parameters.bias+model.parameters.weights.reduce((sum,w,j) => sum+w*standardized[j],0));
}
