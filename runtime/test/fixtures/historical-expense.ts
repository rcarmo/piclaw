import type { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';

/** Fixed historical DDL, not the retired production initializer. Tests must
 * opt in when exercising old data; fresh-root tests never call this helper. */
export function installHistoricalExpenseFixture(database: Database): void {
  if (database.query("SELECT 1 FROM main.sqlite_schema WHERE name='budget_work'").get()) return;
  const sql=readFileSync(new URL('./historical-expense-schema.sql', import.meta.url), 'utf8');
  const install=()=>database.exec(sql);
  if(database.inTransaction)install();else database.transaction(install).immediate();
}

/** Observe optional historical tables without materialising a fresh ledger. */
export function historicalExpenseRows(database: Database, tables: readonly string[]): unknown[][] {
  return tables.map(table => {
    if (!/^(budget_[a-z_]+|token_usage)$/.test(table)) throw Error('Historical expense/report table required');
    return database.query('SELECT 1 FROM main.sqlite_schema WHERE type=\'table\' AND name=?').get(table)
      ? database.query(`SELECT * FROM main.${table} ORDER BY rowid`).all() : [];
  });
}
