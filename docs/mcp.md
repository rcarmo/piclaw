# Outbound MCP

Core uses the public `pi-mcp` client through its existing `pi-durable` Harness. MCP calls share the conversation's SDK execution, cancellation, persistence and recovery. Connection setup has a bounded discovery pool; remote tool effects are never retried automatically.

This page covers outbound connections. The inbound CLI/control MCP server is outside this integration. The standalone `pi` CLI is unchanged.

## Add a connection

Open **Settings → MCP**, select **New connection**, and enter a name containing letters, digits or underscores. Choose HTTP or stdio, the access scope, authentication and timeout. Save the connection, then check its discovery status.

- HTTP supports explicit anonymous access, a bearer token reference, or OAuth.
- Stdio takes a JSON array of executable arguments, an absolute working directory and an optional environment object. It runs without a shell or ambient host credentials.
- Stdio has one execution workspace. HTTP can have explicit workspace and Agent grants, or an all-workspaces grant.
- Names must be unique where workspace grants overlap. Up to100 connections can be configured.

An empty **Selected Agents** list does not save as a broad grant. Choose **This workspace, all Agents** explicitly if that is the intended scope. SDK tool filters and Delegate capability limits still apply. Task-owned children and unrouted SDK forks do not acquire MCP access through their parent.

Saving a configuration does not interrupt or replay a tool effect. Revision checks reject stale saves and removals. **Reconnect** repeats discovery, not the last tool call.

## Credentials

Store secrets in the existing encrypted keychain. Enter a keychain entry name such as `mcp/knowledge/token` in the bearer-reference field; do not enter the token itself or add a `keychain:` prefix there. The saved-reference field stays blank when editing. Leaving it blank preserves the reference.

For stdio environment entries, use the reference syntax:

```json
{
  "API_KEY": "keychain:mcp/local/token",
  "NODE_ENV": "production"
}
```

Sensitive environment values require references. Loader/startup injection variables and malformed names are rejected at save and launch. Environment whitespace is preserved.

Credentials are bound to their destination:

- Repointing an HTTP connection disables reuse of its existing credential until the operator explicitly approves the new endpoint.
- Changing a stdio executable, arguments or working directory cannot silently carry saved keychain environment references to the new command.
- Migration with unproved credential provenance stays disabled and requires explicit reuse approval. Merely toggling **Enabled** does not approve it.
- A new explicitly selected reference binds to its new destination.
- OAuth URL changes require a new sign-in, even after a reuse approval.

Local keychain changes invalidate the old connection epoch. Reconnect after replacing a saved secret. Revoked sources cannot send a request or publish a retained result. HTTP bearer material is confined to the exact endpoint and is not forwarded through redirects. **No authentication** never forwards bearer material.

### OAuth

Save an OAuth connection, then select **Sign in**. Discovery, PKCE, token exchange and refresh use the public SDK. Tokens and pending state stay in the encrypted keychain.

The callback binds the connection/workspace/endpoint, redirect URL, browser cookie, one-use state and expiry. It consumes pending state before token exchange, so callback retries cannot replay an uncertain exchange. **Sign out** joins refresh, clears that connection's OAuth state and disables it.

## Discover and call tools

MCP tools are deferred behind code mode. Search their current schemas, then call them with ordinary objects. The old `mcp({tool,args})` proxy and engine-switching controls are retired.

For a server named `knowledge` with a remote `read` tool:

```javascript
const result = await tools.mcp__knowledge__read({ id: "example" });
return result;
```

Code mode receives the original structured value. An eligible model-facing result may be shortened afterwards; scripts never receive a summary in place of the tool value.

Each server also has deferred resource helpers:

```javascript
const catalog = await tools.mcp__knowledge__resources_list({});
const resource = await tools.mcp__knowledge__resource_read({
  uri: "memory://catalog"
});
return { catalog, resource };
```

Tool discovery, resource reads and calls recheck the current grant. A cached schema does not grant authority. Setup retries use1/5/15-second delays where appropriate; an unsuccessful or uncertain remote effect is not replayed.

## Recall and retained outputs

Per-connection recall defaults **Off**. **Observe** records eligible retained copies without shortening model output; **Active** can shorten eligible MCP-only script results. Both keep committed source history intact. Errors and uncertain/truncated results remain unchanged.

