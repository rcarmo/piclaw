import { admitSqliteWrite } from "../../db/sqlite-async-admission.js";
import { captureHostDatabaseBinding } from "../../db/connection.js";
import { getDb, getRouterState, setRouterState } from "../../db.js";

export type OobeInstanceCompletionKind = "provider-ready";

const OOBE_PROVIDER_READY_COMPLETED_INSTANCE_KEY = "web:oobe:provider-ready:completed";

export async function isProviderReadyOobeCompletedForInstance(authorise: () => void = () => {}, signal?: AbortSignal): Promise<boolean> {
  const binding = captureHostDatabaseBinding();
  const check = () => { binding(); authorise(); };
  signal?.throwIfAborted(); check();
  if (getRouterState(OOBE_PROVIDER_READY_COMPLETED_INSTANCE_KEY) === "true") {
    return true;
  }
  // Auto-complete for established installs with existing conversation history.
  const row = getDb().prepare("SELECT 1 FROM messages LIMIT 1").get() as Record<string, unknown> | undefined;
  return row ? completeOobeForInstance("provider-ready", check, signal) : false;
}

export async function completeOobeForInstance(kind: OobeInstanceCompletionKind, authorise: () => void = () => {}, signal?: AbortSignal): Promise<boolean> {
  const database = getDb(), binding = captureHostDatabaseBinding(database);
  const check = (phase?: 'before' | 'after') => { binding(); authorise(); if (phase === undefined && database.inTransaction) throw Error("OOBE completion requires its own transaction"); };
  return admitSqliteWrite(database, () => {
    if (kind !== "provider-ready") throw Error("Unsupported OOBE completion kind");
    setRouterState(OOBE_PROVIDER_READY_COMPLETED_INSTANCE_KEY, "true");
    return true;
  }, check, signal, undefined, check);
}

export { OOBE_PROVIDER_READY_COMPLETED_INSTANCE_KEY };
