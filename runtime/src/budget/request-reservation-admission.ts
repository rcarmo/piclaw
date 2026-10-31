import { statSync } from 'node:fs';
import { getDb, getDatabaseBinding } from '../db/connection.js';
import { getWorkspaceDir, getStoreDir, getConfigPath } from '../core/config.js';
import { admitSqliteWrite } from '../db/sqlite-async-admission.js';
import { reserveBudgetRequest, dispatchBudgetRequest, type BudgetRequestBinding } from '../db/budget-request-reservations.js';
import type { BudgetProviderEvidence } from './types.js';

/** Capture one connection and filesystem binding; do not reread a new DB on retry. */
function databaseAdmission() {
  const database = getDb(), binding = getDatabaseBinding();
  const paths = JSON.stringify([getWorkspaceDir(),getStoreDir(),getConfigPath()]);
  return {
    database,
    check() {
      if (getDb() !== database || JSON.stringify(getDatabaseBinding()) !== JSON.stringify(binding)
        || JSON.stringify([getWorkspaceDir(),getStoreDir(),getConfigPath()]) !== paths) throw Error('Request budget database binding changed.');
      if (binding) { const current = statSync(binding.path); if (`${current.dev}:${current.ino}` !== binding.identity) throw Error('Request budget database file changed.'); }
    },
  };
}
export interface BudgetRequestAdmissionOptions {
  signal: AbortSignal;
  authorise(): void;
  providerEvidence?: BudgetProviderEvidence[];
  /** Caller-owned pre-effect wait; omitted keeps the bounded administrative policy. */
  timeoutMs?: number;
}
/** Contention yields to the event loop. Snapshot the host request once. */
export async function admitBudgetRequest(binding: BudgetRequestBinding, input: BudgetRequestAdmissionOptions) {
  const captured = structuredClone(binding), evidence = input.providerEvidence ? structuredClone(input.providerEvidence) : undefined;
  const signal = input.signal, authorise = input.authorise, timeoutMs = input.timeoutMs ?? 5000;
  const {database,check} = databaseAdmission();
  return admitSqliteWrite(database, () => reserveBudgetRequest(captured,{providerEvidence:evidence},database),
    () => { check(); authorise(); },signal,timeoutMs,check);
}
export async function admitBudgetRequestDispatch(binding: BudgetRequestBinding, input: BudgetRequestAdmissionOptions) {
  const captured = structuredClone(binding), evidence = input.providerEvidence ? structuredClone(input.providerEvidence) : undefined;
  const signal = input.signal, authorise = input.authorise, timeoutMs = input.timeoutMs ?? 5000;
  const {database,check} = databaseAdmission();
  return admitSqliteWrite(database, () => dispatchBudgetRequest(captured,{signal,authorise,providerEvidence:evidence},database),
    () => { check(); authorise(); },signal,timeoutMs,check);
}
