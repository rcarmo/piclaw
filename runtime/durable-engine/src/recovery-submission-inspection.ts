import { copyFileSync, constants, lstatSync, mkdtempSync, rmSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import type { SubmissionId } from "@earendil-works/pi-durable";
import type { RecoverySubmissionState } from "../../scripts/lib/native-recovery-references.js";
import { BunSqliteDatabase } from "./bun-sqlite.js";

/** Read public Storage submission records from an owned disposable copy. No
 * Harness, scheduling, models, providers, auth or host/add-on execution exists.
 * SDK schema normalisation is confined to this copy; failure retains evidence. */
export async function inspectRecoverySubmissions(snapshot: string, ids: readonly number[]): Promise<ReadonlyMap<number,RecoverySubmissionState>> {
  const parent=dirname(dirname(snapshot)), info=lstatSync(parent);
  if (!info.isDirectory() || realpathSync(parent)!==parent || (info.mode&0o077)!==0 || process.getuid && info.uid!==process.getuid()) throw Error("Private recovery inspection parent required");
  const temporary=mkdtempSync(join(parent,"native-submission-inspection-"));
  const candidate=join(temporary,"candidate.sqlite");
  copyFileSync(snapshot,candidate,constants.COPYFILE_EXCL);
  const database=new BunSqliteDatabase(candidate, undefined, { create: false, checkpoint: "builtin" });
  let storage:SqliteStorage|undefined;
  const result=new Map<number,RecoverySubmissionState>();
  try {
    storage=await SqliteStorage.open(database);
    for(const id of ids) {
      if(!Number.isSafeInteger(id)||id<1) throw Error("Invalid recovery submission identity");
      const record=await storage.submission(id as SubmissionId,context);
      if(!record) throw Error("Missing recovery SDK submission");
      result.set(id,{id:Number(record.id),conversationId:Number(record.conversationId),requestId:record.requestId,
        type:record.type,status:record.status,entry:record.entry===undefined?undefined:Number(record.entry),reason:record.reason});
    }
  } finally {try{if(storage) await storage.close(context);}finally{await database.close();}}
  rmSync(temporary,{recursive:true}); // Only our successfully inspected, exclusively minted disposable copy.
  return result;
}
