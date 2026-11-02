import type { Database } from "bun:sqlite";

/** Leading SQLite command, including EXPLAIN, before fallible preparation.
 * SQLite comments end at LF, not JavaScript's broader line separators. */
export function sqliteCommand(sql: string): string {
  if (sql.includes("\0")) throw new Error("Read-only SQLite query contains NUL");
  let position = 0;
  const word = () => {
    for (;;) {
      while (position < sql.length && /[\s;]/.test(sql[position]!)) position++;
      if (sql.startsWith("--", position)) {
        const end = sql.indexOf("\n", position + 2);
        position = end < 0 ? sql.length : end + 1;
      } else if (sql.startsWith("/*", position)) {
        const end = sql.indexOf("*/", position + 2);
        position = end < 0 ? sql.length : end + 2;
      } else break;
    }
    const token = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(position))?.[0] ?? "";
    position += token.length;
    return token.toUpperCase();
  };
  let command = word();
  if (command === "EXPLAIN") {
    command = word();
    if (command === "QUERY" && word() === "PLAN") command = word();
    if (!command) throw new Error('Incomplete SQLite EXPLAIN command');
  }
  if (!command && position < sql.length) throw new Error('Unsupported SQLite command');
  return command;
}

/** Prepare an SDK read without letting PRAGMA change policy during preparation.
 * SDK 1.4 read callers use SELECT; pragma table functions retain schema reads. */
export function prepareSqliteRead(database: Database, sql: string) {
  if (sqliteCommand(sql) === "PRAGMA") throw new Error("Read-only SQLite queries cannot prepare PRAGMA");
  const statement = database.query(sql);
  if (!("readonly" in statement) || statement.readonly !== true || !("reader" in statement) || statement.reader !== true)
    throw new Error("Read-only SQLite query required");
  return statement;
}
