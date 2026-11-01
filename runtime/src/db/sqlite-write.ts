import type { Database } from 'bun:sqlite';
import { sqliteCommand } from './sqlite-read.js';

/** Connection policy and physical transaction ownership never belong to SDK SQL. */
export function assertSqliteMutation(sql: string): boolean {
  const command = sqliteCommand(sql);
  if (['BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'PRAGMA', 'ATTACH', 'DETACH', 'VACUUM'].includes(command))
    throw new Error('SQLite connection policy and transaction control are host-owned');
  return command !== '';
}

/** Let SQLite, not a semicolon splitter, delimit statements (including triggers).
 * exec has no parameters: require an exact unexpanded SQL prefix. Schema changes
 * execute in order so later preparation can resolve their newly created tables. */
export function execSqliteMutation(database: Database, sql: string): void {
  while (assertSqliteMutation(sql)) {
    const statement = database.prepare(sql);
    try {
      const text = statement.toString();
      if (statement.paramsCount !== 0 || !text || !sql.startsWith(text)) throw new Error('SQLite exec requires exact parameter-free statement boundaries');
      statement.run();
      sql = sql.slice(text.length);
    } finally { statement.finalize(); }
  }
}
