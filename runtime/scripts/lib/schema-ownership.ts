import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";

export type SchemaKind = "table" | "index" | "trigger" | "view";
export interface SchemaObject {
  kind: SchemaKind;
  name: string;
  table: string;
  fingerprint: string;
  storageKind?: string;
  derived?: boolean;
}
export interface SchemaOwner {
  category: "sdk" | "core" | "active-addon" | "migration-archive" | "projection-cache" | "retired";
  initializer: string;
  writers: string[];
  sourceOfTruth: string;
  replayRetention: string;
  references: string[];
}
export interface SchemaContract {
  version: 1;
  sources: Record<string, string>;
  owners: Record<string, SchemaOwner>;
  objects: Record<string, {
    owner: string;
    fingerprints: string[];
    requiredIn: string[];
    /** Exact parent for an index/trigger; required even on a retained optional table. */
    table?: string;
    /** Atomic optional component: any retained owned object requires this table. */
    requiredWhenOwnerPresent?: boolean;
    derivedIndexes?: string[];
  }>;
  documents: { kind: string; owner: string; scope: string; history: string; fork: string }[];
}
const identity = (name: string) => name.replace(/[A-Z]/g, letter => letter.toLowerCase());
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';

/** SQL spelling normalisation, NOT a SQL equivalence prover. String literals
 * retain their exact contents. Approved historical syntax needs its own hash. */
export function canonicalSchemaSql(sql: string, kind: SchemaKind): unknown {
  const tokens: string[] = [];
  const lexer = /\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[a-zA-Z_][a-zA-Z_0-9$]*|\|\||->>|->|>=|<=|<>|!=|==|<<|>>|[^\s]/gy;
  let match: RegExpExecArray | null;
  while ((match = lexer.exec(sql))) {
    const token = match[0];
    if (/^\s|^--|^\/\*/.test(token)) continue;
    if (token.startsWith("'")) tokens.push(token);
    // Keep quoted tokens exact: SQLite's legacy double-quoted strings must
    // not acquire identifier case-folding and hide a changed CHECK literal.
    else if (token.startsWith('"') || token.startsWith("`") || token.startsWith("[")) tokens.push(token);
    else tokens.push(identity(token));
  }
  if (tokens.at(-1) === ";") tokens.pop();
  const exists = tokens[1] === "virtual" || tokens[1] === "unique" ? 3 : 2;
  if (tokens[exists] === "if" && tokens[exists + 1] === "not" && tokens[exists + 2] === "exists") tokens.splice(exists, 3);
  // SQLite ALTER ADD may reorder column declarations. Preserve every clause,
  // CHECK, FK action/deferral, collation, AUTOINCREMENT and literal, but sort the
  // top-level declarations. Order within PK/index/constraint clauses stays exact.
  if (kind === "table" && tokens[1] !== "virtual") {
    const start = tokens.indexOf("(");
    if (start >= 0) {
      let depth = 0, part: string[] = [];
      const parts: string[][] = [];
      for (let i = start + 1; i < tokens.length; i++) {
        const token = tokens[i]!;
        if (token === ")" && depth === 0) {
          parts.push(part);
          return [tokens.slice(0, start), parts.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), tokens.slice(i + 1)];
        }
        if (token === "," && depth === 0) { parts.push(part); part = []; continue; }
        if (token === "(") depth++;
        if (token === ")") depth--;
        part.push(token);
      }
    }
  }
  return tokens;
}

/** Main-schema metadata only. Never initialises, repairs, migrates, ANALYZEs,
 * checkpoints, or reads application payloads. The caller owns connection lifetime. */
export function readSchemaInventory(database: Database): SchemaObject[] {
  const read = () => readSchemaObjects(database);
  return database.inTransaction ? read() : database.transaction(read).deferred();
}

