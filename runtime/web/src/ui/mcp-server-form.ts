import { MCP_SERVER_FIELDS } from './mcp-server-settings-model.js';

export type McpServerField = typeof MCP_SERVER_FIELDS[number][0];
export const MCP_FIELD_LABELS: Partial<Record<McpServerField, string>> = {
    auth: 'Authentication', disabled: 'Availability', lifecycle: 'Connection lifetime',
    httpTransport: 'HTTP transport', exposeResources: 'Resources', toolPrefix: 'Tool name prefix',
};
export const MCP_FIELD_CHOICES: Partial<Record<McpServerField, ReadonlyArray<readonly [string, string]>>> = {
    auth: [['"bearer"', 'Bearer token'], ['"oauth"', 'OAuth'], ['false', 'No authentication']],
    disabled: [['false', 'Enabled'], ['true', 'Disabled']],
    exposeResources: [['true', 'Expose resources'], ['false', 'Do not expose resources']],
    lifecycle: [['lazy', 'Lazy — connect when needed'], ['eager', 'Eager — connect at startup'], ['keep-alive', 'Keep alive'], ['lazy-keep-alive', 'Lazy, then keep alive']],
    httpTransport: [['streamable-http', 'Streamable HTTP'], ['sse', 'Server-sent events (SSE)']],
    toolPrefix: [['server', 'Server name'], ['none', 'No prefix'], ['short', 'Short prefix'], ['mcp', 'MCP prefix']],
};
export const MCP_FIELD_HELP: Record<McpServerField, string> = {
    url: 'HTTP or HTTPS endpoint. Do not put credentials in the URL.',
    httpTransport: 'Use the transport supported by the remote server.',
    command: 'Executable used to start a local stdio server.',
    args: 'JSON array of command arguments, for example ["--stdio"].',
    cwd: 'Working directory for the local process.',
    socket: 'Unix socket path, instead of a process or HTTP endpoint.',
    auth: 'Choose the server’s authentication method. Enter references below, never a token.',
    bearerTokenKeychain: 'Name of an existing keychain entry, for example services/reader.',
    bearerTokenEnv: 'Environment variable name, for example SERVICE_TOKEN.',
    headers: 'JSON object. Use environment references for credentials, for example {"Authorization":"Bearer ${SERVICE_TOKEN}"}.',
    env: 'JSON object of process environment references, for example {"SERVICE_TOKEN":"${SERVICE_TOKEN}"}.',
    disabled: 'Enable or disable this server in configuration. This is not a connection check.',
    lifecycle: 'Control when the connection opens and how long it stays open.',
    requestTimeoutMs: 'Request timeout in milliseconds. Blank preserves the current value; null removes the local value.',
    idleTimeout: 'Idle timeout in minutes. Blank preserves the current value; null removes the local value.',
    directTools: 'Use false for the MCP proxy, true for all direct tools, or a JSON array of tool names.',
    includeTools: 'JSON array of tool names to include.',
    excludeTools: 'JSON array of tool names to exclude.',
    approveTools: 'Boolean or JSON array of tool names requiring approval.',
    exposeResources: 'Make the server’s resources available through MCP.',
    toolPrefix: 'How exposed tool names are prefixed.',
};
export const MCP_STRUCTURED_FIELDS = new Set<McpServerField>(['args', 'env', 'headers', 'directTools', 'includeTools', 'excludeTools', 'approveTools']);
export const MCP_FORM_FIELDS = new Map(MCP_SERVER_FIELDS.map(field => [field[0], field]));
