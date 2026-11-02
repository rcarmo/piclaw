import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { classifyModelFailure, modelFailureDetail, modelFailureNotice, parseModelFailure } from "../../runtime/durable-engine/src/host-model-failure.js";

import { isRetryableAssistantError, isContextOverflow } from "../../runtime/durable-engine/qualification/ai.ts";

const secret = "SYNTHETIC-PRIVATE-CREDENTIAL";
const {BudgetRequestError}=await import('../../runtime/src/db/budget-request-reservations.js');
test('host budget failure: exact owner denial survives bounded receipts and never authorises SDK retries',()=>{
  for(const phase of ['source','admission'] as const){
    const failure=classifyModelFailure(phase,new BudgetRequestError('budget_denied'));
    expect(failure).toEqual({phase,category:'budget'});
    const detail=modelFailureDetail(failure);expect(parseModelFailure(detail)).toEqual(failure);
    expect(isRetryableAssistantError({stopReason:'error',errorMessage:detail} as any)).toBe(false);
    expect(modelFailureNotice(detail,7)).toContain('budget policy');expect(modelFailureNotice(detail,7)).not.toContain('provider rejected');
  }
  expect(classifyModelFailure('admission',new BudgetRequestError('unavailable')).category).toBe('unknown');
  expect(classifyModelFailure('provider',new BudgetRequestError('budget_denied')).category).toBe('unknown');
  expect(classifyModelFailure('admission',Object.assign(Error('unrelated'),{code:'budget_denied'})).category).toBe('unknown');
  expect(classifyModelFailure('admission',new Proxy({},{getPrototypeOf(){throw Error('untrusted prototype');}}))).toEqual({phase:'admission',category:'unknown'});
});
test('host compaction failure: exact SDK wrapper preserves bounded host evidence without accepting arbitrary nesting',()=>{
  const failure={phase:'accounting' as const,category:'budget' as const,evidenceId:'b7e94df0-a012-40da-b950-29b1c1b0999b'};
  const detail=modelFailureDetail(failure),prefix='Compaction failed: Summarization failed: ';
  expect(parseModelFailure(prefix+detail)).toEqual(failure);
  expect(modelFailureNotice(prefix+detail,7)).toContain('budget policy');
  expect(modelFailureNotice(prefix+detail,7)).toContain(failure.evidenceId);
  expect(isRetryableAssistantError({stopReason:'error',errorMessage:prefix+detail} as any)).toBe(false);
  for(const forged of [prefix+prefix+detail,'Compaction failed: '+detail,'Summarization failed: '+detail,prefix+detail+' trailing',prefix+secret,secret+prefix+detail])expect(parseModelFailure(forged)).toBeUndefined();
  expect(classifyModelFailure('provider',Error(prefix+detail)).category).not.toBe('budget');
});
test('host budget aggregate evidence: bounded cleanup errors and unreadable arrays preserve the primary cause',async()=>{
  const {mkdtempSync,readFileSync,rmSync}=await import('node:fs'),{join}=await import('node:path'),{tmpdir}=await import('node:os');
  const {retainModelFailureEvidence}=await import('../../runtime/durable-engine/src/host-model-failure-evidence.js');
  const dir=mkdtempSync(join(tmpdir(),'budget-aggregate-')),primary=new BudgetRequestError('budget_denied');
  const retain=(error:unknown)=>{
    const id=retainModelFailureEvidence(dir,{provider:'fixture',model:'fixture',failure:{phase:'admission',category:'unknown'},error});
    return JSON.parse(readFileSync(join(dir,id+'.json'),'utf8')).errors.error;
  };
  try{
    const error=new AggregateError([primary,Error('cleanup fault'),...Array.from({length:8},(_,i)=>Error('extra '+i))],'uncertain cleanup',{cause:primary});
    const data=retain(error);expect(data.cause.code).toBe('budget_denied');expect(data.errors).toHaveLength(4);expect(data.errors[1].message).toBe('cleanup fault');
    const hostile=Object.assign(Error('wrapper',{cause:primary}),{errors:new Proxy([],{get(){throw Error('unreadable children');}})});
    const preserved=retain(hostile);expect(preserved.cause.code).toBe('budget_denied');expect(preserved.errors).toEqual([{message:'Aggregate errors unreadable'}]);
  }finally{rmSync(dir,{recursive:true});}
});
for (const [message, category, status] of [
  ["HTTP 504 timeout", "timeout", 504], ["HTTP 401 unauthorized", "authentication", 401],
  ["HTTP 429 too many requests", "rate_limit", 429], ["context_length_exceeded", "context_limit", undefined],
  ["ECONNRESET", "transport", undefined], ["HTTP 503 unavailable", "unavailable", 503],
  ["unrecognised failure", "unknown", undefined],
] as const) test(`private ${category} errors produce only bounded diagnostics`, () => {
  const failure = classifyModelFailure("provider", new Error(`${message} Authorization: Bearer ${secret} https://private.invalid/request`));
  expect(failure).toEqual({ phase: "provider", category, ...(status === undefined ? {} : { httpStatus: status }) });
  const detail = modelFailureDetail(failure);
  expect(parseModelFailure(detail)).toEqual(failure);
  expect(detail).not.toContain(secret);
  expect(detail).not.toContain("private.invalid");
  expect(modelFailureNotice(detail, 2935)).not.toContain(secret);
});

