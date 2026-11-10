import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { constants, copyFileSync, fsyncSync, closeSync, lstatSync, mkdirSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { Harness, createRegistry, type ConversationId } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { RehearsalSqliteDatabase } from "./rehearsal-sqlite.js";
import { assertOfflineRecoveryPath, fingerprintRecoveryFile, fingerprintSqliteTables, nativeRecoveryManifestSha256, verifyNativeRecoveryUnit, type RecoveryEnvironment } from "../../scripts/lib/native-recovery-unit.js";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
/** Public SDK inspection of an exclusively created disposable restore, permanently
 * paused. No host factory, provider credential lookup, effect dispatcher, model
 * request, source promotion or automatic replay is invoked. Original unit immutable.
 */
export async function qualifyNativeRecoveryUnit(unitPath: string, environment: RecoveryEnvironment, destinationPath: string, approvedManifestSha256?: string) {
  const unit = resolve(unitPath), destination = assertOfflineRecoveryPath(destinationPath);
  const manifestSha256=approvedManifestSha256 ?? nativeRecoveryManifestSha256(unit);
  const manifest = await verifyNativeRecoveryUnit(unit, environment, manifestSha256);
  const parent = lstatSync(dirname(destination));
  if (destination === unit || destination.startsWith(unit+sep) || realpathSync(dirname(destination)) !== dirname(destination) ||
    !parent.isDirectory() || (parent.mode&0o077)!==0 || process.getuid && parent.uid!==process.getuid()) throw Error("Explicit private offline restore destination required");
  mkdirSync(destination,{mode:0o700});
  const info=lstatSync(destination);
  if (!info.isDirectory() || realpathSync(destination)!==destination || (info.mode&0o077)!==0 || process.getuid && info.uid!==process.getuid()) throw Error("Invalid restore directory ownership");
  const copy = join(destination,"candidate.sqlite");
  copyFileSync(join(unit,manifest.database.file),copy,constants.COPYFILE_EXCL);
  if(fingerprintRecoveryFile(copy).sha256!==manifest.database.sha256) throw Error("Recovery unit changed before restore");
  const inspected = ["conversations","documents","document_revisions","entries","tasks","submissions","record_ids","piclaw_durable_bindings_v1","piclaw_durable_intent_bindings_v1",
    "service_effect_s01_chats","service_effect_s01_sources","service_effect_s01_operations","service_effect_s01_operation_sources",
    "service_effect_s02_commits","service_effect_s05_outbox"];
  const source=new Database(copy,{readonly:true,strict:true,safeIntegers:true});
  let expected:string, conversations:{id:bigint|number}[];
  try {
    // Historical finance is data, never a prerequisite for a fresh recovery unit.
    for(const table of ['budget_work','budget_request_reservations'])if(source.query("SELECT 1 FROM main.sqlite_schema WHERE type='table' AND name=?").get(table))inspected.push(table);
    expected=fingerprintSqliteTables(source,inspected);conversations=source.query("SELECT id FROM conversations ORDER BY id").all() as typeof conversations;
  }
  finally {source.close();}
  let credentialReads=0;
  const denied=async():Promise<never>=>{credentialReads++;throw Error("Recovery qualification denies credential access");};
  const db = new RehearsalSqliteDatabase(copy);
  let harness: Awaited<ReturnType<typeof Harness.open>> | undefined;
  const contexts:{conversationId:number;contextSha256:string}[]=[];
  try {
    harness=await Harness.open(await SqliteStorage.open(db),{models:createModels({authContext:{env:denied,fileExists:denied}}),registry:createRegistry()},context);
    const before=await harness.inspect(context);
    if(before.scheduling!=="paused") throw Error("Recovery scheduling must remain paused");
    for(const row of conversations) {
      const id=Number(row.id);
      if(!Number.isSafeInteger(id)||id<1) throw Error("Invalid recovery conversation identity");
      const conversation=await harness.conversation(id as ConversationId,context);
      if(!conversation) throw Error("Recovery conversation missing");
      contexts.push({conversationId:id,contextSha256:sha(JSON.stringify((await conversation.context(context)).messages))});
    }
    const after=await harness.inspect(context);
    if(after.scheduling!=="paused"||JSON.stringify(before)!==JSON.stringify(after)||credentialReads!==0) throw Error("Recovery inspection changed execution state");
  } finally {
    try {if(harness) await harness.close(context);} finally {await db.close();}
  }
  const restored = new Database(copy,{readonly:true,strict:true,safeIntegers:true});
  try {
    if(fingerprintSqliteTables(restored,inspected)!==expected||restored.query("PRAGMA foreign_key_check").get()) throw Error("Restore changed accepted/history/effect identities");
  } finally {restored.close();}
  await verifyNativeRecoveryUnit(unit,environment,manifestSha256);
  const receipt={version:1,kind:"piclaw.native-recovery-qualification",databaseSha256:manifest.database.sha256,
    manifestSha256,scheduling:"paused" as const,credentialReads,contexts,executionIdentitySha256:expected};
  const receiptPath=join(destination,"receipt.json");
  writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+"\n",{mode:0o600,flag:"wx"});
  for(const path of [copy,receiptPath,destination,dirname(destination)]) {const fd=openSync(path,"r");try{fsyncSync(fd);}finally{closeSync(fd);}}
  return receipt;
}
