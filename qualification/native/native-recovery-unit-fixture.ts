import { expect, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createVerifiedSqliteBackup } from "../../runtime/src/db/backup.js";
import { captureNativeRecoveryUnit, nativeRecoveryManifestSha256, verifyNativeRecoveryUnit, type RecoveryEnvironment } from "../../runtime/scripts/lib/native-recovery-unit.js";
import { RehearsalSqliteDatabase } from "../../runtime/durable-engine/src/rehearsal-sqlite.js";
import { Harness, createRegistry, type ConversationId } from "../../runtime/durable-engine/qualification/durable.ts";
import { createModels } from "../../runtime/durable-engine/qualification/ai.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BACKGROUND_CONTEXT as context } from "../../runtime/durable-engine/qualification/context.ts";
import { installCodeReviewFixture } from "./code-review-fixture.ts";
import { qualifyNativeRecoveryUnit } from "../../runtime/durable-engine/src/recovery-unit-qualification.ts";
import { qualifyNativeRetentionUnit } from "./native-retention-unit-fixture.ts";
import { importCopiedLegacyTree, LegacyTreeImportManifest, type GetLegacyContext } from "../../runtime/durable-engine/src/legacy-import.ts";
import { buildSessionContext, convertToLlm, sessionEntryToContextMessages } from "../../node_modules/@earendil-works/pi-coding-agent";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
/** Test-only preparation starts from the actual quiescent native factory DB.
 * Capture/verification itself sees selected offline copies only. */
