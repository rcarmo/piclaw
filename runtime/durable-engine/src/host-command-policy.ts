import type Database from 'bun:sqlite';
import { admitSqliteWrite } from '../../src/db/sqlite-async-admission.js';
import { assertAutoCompactionSettingWritable, getCompactionRuntimeConfig, setCompactionRuntimeConfig } from '../../src/core/config.js';

/** Host-wide settings, matching /auto-compact's existing scope. SDK reads these
 * at each decision; changing a policy never restarts or replays an operation. */
export function createHostCommandPolicy(root: Database, assertCurrent: () => void) {
  const key = 'native.auto-retry.v1';
  const read = () => {
    assertCurrent();
    const saved = root.query('SELECT value FROM router_state WHERE key=?').get(key) as {value:string} | null;
    if (saved && !['on', 'off'].includes(saved.value)) throw Error('Native retry policy is unreadable');
    return { autoCompact: getCompactionRuntimeConfig().autoCompactionEnabled, autoRetry: saved?.value === 'on' };
  };
  const set = async (name: 'autoCompact' | 'autoRetry', enabled: boolean): Promise<void> => {
    assertCurrent();
    if (typeof enabled !== 'boolean') throw Error('Boolean native policy required');
    if (name === 'autoCompact') {
      assertAutoCompactionSettingWritable(enabled);
      setCompactionRuntimeConfig({autoCompactionEnabled: enabled});
    }
    else if (name === 'autoRetry') await admitSqliteWrite(root, () => {
      root.query('INSERT OR REPLACE INTO router_state (key,value) VALUES (?,?)').run(key, enabled ? 'on' : 'off');
    }, assertCurrent, undefined, undefined, assertCurrent);
    else throw Error('Unknown native policy');
    assertCurrent();
  };
  return {read, set, settings: {
    afterFailedRun: "continue" as const, // Drain distinct accepted inputs; never retry the failed run.
    get retry() { return {enabled: read().autoRetry}; },
    get compaction() { return {enabled: read().autoCompact}; },
  }};
}
