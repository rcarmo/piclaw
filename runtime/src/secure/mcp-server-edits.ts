/** Owner-facing edit schema. Existing private/advanced fields are never a draft. */
export interface McpServerPatch {
  command?: string | null;
  args?: string[] | null;
  cwd?: string | null;
  url?: string | null;
  socket?: string | null;
  env?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  auth?: 'oauth' | 'bearer' | false | null;
  bearerTokenEnv?: string | null;
  bearerTokenKeychain?: string | null;
  disabled?: boolean | null;
  lifecycle?: 'keep-alive' | 'lazy' | 'lazy-keep-alive' | 'eager' | null;
  requestTimeoutMs?: number | null;
  idleTimeout?: number | null;
  exposeResources?: boolean | null;
  directTools?: boolean | string[] | null;
  approveTools?: boolean | string[] | null;
  includeTools?: string[] | null;
  excludeTools?: string[] | null;
  toolPrefix?: 'server' | 'none' | 'short' | 'mcp' | null;
  httpTransport?: 'streamable-http' | 'sse' | null;
}
export type McpServerEdit = { name: string; action: 'update' | 'create'; patch: McpServerPatch } | { name: string; action: 'remove_override' };
export class McpServerEditError extends Error {
  constructor(readonly field: string) { super(`Invalid MCP server edit field: ${field}.`); }
}
const FIELDS = new Set(['command','args','cwd','url','socket','env','headers','auth','bearerTokenEnv','bearerTokenKeychain','disabled','lifecycle','requestTimeoutMs','idleTimeout','exposeResources','directTools','approveTools','includeTools','excludeTools','toolPrefix','httpTransport']);
const MAGIC = new Set(['__proto__','constructor','prototype']);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const REFERENCE = /^(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$env:[A-Za-z_][A-Za-z0-9_]*|\{env:[A-Za-z_][A-Za-z0-9_]*\})$/;
const HEADER_REFERENCE = /^(?:Bearer )?(?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$env:[A-Za-z_][A-Za-z0-9_]*|\{env:[A-Za-z_][A-Za-z0-9_]*\})$/;
const sensitive = (value: string) => /(authorization|api[-_]?key|token|secret|password|cookie)/i.test(value);
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, field: string, max = 2048): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new McpServerEditError(field);
  return value;
}
function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 128) throw new McpServerEditError(field);
  return value.map(item => text(item, field, 1024));
}
function entries(value: unknown, field: 'env' | 'headers'): Record<string, string> {
  if (!record(value) || Object.keys(value).length > 64) throw new McpServerEditError(field);
  const pairs = Object.entries(value).map(([key, item]) => {
    if (MAGIC.has(key) || !(field === 'env' ? ENV_NAME : /^[A-Za-z0-9_-]{1,128}$/).test(key)) throw new McpServerEditError(field);
    const string = text(item, field, 4096);
    if (string.startsWith('!') || (sensitive(key) && !(field === 'headers' ? HEADER_REFERENCE : REFERENCE).test(string))) throw new McpServerEditError(field);
    return [key, string];
  });
  return Object.fromEntries(pairs);
}
function choice(value: unknown, field: string, values: readonly unknown[]): unknown {
  if (!values.includes(value)) throw new McpServerEditError(field);
  return value;
}
/** Fixed field errors never interpolate untrusted values, credentials or paths. */
export function parseMcpServerEdit(value: unknown): McpServerEdit {
  if (!record(value) || Object.keys(value).some(key => !['name','action','patch'].includes(key)) || typeof value.name !== 'string' || !NAME.test(value.name) || MAGIC.has(value.name)) throw new McpServerEditError('request');
  if (value.action === 'remove_override') {
    if (Object.hasOwn(value, 'patch')) throw new McpServerEditError('patch');
    return { name: value.name, action: 'remove_override' };
  }
  if ((value.action !== 'update' && value.action !== 'create') || !record(value.patch) || !Object.keys(value.patch).length || Object.keys(value.patch).some(key => !FIELDS.has(key))) throw new McpServerEditError('patch');
  const patch: Record<string, unknown> = {};
  for (const [field, input] of Object.entries(value.patch)) {
    if (input === null) { patch[field] = null; continue; }
    switch (field) {
      case 'args': case 'includeTools': case 'excludeTools': patch[field] = strings(input, field); break;
      case 'env': case 'headers': patch[field] = entries(input, field); break;
      case 'directTools': case 'approveTools': patch[field] = typeof input === 'boolean' ? input : strings(input, field); break;
      case 'disabled': case 'exposeResources': if (typeof input !== 'boolean') throw new McpServerEditError(field); patch[field] = input; break;
      case 'auth': patch[field] = choice(input, field, ['oauth','bearer',false]); break;
      case 'lifecycle': patch[field] = choice(input, field, ['keep-alive','lazy','lazy-keep-alive','eager']); break;
      case 'toolPrefix': patch[field] = choice(input, field, ['server','none','short','mcp']); break;
      case 'httpTransport': patch[field] = choice(input, field, ['streamable-http','sse']); break;
      case 'requestTimeoutMs': case 'idleTimeout':
        if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > (field === 'idleTimeout' ? 1440 : 3_600_000)) throw new McpServerEditError(field);
        patch[field] = input; break;
      case 'bearerTokenEnv':
        if (typeof input !== 'string' || !ENV_NAME.test(input)) throw new McpServerEditError(field); patch[field] = input; break;
      case 'bearerTokenKeychain': patch[field] = text(input, field, 256); break;
      case 'url': {
        const string = text(input, field); let url: URL;
        try { url = new URL(string); } catch { throw new McpServerEditError(field); }
        if (!['https:','http:'].includes(url.protocol) || url.username || url.password || [...url.searchParams.keys()].some(sensitive)) throw new McpServerEditError(field);
        patch[field] = string; break;
      }
      default: patch[field] = text(input, field, 1024);
    }
  }
  return { name: value.name, action: value.action, patch: patch as McpServerPatch };
}