export async function qualifyNativeRecoveryUnitFixture(root: Database, workspace: string, dataDir: string, retention=false) {
  const base = join(workspace,"unit-fixture"); mkdirSync(base,{mode:0o700});
  const sourceWorkspace = join(base,"workspace"), addons = join(base,"addons"), answers = join(base,"answers");
  for (const path of [sourceWorkspace,addons,answers]) mkdirSync(path,{mode:0o700});
  installCodeReviewFixture(addons);
  const image = new Uint8Array([137,80,78,71,13,10,26,10]);
  const imagePath = ".pi/openai-codex-images/nested/recovery.png";
  mkdirSync(join(sourceWorkspace,".pi/openai-codex-images/nested"),{recursive:true,mode:0o700});
  writeFileSync(join(sourceWorkspace,imagePath),image,{mode:0o600});
  root.query("INSERT INTO extension_kv(extension_id,scope,scope_key,key,value) VALUES('codex-conversion','chat','web:default','outputrefs:recovery-fixture',?)").run(JSON.stringify({hostOperationId:"recovery-fixture",chatJid:"web:default",refs:[{path:imagePath,sha256:sha(image),bytes:image.length,callId:"recovery-call",codexOperationId:"fixture-codex",mimeType:"image/png"}]}));
  const database = join(base,"source.sqlite");
  const sourcePath = (root.query("PRAGMA database_list").all() as {name:string;file:string}[]).find(row=>row.name==="main")!.file;
  createVerifiedSqliteBackup(root,sourcePath,database);
  let authReads=0;
  const denied=async():Promise<never>=>{authReads++;throw Error("Restore validation denies credentials");};
  const openPaused = async (path: string) => Harness.open(await SqliteStorage.open(new RehearsalSqliteDatabase(path)),
    {models:createModels({authContext:{env:denied,fileExists:denied}}),registry:createRegistry()},context);
  const archive = await openPaused(database);
  const archiveContexts = new Map<number, unknown>();
  let archiveReceipt: Awaited<ReturnType<typeof importCopiedLegacyTree>>, archiveRoot: ConversationId;
  try {
    const node = await archive.root(context); archiveRoot=node.id;
    const bridge: GetLegacyContext=(entries,leaf)=>({messages:JSON.parse(JSON.stringify(convertToLlm(buildSessionContext([...entries],leaf).messages))),
      projected:entries.map(entry=>({sourceEntryId:entry.id,messages:JSON.parse(JSON.stringify(convertToLlm(sessionEntryToContextMessages(entry))))}))});
    const timestamp="2026-01-01T00:00:00Z";
    const sourceJSONL=[{type:"session",version:3,id:"recovery-archive",timestamp,cwd:"/copied-source"},
      {type:"message",id:"original-user",parentId:null,timestamp,message:{role:"user",content:"Imported recovery question",timestamp:1}},
      {type:"message",id:"original-answer",parentId:"original-user",timestamp,message:{role:"assistant",content:[{type:"text",text:"Restored archived answer"}],api:"openai-completions",provider:"never-executed",model:"never-executed",stopReason:"stop",timestamp:2,
        usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}}}].map(row=>JSON.stringify(row)).join("\n")+"\n";
    archiveReceipt=await importCopiedLegacyTree(node,{sourceJSONL,hostBranchBindings:{"original-answer":{chatJid:"web:archived-copy",chatIncarnation:"original-archive",branchId:"original-archive",hostBaseline:"Persisted archive baseline"}}},bridge,()=>{},context);
    for(const branch of archiveReceipt.branches) {
      const conversation=await archive.conversation(branch.engineConversationId as ConversationId,context);
      archiveContexts.set(branch.engineConversationId,JSON.parse(JSON.stringify((await conversation!.context(context)).messages)));
    }
    expect((await archive.inspect(context)).scheduling).toBe("paused");
  } finally {await archive.close(context);}
  cpSync(join(dataDir,"durable-answers"),answers,{recursive:true});
  const config = join(base,"public-configuration.json"); writeFileSync(config,JSON.stringify({provider:"synthetic",model:"approved"}),{mode:0o600});
  const environment: RecoveryEnvironment = {runtime:{coreRevision:"9a6e249b9c76de76468ca47837e47b708d7d734e",sdkVersion:"1.4.0",bunVersion:Bun.version}, addonWorkspace:addons,
    configurations:[{id:"runtime-model-policy",path:config}],credentialReferences:["fixture/recovery-profile"],credentialReferenceAvailable:ref=>ref==="fixture/recovery-profile"};
  const output = join(base,"unit");
  const sourceSha256=sha(readFileSync(database));
  const terminalBinding=new Database(database,{readonly:true});
  const selected=terminalBinding.query(`SELECT b.incarnation,b.submission_id AS primary_id,i.submission_id AS intent_id FROM piclaw_durable_bindings_v1 b
    JOIN piclaw_durable_intent_bindings_v1 i ON i.operation_id=b.operation_id`).get() as {incarnation:string;primary_id:number;intent_id:number};
  terminalBinding.close();expect(selected).toBeDefined();
  expect(existsSync(join(answers,sha(`runtime-answer:${selected.incarnation}:${selected.primary_id}`)))).toBe(false);
  const manifest = await captureNativeRecoveryUnit({database,answers,workspace:sourceWorkspace,output,environment});
  const actualTerminal=manifest.references.find(row=>row.referenceSha256===sha(`runtime-answer:${selected.incarnation}:${selected.intent_id}`));
  expect(actualTerminal).toBeDefined();
  expect(readFileSync(join(output,actualTerminal!.file),"utf8")).toBe("factory synthetic reply");
  const approvedManifestSha256=nativeRecoveryManifestSha256(output);
  expect(await verifyNativeRecoveryUnit(output,environment,approvedManifestSha256)).toEqual(manifest);
  await expect(verifyNativeRecoveryUnit(output,environment,"0".repeat(64))).rejects.toThrow("approval mismatch");
  const qualification = await qualifyNativeRecoveryUnit(output,environment,join(base,"qualified-restore"),approvedManifestSha256);
  expect(qualification.scheduling).toBe("paused"); expect(qualification.credentialReads).toBe(0);
  expect(qualification.contexts.length).toBeGreaterThan(1);
  await expect(qualifyNativeRecoveryUnit(output,environment,join(base,"wrong-pin-restore"),"0".repeat(64))).rejects.toThrow("approval mismatch");
  await expect(qualifyNativeRecoveryUnit(output,environment,join(base,"qualified-restore"))).rejects.toThrow();
  expect(manifest.references.map(row=>row.owner).sort()).toEqual(["codex-image","native-answer","native-answer","native-side-input","native-side-result"]);
  expect(manifest.environment.addons.map(row=>row.name)).toContain("@rcarmo/piclaw-addon-code-review");
  const encoded = readFileSync(join(output,"manifest.json"),"utf8");
  expect(encoded).not.toContain("synthetic-only"); expect(encoded).not.toContain(sourcePath);
  await expect(captureNativeRecoveryUnit({database,answers,workspace:sourceWorkspace,output,environment})).rejects.toThrow();
  await expect(verifyNativeRecoveryUnit(output,{...environment,credentialReferenceAvailable:()=>false})).rejects.toThrow("credential reference");
  await expect(verifyNativeRecoveryUnit(output,{...environment,runtime:{...environment.runtime,sdkVersion:"1.3.0"}})).rejects.toThrow("runtime contract");
  const savedConfig=readFileSync(config); writeFileSync(config,"changed configuration");
  await expect(verifyNativeRecoveryUnit(output,environment)).rejects.toThrow("dependency mismatch"); writeFileSync(config,savedConfig);
  const tool=join(addons,".pi/extensions/node_modules/@rcarmo/piclaw-addon-code-review/tool.ts"), savedTool=readFileSync(tool);
  writeFileSync(tool,Buffer.concat([savedTool,Buffer.from("\n// modified\n")]));
  await expect(verifyNativeRecoveryUnit(output,environment)).rejects.toThrow("Unqualified installed"); writeFileSync(tool,savedTool);
  const payload = manifest.references.find(row=>row.owner==="native-answer")!, file=join(output,payload.file), savedPayload=readFileSync(file);
  rmSync(file); await expect(verifyNativeRecoveryUnit(output,environment)).rejects.toThrow(); writeFileSync(file,"corrupt",{mode:0o600});
  await expect(verifyNativeRecoveryUnit(output,environment)).rejects.toThrow("corrupt"); writeFileSync(file,savedPayload,{mode:0o600});
  const manifestPath=join(output,"manifest.json"); writeFileSync(manifestPath,JSON.stringify({...manifest,references:[]}));
  await expect(verifyNativeRecoveryUnit(output,environment)).rejects.toThrow("reference closure"); writeFileSync(manifestPath,encoded);
  expect(await verifyNativeRecoveryUnit(output,environment)).toEqual(manifest);
  const inputPayload=join(answers,payload.file.slice("payloads/".length)), savedInput=readFileSync(inputPayload);
  rmSync(inputPayload);
  expect((await import("../../runtime/src/db/backup.js")).verifySqliteBackup(database).integrityCheck).toBe("ok"); // DB-only green is insufficient.
  const missingOutput=join(base,"missing-input-unit");
  await expect(captureNativeRecoveryUnit({database,answers,workspace:sourceWorkspace,output:missingOutput,environment})).rejects.toThrow("payload missing");
  expect(()=>readFileSync(join(missingOutput,"manifest.json"))).toThrow(); writeFileSync(inputPayload,savedInput,{mode:0o600});
  const savedManifest=readFileSync(manifestPath); writeFileSync(manifestPath,JSON.stringify({...manifest,unexpected:"untrusted field"}));
  await expect(verifyNativeRecoveryUnit(output,environment)).rejects.toThrow("manifest fields"); writeFileSync(manifestPath,savedManifest);
  const sidecar=join(output,"database.sqlite-wal"); writeFileSync(sidecar,"injected sidecar");
  await expect(verifyNativeRecoveryUnit(output,environment)).rejects.toThrow("sidecar"); rmSync(sidecar);
  const malformedDatabase=join(base,"malformed-source.sqlite");copyFileSync(database,malformedDatabase);
  const malformed=new Database(malformedDatabase);try{malformed.exec("ALTER TABLE tasks ADD COLUMN unapproved TEXT");}finally{malformed.close();}
  await expect(captureNativeRecoveryUnit({database:malformedDatabase,answers,workspace:sourceWorkspace,output:join(base,"malformed-unit"),environment})).rejects.toThrow("schema drift");
  const opaqueDatabase=join(base,"opaque-source.sqlite"); copyFileSync(database,opaqueDatabase);
  const uncertain=new Database(opaqueDatabase,{strict:true});
  const opaqueRef="adapter:fixture-secret-reference", instant="2026-01-01T00:00:00.000Z";
  try {uncertain.query(`INSERT INTO service_effect_s05_outbox(outbox_id,kind,state,idempotency_key,request_hash,provenance_ref,redaction_class,payload_ref,
    available_at,enqueued_at,state_changed_at,repeatability,attempt,certainty,last_error_tag,result_at)
    VALUES('uncertain','notification','unknown','fixture-unknown',?,'fixture:outbox','private',?,?,?,?,'reconciliation_required',1,'unknown','lost_ack',?)`)
    .run("0".repeat(64),opaqueRef,instant,instant,instant,instant);}finally{uncertain.close();}
  await expect(captureNativeRecoveryUnit({database:opaqueDatabase,answers,workspace:sourceWorkspace,output:join(base,"unknown-no-proof"),environment})).rejects.toThrow("Adapter-owned payload proof");
  const opaqueFile=join(base,"adapter-payload"), opaqueBytes=new TextEncoder().encode("retained adapter payload");writeFileSync(opaqueFile,opaqueBytes,{mode:0o600});
  const externalPayloads=[{ref:opaqueRef,path:opaqueFile,sha256:sha(opaqueBytes),byteLength:opaqueBytes.length,mediaType:"text/plain",redactionClass:"private" as const}];
  const opaqueUnit=join(base,"opaque-unit");
  const opaqueManifest=await captureNativeRecoveryUnit({database:opaqueDatabase,answers,workspace:sourceWorkspace,output:opaqueUnit,environment,externalPayloads});
  expect(await verifyNativeRecoveryUnit(opaqueUnit,environment)).toEqual(opaqueManifest);
  expect(readFileSync(join(opaqueUnit,"manifest.json"),"utf8")).not.toContain(opaqueRef);
  if(retention) await qualifyNativeRetentionUnit(opaqueUnit,environment,{answers,workspace:sourceWorkspace,externalPayloads});
  const opaqueReceipt=await qualifyNativeRecoveryUnit(opaqueUnit,environment,join(base,"opaque-restore"));
  expect(opaqueReceipt.scheduling).toBe("paused");
  const opaqueRestored=new Database(join(base,"opaque-restore/candidate.sqlite"),{readonly:true});
  try{expect(opaqueRestored.query("SELECT state,certainty FROM service_effect_s05_outbox").all()).toEqual([{state:"unknown",certainty:"unknown"}]);}finally{opaqueRestored.close();}
  for (const mutation of ["outbox","provenance"] as const) {
    const tamperedDestination=join(base,`tampered-${mutation}`), originalClose=RehearsalSqliteDatabase.prototype.close;
    let altered=false;
    const closeHook=spyOn(RehearsalSqliteDatabase.prototype,"close").mockImplementation(async function(this:RehearsalSqliteDatabase){
      await originalClose.call(this);
      if(!altered&&existsSync(join(tamperedDestination,"candidate.sqlite"))){altered=true;const changed=new Database(join(tamperedDestination,"candidate.sqlite"));try{
        if(mutation==="outbox") changed.exec("DELETE FROM service_effect_s05_outbox");
        else {
          const rows=changed.query("SELECT document_id,seq,content FROM document_revisions").all() as {document_id:number;seq:number;content:string}[];
          const imported=rows.find(row=>row.content.includes("original-user"))!;expect(imported).toBeDefined();
          changed.query("UPDATE document_revisions SET content=? WHERE document_id=? AND seq=?").run('{"binding":null}',imported.document_id,imported.seq);
        }
      }finally{changed.close();}}
    });
    try{await expect(qualifyNativeRecoveryUnit(opaqueUnit,environment,tamperedDestination)).rejects.toThrow("Restore changed accepted/history/effect identities");}
    finally{closeHook.mockRestore();}
    expect(()=>readFileSync(join(tamperedDestination,"receipt.json"))).toThrow();
  }
  expect(await verifyNativeRecoveryUnit(opaqueUnit,environment)).toEqual(opaqueManifest);
  let changedManifest=false;
  const changingEnvironment={...environment,credentialReferenceAvailable(ref:string){if(!changedManifest){changedManifest=true;writeFileSync(manifestPath," "+encoded);}return environment.credentialReferenceAvailable(ref);}};
  try{await expect(verifyNativeRecoveryUnit(output,changingEnvironment)).rejects.toThrow("manifest changed during verification");}
  finally{writeFileSync(manifestPath,encoded);}
  const restored = join(base,"restored.sqlite"); copyFileSync(join(output,"database.sqlite"),restored);
  const before = new Database(restored,{readonly:true});
  const identities = before.query("SELECT id,record FROM submissions ORDER BY id").all();
  const entries = before.query("SELECT id,record FROM entries ORDER BY id").all();
  const terminals = before.query("SELECT operation_id,disposition FROM service_effect_s02_commits ORDER BY operation_id").all();
  const conversations = before.query("SELECT id FROM conversations ORDER BY id").all() as {id:number}[];
  const answered = new Set((before.query("SELECT conversation_id FROM piclaw_durable_bindings_v1").all() as {conversation_id:number}[]).map(row=>row.conversation_id));
  expect(before.query("SELECT COUNT(*) AS n FROM addon_code_review_reviews").get()).toEqual({n:1}); before.close();
  const h = await openPaused(restored);
  try {
    const inspection=await h.inspect(context); expect(inspection.scheduling).toBe("paused"); expect(inspection.tasks).toEqual([]);
    expect(answered.size).toBeGreaterThan(0); expect(archiveContexts.size).toBeGreaterThan(0);
    for (const {id} of conversations) {
      const conversation=await h.conversation(id as ConversationId,context); expect(conversation).toBeDefined();
      const messages=(await conversation!.context(context)).messages;
      if (answered.has(id)) expect(JSON.stringify(messages)).toContain("factory synthetic reply");
      else if (archiveContexts.has(id)) { expect(messages).toEqual(archiveContexts.get(id) as typeof messages); expect(JSON.stringify(messages)).toContain("Restored archived answer"); }
      else expect(messages).toEqual([]);
    }
    expect(await h.snapshot(LegacyTreeImportManifest,archiveRoot,context)).toEqual({binding:archiveReceipt});
  } finally {await h.close(context);}
  const after=new Database(restored,{readonly:true});
  try {
    expect(after.query("SELECT id,record FROM submissions ORDER BY id").all()).toEqual(identities);
    expect(after.query("SELECT id,record FROM entries ORDER BY id").all()).toEqual(entries);
    expect(after.query("SELECT operation_id,disposition FROM service_effect_s02_commits ORDER BY operation_id").all()).toEqual(terminals);
    expect(after.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {after.close();}
  expect(authReads).toBe(0);
  expect(sha(readFileSync(database))).toBe(sourceSha256);
  expect(sha(readFileSync(join(output,"database.sqlite")))).toBe(manifest.database.sha256);
  expect(await verifyNativeRecoveryUnit(output,environment)).toEqual(manifest);
}
