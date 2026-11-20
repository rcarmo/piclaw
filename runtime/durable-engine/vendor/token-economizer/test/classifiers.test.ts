import { expect, test } from "bun:test";
import { advanceOptimizer, fitLogistic, fitScaler, initializeOptimizer, objective, sigmoid, softplus, standardize } from "../src/core/classify/logistic.ts";
import { buildBernoulli, bernoulliScore, fitBernoulli } from "../src/core/classify/bernoulli.ts";
import { bm25Score, buildBM25, lexicalKeeps, lexicalCorpus } from "../src/core/classify/bm25.ts";
import { acceptBand, selectBand, wilsonUpper } from "../src/core/classify/thresholds.ts";
import { chronologicalSplit, representatives, retainSamples, sessionWeights } from "../src/core/classify/samples.ts";
import { tokenize, textInDomain } from "../src/core/classify/text.ts";
import { textClassifierArtifact } from "../src/core/classify/artifacts.ts";
import { classificationScore, loopDecision, toolDecision } from "../src/core/classify/routing.ts";
import { auditSelected, compactFailures, noveltyGate, reuseKey } from "../src/core/savers.ts";
import type { Sample, ScoredSample } from "../src/core/classify/contracts.ts";
import { makeObservation } from "../src/core/observations.ts";
function sample(index: number): Sample {return {id:String(index),recordId:String(index),scope:"scope",group:String(index),sessionId:String(index),at:index,kind:"loop",tool:null,features:[index],tokens:["red"],label:index%2 ? 1 : 0,reviewed:false,source:"reference",complete:true,eligible:true,uniform:true,featureVersion:"loop-v1",labelPolicy:"v1",catalogueRevision:"1",environmentRevision:"1",teacher:{provider:"fixture",id:"teacher"},classifier:null,textScore:null};}
test("stable sigmoid, softplus, symmetric fit and exact analytic gradients", () => {
  expect(sigmoid(0)).toBe(.5);expect(sigmoid(Math.log(3))).toBeCloseTo(.75,14);
  for (const value of [-1000,1000]) {expect(Number.isFinite(sigmoid(value))).toBe(true);expect(Number.isFinite(softplus(value))).toBe(true);}
  const rows = {x:[[-1],[-1],[1],[1]],y:[0,0,1,1],a:[.25,.25,.25,.25]};let state = initializeOptimizer(rows);
  while (state.status === "running") state = advanceOptimizer(state,rows);
  expect(state.status).toBe("converged");expect(state.parameters.bias).toBeCloseTo(0,10);expect(state.parameters.weights[0]).toBeCloseTo(1.6335,3);
  const parameters = {bias:.3,weights:[.4]}, analytic = objective(rows,parameters), h = 1e-5;
  expect((objective(rows,{...parameters,bias:parameters.bias+h}).loss-objective(rows,{...parameters,bias:parameters.bias-h}).loss)/(2*h)).toBeCloseTo(analytic.biasGradient,6);
  expect((objective(rows,{...parameters,weights:[.4+h]}).loss-objective(rows,{...parameters,weights:[.4-h]}).loss)/(2*h)).toBeCloseTo(analytic.gradient[0],6);
  const scaler = fitScaler([[3,1],[3,2]],[.5,.5]);expect(scaler.deviations[0]).toBe(0);
  expect(standardize([4,1],scaler)).toBeNull();expect(standardize([3,1000],scaler)).toBeNull();
  expect(fitLogistic([sample(0)])).toEqual({kind:"unready",reason:"insufficient-fit-evidence"});
});
test("Wilson limits, independent representatives and locked acceptance bands", () => {
  expect(wilsonUpper(0,20)).toBeCloseTo(.1611301255,9);expect(wilsonUpper(0,100)).toBeCloseTo(.0369948075,9);
  expect(wilsonUpper(0,0)).toBe(1);expect(() => wilsonUpper(2,1)).toThrow();expect(() => wilsonUpper(-1,20)).toThrow();
  const rows: ScoredSample[] = Array.from({length:100},(_,i) => ({sample:{...sample(i),label:0},score:.1}));
  const selected = selectBand(rows,"low",.05);expect(selected?.threshold).toBe(.1);
  expect(acceptBand(selected,rows,false)?.approved).toBe(true);expect(acceptBand(selected,rows,true)?.approved).toBe(false);
  expect(acceptBand(selected,rows.map(row => ({...row,sample:{...row.sample,reviewed:true}})),true)?.approved).toBe(true);
  expect(selectBand(rows.map(row => ({...row,sample:{...row.sample,group:"correlated"}})),"low",.05)).toBeNull();
  expect(acceptBand(selected,rows.map(row => ({...row,sample:{...row.sample,label:1}})),false)?.approved).toBe(false);
  expect(representatives(rows.slice(0,20).map(row => ({...row.sample,group:"one"})))).toHaveLength(1);
});
test("grouped chronological splits, equal session weights and whole-group retention", () => {
  const rows = Array.from({length:10},(_,i) => sample(i));rows.push({...sample(10),group:"0",sessionId:"fork"});
  const split = chronologicalSplit(rows);expect(new Set(split.fit.map(row => row.group)).size).toBe(6);
  expect(split.fit.some(row => row.sessionId === "fork")).toBe(true);expect(split.acceptance.some(row => row.group === "0")).toBe(false);
  expect(sessionWeights([{sessionId:"a"},{sessionId:"a"},{sessionId:"b"}])).toEqual([.25,.25,.5]);
  const kept = retainSamples([],Array.from({length:4098},(_,i) => ({...sample(i),group:i < 3 ? "old" : String(i)})));
  expect(kept.some(row => row.group === "old")).toBe(false);expect(kept.length).toBeLessThanOrEqual(4096);
});
test("BM25 is positive keep-only ranking with document-frequency counts and ties", () => {
  const documents = [{tool:"red",tokens:["red"]},{tool:"blue",tokens:["blue"]}], index = buildBM25(documents);
  expect(bm25Score(index,["red"],documents[0])).toBeCloseTo(Math.log(2),12);
  expect(bm25Score(index,["red","red"],documents[0])).toBeCloseTo(Math.log(2),12);
  expect(lexicalKeeps(index,["unseen"])).toEqual([]);expect(lexicalKeeps(index,[])).toEqual([]);
  expect(lexicalKeeps(buildBM25(Array.from({length:4},(_,i) => ({tool:String(i),tokens:["red"]}))),["red"])).toHaveLength(4);
  expect(bm25Score(buildBM25([{tool:"empty",tokens:[]}]),["red"],{tool:"empty",tokens:[]})).toBe(0);
});
test("Bernoulli includes absent terms, ignores token repetition and enforces production minima", () => {
  const model = buildBernoulli([{tokens:["red"],label:1},{tokens:["red"],label:1},{tokens:["blue"],label:0},{tokens:["blue"],label:0}]);
  expect(model.prior).toEqual([.5,.5]);expect(bernoulliScore(model,["red"])).toBeCloseTo(.9,12);expect(bernoulliScore(model,["blue"])).toBeCloseTo(.1,12);expect(bernoulliScore(model,["red","red"])).toBeCloseTo(.9,12);
  const dense = (tokens: string[]) => {const sums = model.prior.map((prior,c) => Math.log(prior)+model.vocabulary.reduce((sum,word,j) => sum+(tokens.includes(word) ? Math.log(model.theta[c][j]) : Math.log1p(-model.theta[c][j])),0));return sigmoid(sums[1]-sums[0]);};
  expect(bernoulliScore(model,[])).toBeCloseTo(dense([]),12);expect(bernoulliScore(model,["red"])).toBeCloseTo(dense(["red"]),12);
  expect(fitBernoulli([sample(0)])).toEqual({kind:"unready",reason:"insufficient-fit-evidence"});
  expect(() => buildBernoulli([{tokens:["red"],label:1}])).toThrow();
});
test("tokenizer keeps negation and Unicode but never indexes credentials, code or private paths", () => {
  const input = tokenize("not NO without except camelCase snake_case kebab-case Ｒｅｄ /private/person/sheet.xlsx https://name:secret@host/path?token=secret\n```js\nsecretIdentifier\n```",[{extension:"docx",mimeType:"application/example"}]);
  for (const word of ["not","no","without","except","camel","case","snake","kebab","red","<path>","<ext:xlsx>","<url>","<ext:docx>"]) expect(input.tokens).toContain(word);
  expect(input.tokens).not.toContain("person");expect(input.tokens).not.toContain("secret");expect(input.tokens).not.toContain("secretidentifier");expect(input.omitted).toBe(true);
  expect(textInDomain({tokens:["red","green","blue"],omitted:false},["red","green","blue"])).toBe(true);
  expect(textInDomain({tokens:["red","red","red"],omitted:false},["red"])).toBe(false);
  expect(tokenize("word ".repeat(1000)).tokens).toHaveLength(256);
});
test("text classifiers validate the full distribution and never authorize unready bands", () => {
  const result = {label:"productive",probabilities:{productive:.8,stuck:.1,uncertain:.1},model:{provider:"fixture",id:"classifier"},usage:null,cost:null,error:null,authUnavailable:false,durationMs:1};
  expect(classificationScore(result,["productive","stuck","uncertain"],"stuck")).toBe(.1);
  expect(classificationScore({...result,probabilities:{productive:.8,stuck:.1,uncertain:.2}},["productive","stuck","uncertain"],"stuck")).toBeNull();
  expect(loopDecision(.0001,null,true).kind).toBe("abstain");expect(toolDecision(.0001,null,true,true).kind).toBe("abstain");
  expect(toolDecision(.9,null,false,false)).toMatchObject({kind:"label",label:"keep"});
});
test("savers preserve event identity/progress and cannot reuse changed counters", () => {
  const input = {scope:"scope",runId:"run",segment:0,sourceRange:["1"],counters:[10,2],thresholdRevision:"1",envelopeRevision:"1",policyRevision:"1",model:null,artifactId:null,digest:"same"};
  expect(reuseKey(input)).not.toBe(reuseKey({...input,counters:[11,2]}));expect(reuseKey(input)).not.toBe(reuseKey({...input,sourceRange:["2"]}));
  expect(auditSelected("scope","decision",0)).toBe(false);expect(auditSelected("scope","decision",5)).toBe(auditSelected("scope","decision",5));
  const prior = {seen:[],lastSkip:-1,skips:0}, first = noveltyGate(prior,["signal"],true,2);expect(first.skip).toBe(false);expect(noveltyGate(first.state,["signal"],true,5).skip).toBe(true);expect(noveltyGate(first.state,["signal"],false,5).skip).toBe(false);
  const observation = makeObservation({source:{conversation:"root",outerCall:"1",nestedKey:null,phase:"result"},sessionId:"session",runId:"run",tool:"bash",mapping:{semantic:"shell",readOnly:false},command:"missing",targets:[],output:"missing command",isError:true,exitCode:127,timedOut:false,aborted:false,coverage:"complete",at:1,verification:null});
  const compact = compactFailures([observation,{...observation,id:"2"},{...observation,id:"3",outcome:"success"},{...observation,id:"4"}],"/repo");
  expect(compact.map(row => row.count)).toEqual([2,1,1]);expect(compact[0].lastId).toBe("2");
});
test("committed non-process completion keeps a nullable exit code; missing shell status remains unknown",() => {
  const input = {source:{conversation:"root",outerCall:"call",nestedKey:null,phase:"result" as const},sessionId:"session",runId:"run",tool:"read",mapping:{semantic:"read" as const,readOnly:true},command:"",targets:["file.ts"],output:"contents",isError:false,exitCode:null,timedOut:false,aborted:false,completedNonProcess:true,coverage:"complete" as const,at:0,verification:null};
  expect(makeObservation(input)).toMatchObject({outcome:"success",exitCode:null});
  expect(makeObservation({...input,tool:"bash",mapping:{semantic:"shell",readOnly:false}})).toMatchObject({outcome:"unknown",exitCode:null});
  expect(makeObservation({...input,exitCode:1})).toHaveProperty("outcome","failure");
});