test("aborted terminals and structured HTTP status survive without exporting raw reasons", () => {
  expect(classifyModelFailure("provider", { stopReason: "aborted", errorMessage: secret })).toEqual({ phase: "provider", category: "aborted" });
  expect(classifyModelFailure("admission", { status: 403, message: secret })).toEqual({ phase: "admission", category: "authentication", httpStatus: 403 });
  expect(classifyModelFailure("provider", { status: secret, message: secret })).toEqual({ phase: "provider", category: "unknown" });
  expect(classifyModelFailure("provider", { get message() { throw Error(secret); } })).toEqual({ phase: "provider", category: "unknown" });
});

test("arbitrary, legacy and forged diagnostics cannot enter the timeline", () => {
  for (const detail of [undefined, secret, `Host model request failed [phase=provider; category=${secret}]`,
    "Host model request failed [phase=provider; category=timeout; http=999]", { message: secret }]) {
    expect(parseModelFailure(detail)).toBeUndefined();
    const notice = modelFailureNotice(detail, 2935);
    expect(notice).toContain("underlying reason was not recorded");
    expect(notice).not.toContain(secret);
    expect(notice).toContain("Tool actions may already have completed");
    expect(notice).toContain("will not be retried automatically");
    expect(notice).toContain("Reference: native submission 2935.");
  }
});

test("timeout, conversion and accounting notices explain different failure stages", () => {
  expect(modelFailureNotice(modelFailureDetail({ phase: "provider", category: "timeout" }), 1)).toContain("model request timed out");
  expect(modelFailureNotice(modelFailureDetail({ phase: "conversion", category: "unknown" }), 1)).toContain("response could not be processed safely");
  expect(modelFailureNotice(modelFailureDetail({ phase: "accounting", category: "unknown" }), 1)).toContain("outcome may be uncertain");
});