Recall requires the original owner, visible SDK branch history and current connection grant/credential epoch. Another Agent, workspace, sibling fork or revoked grant cannot retrieve the copy. Retention and item/byte limits apply to the index. Pinning only exempts an item from age expiry.

Code mode can search or page through an original without rerunning it:

```javascript
const matches = await tools.mcp_recall_search({ query: "example" });
const page = await tools.mcp_recall_retrieve({
  id: "mcp_<id from the result>", mode: "full", maxChars: 4000
});
return { matches, page };
```

`mcp_recall_manage` lists/stats, pins or forgets scoped copies. **Forget recall** in Settings removes this connection's retained copies in the current workspace. Original SDK history and other workspaces' copies remain.

**Settings → Optimisation** independently controls general tool-output reduction/offload, model-written summaries, learned facts, tool pruning and task oversight. Optimisation defaults **Off**; its first enable starts in **Observe**. Model use in either Observe mode and sharing one bounded current Plan item require explicit consent. Oversight can run while token optimisation is Off.

Long bash outputs use task-owned local file bindings and bounded retrieval. General offload uses `read_tool_output` and `search_tool_output`. Shortening stops when the permitted retrieval tool is unavailable. Restoring optimiser-owned tools cannot widen an external SDK filter.

## One-shot configuration migration

On the first cutover, Core reads existing definitions through the old configuration parser and imports supported metadata into the application's SQLite database. It does not execute the old adapter, resolve secrets during planning, write the source files or import old transcripts.

The reader preserves the existing source precedence, including shared global files, `.agents` files, the active Pi profile, project `.mcp.json` and project `.pi/mcp.json`. The adapter package remains only for this read-only migration parser. Later Settings changes use SQLite; the completed migration never rereads old files to overwrite edits or resurrect a deleted connection.

The current bearer-reference shape is supported:

```json
{
  "mcpServers": {
    "knowledge": {
      "url": "https://knowledge.example.test/mcp",
      "bearerTokenKeychain": "mcp/knowledge/token",
      "bearerTokenEnv": "LEGACY_KNOWLEDGE_TOKEN",
      "directTools": false
    }
  }
}
```

`bearerTokenEnv` is retained as legacy metadata input, not injected into global `process.env`. The reference resolves only at the outbound connection boundary.

Unknown restrictions and unsupported semantics import disabled with named diagnostics, or remain in unchanged source with an explicit repair diagnostic. In particular, Core does not silently reinterpret `includeTools`, `excludeTools`, approval rules, command-secret interpolation, socket transports or direct-tool exposure. Review these entries before enabling them. Unknown imported/package credential provenance requires explicit approval.

Stable IDs let an interrupted initial metadata import resume. Capacity and malformed-source failures happen before a completion marker is written. Migration never deletes existing keychain entries, accepted messages, SDK journals or historical file-backed outputs.

## Settings API

The existing authenticated Core surface serves:

- `GET /agent/settings/mcp`: redacted connections, status, Agent choices and migration diagnostics.
- `POST /agent/settings/mcp`: `save`, `remove`, `reconnect`, `sign_in`, `sign_out` or `forget_recall`.
- `GET /agent/settings/mcp/oauth/callback`: browser/state-bound OAuth completion.
- `/agent/addons/api/token-optimizer/config`: instance-wide defaults for token optimisation and task oversight, per-Agent overrides, and scoped maintenance actions.

The Classic Optimisation pane keeps the two modes separate. On first enable, token optimisation starts in **Watch only**. **Basic** makes no extra optimisation model calls; **Model-assisted** exposes the model choice and **Custom** exposes individual features. Both features share model budgets, but permitting model calls while watching and sharing a Plan item are separate choices.

The pane has no Workspace level. Reads project this instance's previously saved Workspace modes into the instance defaults without writing. The next explicit save stores those defaults and removes the old local overrides, preserving effective modes and Agent choices. Maintenance updates the activity view without saving or discarding edits.

Operator configuration requires a single-user administrator context. MCP configuration bodies are bounded to64KiB and five seconds, decode UTF-8 strictly and honour cancellation. Save/remove revisions and execution-time source checks remain authoritative. Responses omit secrets and saved secret-reference values.
