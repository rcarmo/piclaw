# Outbound MCP

Core uses the public `pi-mcp` client through its existing `pi-durable` Harness. MCP calls share the conversation's SDK execution, cancellation, persistence and recovery. Connection setup has a bounded discovery pool; remote tool effects are never retried automatically.

This page covers outbound connections. The inbound CLI/control MCP server is outside this integration. The standalone `pi` CLI is unchanged.

## Add a connection

Open **Settings → MCP**. Use **Server** to choose an existing server, or **Add server** to start a new one. The editor below the picker shows only that server. Enter a name containing letters, digits or underscores, choose Streamable HTTP or POSIX stdio, then set the connection details and timeout. Save the connection and check its discovery status.

- HTTP supports explicit anonymous access, a bearer token reference, or OAuth.
- Stdio takes a JSON array of executable arguments, an absolute working directory and an optional environment object. It runs without a shell or ambient host credentials.
- Stdio still runs on the configured instance with its bound working directory and command credentials.
- New server names must be unique in the instance. Up to 100 servers can be configured.

The adapter exposes tool calls, resource and template listings, and resource reads. The pinned SDK negotiates MCP `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05`. Legacy HTTP+SSE, protocol prompt list/get, sampling, elicitation and resource subscriptions are not exposed. Protocol prompts are distinct from Piclaw’s Code Mode guidance.

Enabled servers are available instance-wide. Older workspace and Agent grants no longer limit enabled servers. Disabled servers stay disabled; credentials and server IDs are unchanged. SDK tool filters and Delegate capability limits still apply. Task-owned children and unrouted SDK forks do not acquire MCP access through their parent.

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

MCP tools and resources are available through Code Mode, not declared inline in model requests. Use `searchTools()` to find tools for the task and `describeTool()` to inspect a specific schema. Discovery and invocation both check the current connection and conversation authority. The old `mcp({tool,args})` proxy and engine-switching controls are retired.

For a server named `knowledge` with a remote `read` tool:

```javascript
const matches = await searchTools("knowledge read", { limit: 5 });
return matches.map(({ name }) => name);
```

Inspect the selected result with `describeTool(name)`, then call `await tools[name](objectArgs)`. Use exactly the discovered name. Earlier aliases that could be rebound are retired; update saved scripts or explicit SDK tool selections by discovering the current name. The new aliases bind the connection, destination, raw tool and operation kind, independent of listing order.

Code Mode receives the original structured value. Keep discovery and filtering in the script when possible, and return only the fields needed for the task. See the [synthetic context benchmark](development/mcp-context-benchmark.md) for the measured difference. Remote descriptions, resources and results are data, not instructions or permission. An eligible model-facing result may be shortened afterwards; scripts never receive a summary in place of the tool value.

To use resources, search for the server’s **List resources and URI templates** and **Read a discovered resource URI** helpers. Inspect their schemas and use the discovered names. For example, call the read helper with `{uri: "memory://catalog"}` when the server advertises that URI.

Tool discovery, resource reads and calls recheck current authority. A cached schema does not grant authority. Setup retries use1/5/15-second delays where appropriate; an unsuccessful or uncertain remote effect is not replayed.

## Recall and retained outputs

Per-connection recall defaults **Off**. **Observe** records eligible retained copies without shortening model output; **Active** can shorten eligible MCP-only script results. Both keep committed source history intact. Errors and uncertain/truncated results remain unchanged.

Recall requires the original owner, visible SDK branch history and a current enabled connection with matching credential identity. Making a server instance-wide does not share its retained copies with other conversations. Retention and item/byte limits apply to the index. Pinning only exempts an item from age expiry.

Code mode can search or page through an original without rerunning it:

```javascript
const matches = await tools.mcp_recall_search({ query: "example" });
const page = await tools.mcp_recall_retrieve({
  id: "mcp_<id from the result>", mode: "full", maxChars: 4000
});
return { matches, page };
```

`mcp_recall_manage` lists/stats, pins or forgets scoped copies. Forgetting a copy leaves original SDK history intact.

Existing non-MCP tool-output copies remain readable through `read_tool_output` and `search_tool_output`, with their original owner, branch and expiry checks. They are never recreated or pruned by the MCP adapter. Historical optimisation and Oversight records remain in the SDK journal; no new optimisation or Oversight work is created.

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

- `GET /agent/settings/mcp`: redacted servers, status and migration diagnostics.
- `POST /agent/settings/mcp`: `save`, `remove`, `reconnect`, `sign_in`, `sign_out` or `forget_recall`.
- `GET /agent/settings/mcp/oauth/callback`: browser/state-bound OAuth completion.
- `/agent/addons/api/token-optimizer/config`: instance-wide token optimisation and task oversight settings, and scoped maintenance actions.

The Classic Optimisation pane keeps the two modes separate. On first enable, token optimisation starts in **Watch only**. **Basic** makes no extra optimisation model calls; **Model-assisted** exposes the model choice and **Custom** exposes individual features. Both features share model budgets, but permitting model calls while watching and sharing a Plan item are separate choices.

Optimisation sits immediately after Models in Classic Settings. Both modes apply to the entire instance. There are no Workspace or Agent settings. Older saved Workspace modes for this instance are carried forward on read; old Agent overrides no longer apply. The next explicit save stores only global settings. Agent activity and scoped maintenance remain available; maintenance does not save or discard settings edits.

Operator configuration requires a single-user administrator context. MCP configuration bodies are bounded to64KiB and five seconds, decode UTF-8 strictly and honour cancellation. Save/remove revisions and execution-time source checks remain authoritative. Responses omit secrets and saved secret-reference values.