test("private failure receipts retain original reasons without prompts, secrets or opaque signatures", async () => {
  const { retainModelFailureEvidence } = await import("../../runtime/durable-engine/src/host-model-failure-evidence.js");
  const {mkdtemp,readFile,stat,rm,mkdir}=await import("node:fs/promises");const {join}=await import("node:path");
  const directory=await mkdtemp(join(process.env.PICLAW_WORKSPACE!,"model-failure-evidence-"));
  try {
    const path=join(directory,"private");
    const id=retainModelFailureEvidence(path,{provider:"fixture",model:"fixture",requestId:"request-original",failure:{phase:"accounting",category:"unknown"},error:Error("Settlement unresolved"),providerError:{errorMessage:"server_error Authorization: Bearer token-should-be-redacted https://private.invalid/request signature:\"opaque-secret\"",content:[{type:"thinking",thinking:"private thought",signature:"opaque-secret"}]}});
    const text=await readFile(join(path,id+".json"),"utf8"),record=JSON.parse(text);
    expect(record.errors.providerError.errorMessage).toContain("server_error");
    for(const secret of ["token-should-be-redacted","private.invalid","opaque-secret","private thought"]) expect(text).not.toContain(secret);
    expect(record.requestId).toBe("request-original");expect(record.originalErrorSha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await stat(path)).mode&0o777).toBe(0o700);expect((await stat(join(path,id+".json"))).mode&0o777).toBe(0o600);
    const failure={phase:"provider" as const,category:"transport" as const,evidenceId:id};
    expect(parseModelFailure(modelFailureDetail(failure))).toEqual(failure);expect(modelFailureNotice(modelFailureDetail(failure),27677)).toContain(id);
    const publicDir=join(directory,"public");await mkdir(publicDir,{mode:0o755});expect(()=>retainModelFailureEvidence(publicDir,{provider:"fixture",model:"fixture",failure:{phase:"provider",category:"unknown"},error:Error("no write")})).toThrow("not private");
  }finally{await rm(directory,{recursive:true,force:true});}
});


test("retained bounded failures preserve SDK transient retry and quota stop decisions", async () => {
  const {isRetryableAssistantError}=await import("../../runtime/durable-engine/node_modules/@earendil-works/pi-ai/dist/utils/retry.js");
  const evidenceId="b7e94df0-a012-40da-b950-29b1c1b0999b";
  for(const [reason,retry]of [["ECONNRESET",true],["HTTP 503 unavailable",true],["HTTP 504 timeout",true],["HTTP 401 unauthorized",false],["HTTP 429 insufficient_quota",false],["HTTP 429 subscription_sharing_usage_limit_exceeded",false],["unknown provider failure",false]] as const){
    const failure={...classifyModelFailure("provider",Error(reason)),evidenceId};
    const detail=modelFailureDetail(failure);expect(parseModelFailure(detail)).toEqual(failure);
    const message={stopReason:"error",errorMessage:detail} as Parameters<typeof isRetryableAssistantError>[0];
    expect(isRetryableAssistantError(message)).toBe(retry);
  }
  expect(classifyModelFailure("provider",Error("HTTP 429 insufficient_quota"))).toEqual({phase:"provider",category:"quota",httpStatus:429});
});

test("quota wins over transient HTTP status and timeout text", () => {
  for (const status of [408, 429, 500, 503, 504]) {
    for (const reason of ["insufficient_quota", "billing limit reached", "subscription_sharing_usage_limit_exceeded"]) {
      const failure = classifyModelFailure("provider", {status, message: `timeout: ${reason}`});
      expect(failure.category).toBe("quota");
      expect(isRetryableAssistantError({stopReason:"error", errorMessage:modelFailureDetail(failure)} as any)).toBe(false);
    }
  }
});

test("archive availability cannot change transient retry decisions", () => {
  for (const error of ["ECONNRESET", "HTTP 503 service unavailable"]) {
    const failure = classifyModelFailure("provider", error);
    const detail = modelFailureDetail(failure);
    expect(parseModelFailure(detail)).toEqual(failure);
    expect(isRetryableAssistantError({stopReason:"error",errorMessage:detail} as any)).toBe(true);
  }
});