export interface McpServerEditProjection { patch: McpServerPatch; withheldFields: string[] }
/** An editable subset, never an echo of the raw source document. Withheld
 * fields remain private and are preserved by an unrelated-field patch. */
export function projectMcpServerEdit(name: string, definition: unknown): McpServerEditProjection {
  if (!record(definition)) return { patch: {}, withheldFields: ['configuration'] };
  const patch: Record<string, unknown> = {}, withheldFields: string[] = [];
  for (const [field, value] of Object.entries(definition)) {
    if (!FIELDS.has(field)) { withheldFields.push(field); continue; }
    // Arbitrary args and map values may contain credentials even when their
    // field names do not identify them. Only explicit references are exposed.
    if (field === 'args' && (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !REFERENCE.test(item)))) {
      withheldFields.push(field); continue;
    }
    if (field === 'env' || field === 'headers') {
      if (!record(value) || Object.values(value).some(item => typeof item !== 'string' || !(field === 'headers' ? HEADER_REFERENCE : REFERENCE).test(item))) {
        withheldFields.push(field); continue;
      }
    }
    try {
      const parsed = parseMcpServerEdit({ name, action: 'update', patch: { [field]: value } });
      Object.assign(patch, parsed.action === 'update' ? parsed.patch : {});
    } catch { withheldFields.push(field); }
  }
  // Diagnostic field labels are bounded/fixed-schema too; raw advanced keys
  // can themselves be hostile or private. Report only that extras exist.
  return { patch: patch as McpServerPatch, withheldFields: [...new Set(withheldFields.map(field => FIELDS.has(field) ? field : 'advanced'))].sort() };
}

/** Patch one local definition. Effective inheritance is validated separately
 * by the public adapter projection before this candidate may be committed. */
export function patchMcpProjectOverride(document: unknown, value: unknown): Record<string, unknown> {
  const edit = parseMcpServerEdit(value);
  if (!record(document)) throw new McpServerEditError('configuration');
  const next = structuredClone(document);
  const key = Object.hasOwn(next, 'mcpServers') ? 'mcpServers' : Object.hasOwn(next, 'mcp-servers') ? 'mcp-servers' : 'mcpServers';
  if (Object.hasOwn(next, 'mcpServers') && Object.hasOwn(next, 'mcp-servers')) throw new McpServerEditError('configuration');
  const servers = next[key] ?? {};
  if (!record(servers)) throw new McpServerEditError('configuration');
  next[key] = servers;
  if (edit.action === 'remove_override') {
    if (!Object.hasOwn(servers, edit.name)) throw new McpServerEditError('name');
    delete servers[edit.name];
    return next;
  }
  if (edit.action === 'create' && Object.hasOwn(servers, edit.name)) throw new McpServerEditError('name');
  const previous = servers[edit.name];
  if (previous !== undefined && !record(previous)) throw new McpServerEditError('configuration');
  const definition = previous ? { ...previous } : {};
  for (const [field, entry] of Object.entries(edit.patch)) {
    if (entry === null) delete definition[field];
    else definition[field] = structuredClone(entry);
  }
  servers[edit.name] = definition;
  return next;
}