test("text calibration binds its tool identity and derives domain vocabulary only from fitting groups",() => {
  const backend = {provider:"fixture",id:"classifier"};
  const rows:Sample[] = Array.from({length:10},(_,i) => ({...sample(i),kind:"tool",tool:"alpha",featureVersion:"text-v1",tokens:[i < 6 ? "fit-only" : "held-only"],classifier:backend,textScore:i%2 ? .9 : .1}));
  const provenance = {scope:"scope",featureVersion:"text-v1",labelPolicy:"v1",catalogueRevision:"1",environmentRevision:"1",teacher:rows[0].teacher,backend};
  const scores = Object.fromEntries(rows.map(row => [row.id,row.textScore!]));
  const alpha = textClassifierArtifact(rows,provenance,scores,"alpha"), beta = textClassifierArtifact(rows,provenance,scores,"beta");
  expect(alpha.tool).toBe("alpha");expect(beta.tool).toBe("beta");expect(alpha.id).not.toBe(beta.id);expect(alpha.vocabulary).toEqual(["fit-only"]);expect(beta.vocabulary).toEqual([]);
});
test("lexical corpus deduplicates recent positives and enforces document/token resource caps",() => {
  const tasks = Array.from({length:20},(_,i) => ({tool:"rare",tokens:["task"+i]}));tasks.push(tasks[19]);const small = lexicalCorpus([{tool:"rare",tokens:["catalogue"]}],tasks);
  expect(small).toHaveLength(17);expect(small[1].tokens).toEqual(["task19"]);expect(small.some(row => row.tokens[0] === "task0")).toBe(false);
  const large = lexicalCorpus(Array.from({length:4100},(_,i) => ({tool:String(i),tokens:Array(300).fill("token")})),[]);expect(large).toHaveLength(4096);expect(large.every(row => row.tokens.length === 256)).toBe(true);
});
test("tool-drop acceptance counts only complete in-domain candidates not vetoed by lexical keeps",() => {
  const backend = {provider:"fixture",id:"classifier"};
  const rows:Sample[] = Array.from({length:4000},(_,i) => ({...sample(i),kind:"tool",tool:"rare",featureVersion:"text-v1",tokens:["alpha","beta","gamma"],label:0,reviewed:true,classifier:backend,textScore:.1}));
  const provenance = {scope:"scope",featureVersion:"text-v1",labelPolicy:"v1",catalogueRevision:"1",environmentRevision:"1",teacher:rows[0].teacher,backend}, scores = Object.fromEntries(rows.map(row => [row.id,.1]));
  expect(textClassifierArtifact(rows,provenance,scores,"rare").bands.drop?.approved).toBe(true);
  expect(textClassifierArtifact(rows.map(row => ({...row,dropEligible:false})),provenance,scores,"rare").bands.drop).toBeNull();
  expect(textClassifierArtifact(rows.map((row,i) => i >= 2400 ? {...row,tokens:["foreign"]} : row),provenance,scores,"rare").bands.drop).toBeNull();
  expect(textClassifierArtifact(rows,provenance,Object.fromEntries(rows.map(row => [row.id,.9])),"rare").bands.drop).toBeNull();
});