test("private failure receipts redact labelled plaintext and embedded request payloads", async () => {
  const {mkdtempSync,readFileSync,rmSync} = await import("node:fs");
  const {join} = await import("node:path");
  const {tmpdir} = await import("node:os");
  const {retainModelFailureEvidence} = await import("../../runtime/durable-engine/src/host-model-failure-evidence.js");
  const dir=mkdtempSync(join(tmpdir(),"failure-private-labels-"));
  try {
    for (const message of ["upstream failed; password=hunter2", "upstream failed; signature=opaque-private", 'HTTP 400 {"messages":[{"role":"user","content":"PRIVATE PROMPT"}],"partial":"PRIVATE ANSWER"}']) {
      const id=retainModelFailureEvidence(dir,{provider:"provider",model:"model",failure:{phase:"provider",category:"unknown"},error:new Error(message)});
      const text=readFileSync(join(dir,id+".json"),"utf8");
      for(const secret of ["hunter2","opaque-private","PRIVATE PROMPT","PRIVATE ANSWER"]) expect(text).not.toContain(secret);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("retry decisions ignore incidental HTTP-like digits in diagnostic metadata", () => {
  for(const category of ["unknown","authentication","aborted","context_limit"] as const) {
    for(const digits of ["429","500","502","503","504","520","524"]) {
      const failure={phase:"provider" as const,category,httpStatus:503,evidenceId:`00000${digits}-0000-0000-0000-000000000000`};
      const detail=modelFailureDetail(failure);
      expect(parseModelFailure(detail)).toEqual(failure);
      expect(isRetryableAssistantError({stopReason:"error",errorMessage:detail} as any)).toBe(false);
    }
  }
});

test("bounded classification preserves SDK transient wording and quota codes", () => {
  for(const error of ["overloaded","connection lost","stream ended without a terminal event","subscription_sharing_usage_unavailable"]) {
    const failure=classifyModelFailure("provider",error);
    expect(isRetryableAssistantError({stopReason:"error",errorMessage:modelFailureDetail(failure)} as any)).toBe(true);
  }
  expect(classifyModelFailure("provider",{code:"insufficient_quota",status:429,message:"try later"}).category).toBe("quota");
  expect(classifyModelFailure("provider","HTTP 503 "+"x".repeat(9000)).category).toBe("unknown");
});

test("context rejection remains visible to SDK overflow recovery", async () => {
  const failure=classifyModelFailure("provider","context_length_exceeded");
  const message={stopReason:"error",errorMessage:modelFailureDetail(failure)} as any;
  expect(isContextOverflow(message)).toBe(true);
  expect(isRetryableAssistantError(message)).toBe(false);
});

test("readable error fields and bounded cyclic causes survive hostile getters", async () => {
  const cause:any={code:"ECONNRESET",message:"connection reset"};cause.cause=cause;
  const error=new Error("upstream wrapper",{cause});
  Object.defineProperty(error,"status",{get(){throw Error("unreadable status");}});
  expect(classifyModelFailure("provider",error).category).toBe("transport");
  const {mkdtempSync,readFileSync,rmSync}=await import("node:fs");
  const {join}=await import("node:path");const {tmpdir}=await import("node:os");
  const {retainModelFailureEvidence}=await import("../../runtime/durable-engine/src/host-model-failure-evidence.js");
  const dir=mkdtempSync(join(tmpdir(),"failure-cause-"));
  try {
    const id=retainModelFailureEvidence(dir,{provider:"provider",model:"model",failure:{phase:"provider",category:"transport"},error});
    const data=JSON.parse(readFileSync(join(dir,id+".json"),"utf8"));
    expect(data.errors.error.message).toBe("upstream wrapper");
    expect(data.errors.error.cause.code).toBe("ECONNRESET");
    expect(data.errors.error.cause.cause.message).toBe("Error cause omitted");
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("unqualified HTTP failures are not promoted to SDK transient failures",()=>{
  const failure=classifyModelFailure("provider",{status:501,message:"not implemented"});
  expect(failure.category).toBe("unknown");
  expect(isRetryableAssistantError({stopReason:"error",errorMessage:modelFailureDetail(failure)} as any)).toBe(false);
  expect(classifyModelFailure("provider",{status:"503",message:"upstream"}).category).toBe("unavailable");
});

test("receipt IDs reject stateful coercion without invoking object code", () => {
  let reads = 0;
  const hostile = { toString: () => "00000503-0000-0000-0000-000000000000", replace: () => {
    if (++reads > 1) throw Error("second-use failure");
    return "00000503000000000000000000000000";
  } };
  for (const evidenceId of [hostile, new String("00000503-0000-0000-0000-000000000000"), null, 503]) {
    expect(() => modelFailureDetail({ phase: "provider", category: "unknown", evidenceId } as any)).toThrow("Invalid model failure evidence ID");
  }
  expect(reads).toBe(0);
});