const CREDENTIAL_FIELDS = ['auth','bearerToken','bearerTokenEnv','bearerTokenKeychain','bearerTokenStore','headers','oauth','requestHeadersCommand','env'] as const;
function credentialReferences(definition: Record<string, unknown>): Set<string> {
  const references = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$env:([A-Za-z_][A-Za-z0-9_]*)|\{env:([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
        references.add(`env:${match[1] ?? match[2] ?? match[3] ?? match[4]}`);
      }
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (record(value)) Object.values(value).forEach(visit);
  };
  // Adapter resolution is not confined to auth-labelled fields: URLs,
  // commands/cwd/socket and nested values can interpolate the same identity.
  visit(definition);
  if (typeof definition.bearerTokenEnv === 'string') references.add(`env:${definition.bearerTokenEnv}`);
  if (typeof definition.bearerTokenKeychain === 'string') references.add(`keychain:${definition.bearerTokenKeychain}`);
  return references;
}
function hasOpaqueCredentialPayload(definition: Record<string, unknown>): boolean {
  const opaque = (value: unknown): boolean => {
    if (typeof value === 'string') return !!value && !REFERENCE.test(value) && !HEADER_REFERENCE.test(value);
    if (Array.isArray(value)) return value.some(opaque);
    return record(value) && Object.values(value).some(opaque);
  };
  if (['args','env','headers','bearerToken','oauth','requestHeadersCommand'].some(field => opaque(definition[field]))) return true;
  if (typeof definition.url === 'string') {
    try { const url = new URL(definition.url); return !!url.username || !!url.password || [...url.searchParams.values()].some(opaque); }
    catch { return true; }
  }
  return false;
}
/** Omission from a local layer is not an inherited credential clear. Reject
 * repointing until the exact projected effective definition proves it safe. */
export function assertMcpServerCredentialBinding(original: unknown, projected: unknown): void {
  if (!record(original) || !record(projected)) return;
  const transport = (entry: Record<string, unknown>) => JSON.stringify([entry.command ?? null, entry.url ?? null, entry.socket ?? null,
    entry.command ? entry.args ?? [] : null, entry.command ? entry.cwd ?? null : null]);
  if (transport(original) === transport(projected)) return;
  // Arbitrary stored values may be credentials, and reformatting/rekeying
  // destroys reliable provenance. Require clearing the opaque payload before
  // a destination change; do not guess based on names or substring matches.
  if (hasOpaqueCredentialPayload(original) && hasOpaqueCredentialPayload(projected)) throw new McpServerEditError('inherited_credentials');
  const oldReferences = credentialReferences(original);
  if ([...credentialReferences(projected)].some(reference => oldReferences.has(reference))) throw new McpServerEditError('inherited_credentials');
  const sharesValue = (before: unknown, after: unknown): boolean => {
    if (record(before) && record(after)) return Object.keys(before).some(key => Object.hasOwn(after, key) && sharesValue(before[key], after[key]));
    return before !== undefined && after !== undefined && JSON.stringify(before) === JSON.stringify(after);
  };
  if (CREDENTIAL_FIELDS.some(field => sharesValue(original[field], projected[field])
    && !(field === 'auth' && projected[field] === false) && !(field === 'oauth' && projected[field] === false))
    // Arguments may contain literal credentials without recognisable names.
    // Conservatively refuse carrying any old argument to a changed program.
    || (Array.isArray(original.args) && Array.isArray(projected.args) && original.args.some(arg => typeof arg === 'string'
      && (projected.args as unknown[]).includes(arg)))) {
    throw new McpServerEditError('inherited_credentials');
  }
}