function readSchemaObjects(database: Database): SchemaObject[] {
  const tableKinds = new Map((database.query("PRAGMA main.table_list").all() as { name: string; type: string }[])
    .map(row => [identity(row.name), row.type]));
  const schema = database.query("SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY type,name").all() as
    { type: SchemaKind; name: string; tbl_name: string; sql: string | null }[];
  return schema.map(row => {
    const object: SchemaObject = { kind: row.type, name: row.name, table: row.tbl_name, fingerprint: "" };
    if (row.type === "table") object.storageKind = tableKinds.get(identity(row.name));
    if (row.sql !== null) object.fingerprint = digest(canonicalSchemaSql(row.sql, row.type));
    else if (row.type === "index") {
      const index = (database.query(`PRAGMA main.index_list(${quote(row.tbl_name)})`).all() as { name: string; origin: string; unique: number; partial: number }[])
        .find(index => index.name === row.name);
      if (!index || !["pk", "u"].includes(index.origin)) throw Error(`Unrecognised SQL-less schema object: ${row.name}`);
      object.derived = true;
      const columns = (database.query(`PRAGMA main.index_xinfo(${quote(row.name)})`).all() as { seqno: number; cid: number; name: string | null; desc: number; coll: string | null; key: number }[])
        .filter(column => Number(column.key) === 1).map(column => ({ name: column.name === null ? null : identity(column.name), desc: Number(column.desc), coll: column.coll?.toLowerCase() }));
      object.fingerprint = digest({ origin: index.origin, unique: Number(index.unique), partial: Number(index.partial), columns });
    } else throw Error(`Unrecognised SQL-less schema object: ${row.name}`);
    return object;
  });
}

export function classifySchemaInventory(objects: readonly SchemaObject[], contract: SchemaContract, profile: string) {
  const errors: string[] = [];
  if (contract.version !== 1) errors.push(`Unsupported schema contract version ${contract.version}`);
  for (const document of contract.documents) {
    if (!contract.owners[document.owner] || !document.kind || !document.scope || !document.history || !document.fork) errors.push(`Unowned or incomplete document ${document.kind}`);
  }
  const seen = new Set<string>();
  const seenOwners = new Set<string>();
  const classified = objects.map(object => {
    const key = `${object.kind}:${identity(object.name)}`;
    const parent = contract.objects[`table:${identity(object.table)}`];
    const expected = object.derived ? parent : contract.objects[key];
    if (!expected) { errors.push(`Unowned object ${key}`); return { ...object, owner: null, category: undefined, presence: undefined }; }
    const owner = contract.owners[expected.owner];
    if (!owner || !owner.initializer || (!owner.writers.length && owner.category !== "retired") || !owner.sourceOfTruth || !owner.replayRetention || !owner.references.length) {
      errors.push(`Incomplete owner ${expected.owner} for ${key}`);
    }
    const fingerprints = object.derived ? expected.derivedIndexes ?? [] : expected.fingerprints;
    if (!fingerprints.includes(object.fingerprint)) errors.push(`Unapproved schema drift ${key}`);
    seen.add(key);
    seenOwners.add(expected.owner);
    return { ...object, owner: expected.owner, category: owner?.category,
      presence: expected.requiredIn.includes(profile) ? "required" : "optional-preserved" };
  });
  for (const [key, expected] of Object.entries(contract.objects)) {
    const parentPresent = expected.table !== undefined && seen.has(`table:${identity(expected.table)}`);
    const componentPresent = expected.requiredWhenOwnerPresent === true && seenOwners.has(expected.owner);
    if ((expected.requiredIn.includes(profile) || parentPresent || componentPresent) && !seen.has(key)) errors.push(`Missing required object ${key}`);
  }
  // Unknown profiles must not silently disable the required-object checks.
  if (!Object.values(contract.objects).some(object => object.requiredIn.includes(profile))) errors.push(`Unknown schema profile ${profile}`);
  return { profile, objects: classified, documents: contract.documents, errors };
}

export function assertSchemaInventory(objects: readonly SchemaObject[], contract: SchemaContract, profile: string) {
  const result = classifySchemaInventory(objects, contract, profile);
  if (result.errors.length) throw Error(result.errors.join("\n"));
  return result;
}
