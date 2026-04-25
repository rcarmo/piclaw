# Tools and skills

This document lists the tools and skills exposed to the agent, plus common slash commands.

**Jump to:**
[Agent tools](#agent-tools) ·
[Skills](#skills) ·
[Slash commands](#slash-commands) ·
[Skill pipeline](#skill-pipeline) ·
[Dream / AutoDream](#dream-and-autodream)

## Agent tools

Core tools (from `pi`):

- `read` — read files
- `bash` — run shell commands
- `edit` — replace exact text
- `write` — write files

Piclaw keeps the agent's always-active baseline intentionally small and uses `list_tools` plus `activate_tools` to expand capabilities on demand. The baseline helps preserve prompt context by keeping only frequent, high-value schemas in-band by default.

#### Why this matters for token usage

- **Default-active tools** are sent as full tool schemas in the prompt.
- **On-demand tools** are discoverable via compact metadata and only contribute their full schema once activated.

The practical tradeoff is predictable context spend:

| Tool tier | Typical prompt impact |
| --- | --- |
| Default-active | `~50-200` tokens each |
| On-demand catalog entry | `~10-15` tokens each |

Fixed baseline (always in active defaults):

- `read`
- `edit`
- `write`
- `bash` on Linux/macOS, or `powershell` plus `bun_run` on Windows
- `list_tools`
- `activate_tools`
- `reset_active_tools`
- `attach_file`
- `messages`
- `keychain`
- `exit_process`

At session start, piclaw also auto-promotes additional safe tools to the effective default set:

- available **read-only + lightweight** tools (for example `grep`, `find`, `ls`, `get_model_state`)
- message/scheduling/attachment helpers when present:
  - `messages`, `schedule_task`, `scheduled_tasks`, `read_attachment`, `export_attachment`
- `attach_file` and `keychain` remain part of baseline tooling

This preserves low-latency common inspection workflows while keeping heavier tools opt-in.

Add `tools.additionalDefaultTools` to `.piclaw/config.json` for more persistent defaults:

```json
{
  "tools": {
    "additionalDefaultTools": [
      "search_workspace",
      "introspect_sql"
    ]
  }
}
```

A comma-separated string is also accepted, and env var `PICLAW_ADDITIONAL_DEFAULT_TOOLS` is equivalent.

`reset_active_tools` restores this configured default set (not just the fixed baseline). Unknown tool names are ignored. New activations are session-scoped and reset on restart/session rotation.

### Preferred staged internal-tool flow

For internal-tool discovery, prefer this order:

1. **Recommend / narrow** — call `list_tools` with `intent` when you know the goal but not the tool name, or use `query` when you already know the rough capability area.
2. **Read compact summaries** — use the default summary/recommendation output first instead of requesting full schemas for everything.
3. **Request detail only when needed** — use `include_parameters=true` only for the specific shortlisted tool you are about to use or inspect more deeply.
4. **Activate / use** — call `activate_tools` only for the tool(s) you actually need beyond the effective default set.

That keeps discovery separate from activation and avoids bulky “dump every tool schema first” behavior.

`list_tools(intent=...)` scores explicit tool metadata first (`name`, `description`, `promptSnippet`, toolsets, and capability profiles). `list_internal_tools` remains as a deprecated compatibility alias during migration. When a tool also exposes structured discovery docs/JDocs (for example aliases, domains, verbs, nouns, keywords, guidance, or examples), those are treated as supplemental low-weight hints rather than overrides.

### ToolJDoc: supplemental discovery metadata

Use `ToolJDoc` when a tool needs richer discovery hints than `name`, `description`, and `promptSnippet` alone can provide. This is discovery metadata, not a replacement for the tool's real runtime contract.

#### Design rules

- Primary metadata still wins: `name`, `description`, and `promptSnippet` should stand on their own.
- `ToolJDoc` only supplements discovery; it should not override the tool's actual purpose.
- Prefer short, literal phrases that humans would really type.
- Keep examples compact and task-shaped.
- Put safety or workflow notes under `guidance`, not in `keywords`.

#### Canonical shape

```ts
export interface ToolJDoc {
  /** Optional one-line discovery summary. */
  summary?: string;
  /** Alternate names humans may search for. */
  aliases?: string[];
  /** Higher-level capability areas. */
  domains?: string[];
  /** Action phrases for intent matching. */
  verbs?: string[];
  /** Target objects/entities for intent matching. */
  nouns?: string[];
  /** Supplemental search terms that do not fit cleanly elsewhere. */
  keywords?: string[];
  /** Usage notes and safety guidance; low-weight for discovery. */
  guidance?: string[];
  /** Example intents, prompts, or short task phrases. */
  examples?: Array<string | {
    text?: string;
    description?: string;
    summary?: string;
    title?: string;
    name?: string;
    input?: string;
    prompt?: string;
    intent?: string;
    query?: string;
  }>;
}
```

#### Example table

| Tool | Primary metadata | ToolJDoc hints | Example intent |
|---|---|---|---|
| `messages` | `Search, retrieve, add, or delete messages.` | `domains: ["messages", "chat", "timeline"]`<br>`verbs: ["inspect", "search", "review"]`<br>`nouns: ["messages", "history", "recent"]` | `inspect recent messages` |
| `search_workspace` | `Search indexed workspace content.` | `aliases: ["note search"]`<br>`keywords: ["notes", "skills", "docs"]`<br>`examples: ["find notes about azure"]` | `find notes about azure` |
| `office_read` | `Read a Microsoft Office document...` | `aliases: ["read spreadsheet", "read docx"]`<br>`nouns: ["docx", "xlsx", "pptx", "spreadsheet"]` | `read this spreadsheet` |

#### Example: simple helper tool

```ts
pi.registerTool({
  name: "repo_validate",
  description: "Workspace helper.",
  promptSnippet: "General helper.",
  jdoc: {
    summary: "Packaged repo validation helper.",
    aliases: ["repo audit"],
    domains: ["repo", "workspace", "validation"],
    verbs: ["check", "validate", "audit"],
    nouns: ["repo", "dist", "imports"],
    keywords: ["repo hygiene", "stale dist", "import boundaries"],
    examples: [
      { description: "check stale dist files in the repo" },
    ],
    guidance: [
      "Use for packaged repo/runtime validation helpers.",
    ],
  },
});
```

#### Example: communication tool

```ts
pi.registerTool({
  name: "m365_teams_messages",
  description: "Read messages from a Teams chat thread.",
  promptSnippet: "Read Teams chat messages and inspect recent conversation history",
  jdoc: {
    aliases: ["teams chat read"],
    domains: ["m365", "teams"],
    verbs: ["read", "inspect"],
    nouns: ["teams", "chat", "thread", "messages"],
    examples: ["inspect recent Teams messages"],
  },
});
```

#### Example: desktop UI tool

```ts
pi.registerTool({
  name: "win_click",
  description: "Click at screen coordinates, or find a UI element by name in a window and click its center.",
  promptSnippet: "Click a Windows desktop UI element by name or at explicit screen coordinates.",
  jdoc: {
    aliases: ["desktop click"],
    domains: ["windows", "desktop", "ui"],
    verbs: ["click", "press", "select"],
    nouns: ["button", "tab", "element", "window"],
    examples: ["click the Close button in Edge"],
  },
});
```

The same vocabulary is intentionally suitable for script discovery too. For scripts, use the parallel `ScriptJDoc` shape with the same fields plus script-specific hints such as `kind`, `weight`, and `role` (`entrypoint` vs `module`). Keep the semantics consistent so tools and scripts can share one recommendation model.

Example:

```text
1. list_tools(intent="inspect recent messages")
2. inspect the compact recommendations
3. list_tools(query="messages", include_parameters=true)
4. if needed beyond the effective default set, activate_tools(names=["messages"])
5. use the tool
```

You can extend that baseline with `.piclaw/config.json`:

```json
{
  "tools": {
    "additionalDefaultTools": ["search_workspace"]
  }
}
```

`piclaw` extensions:

- `attach_file` — attach a workspace file for download in the web UI (cards appear automatically; use `attachment:<filename>` only for inline embeds)
- `messages` — unified message/timeline CRUD and inspection tool with `action`:
  - `search` (FTS + hashtag + optional time, sender, role, and row filters)
  - `get` (lookup by `row_ids` with context, line slicing, and optional content grep)
  - `grep` (substring or regex matching within message content, with bounded context lines)
  - `extract` (capture repeated structured values from message content, optionally deduped/sorted)
  - `diff` (checkpoint-style summary of message activity after a row boundary)
  - `add` (insert a row, optionally attaching media)
  - `post` (store + broadcast a message with structured `content_blocks` such as Adaptive Cards)
  - `delete` (thread-cascade delete, optional `dry_run`, optional `force`)
- `search_workspace` — full‑text search across configured workspace FTS roots (notes + skills by default, with aggressive cleanup and size limits)
- `refresh_workspace_index` — rebuild workspace FTS indexing for the configured roots (the same index state surfaced in the workspace explorer status chip)
- `get_model_state` — show current model, thinking level, and context usage
- `list_models` — list available models/providers
- `switch_model` — switch to a different model
- `switch_thinking` — change thinking level (off → xhigh)
- `keychain` — list, get, set, and delete encrypted keychain entries
- `env` — get, set, or clear persistent workspace-scoped environment variables (managed block in `/workspace/.env.sh`, with immediate `process.env` updates for later tool calls; `set` also accepts `$NAME`/`${NAME}` copies)
- `schedule_task` — schedule agent prompts or shell commands (cron, interval, or one-shot)
- `scheduled_tasks` — inspect scheduled-task records via a shared query surface (`list` / `get`, optional latest-run summaries)
- `introspect_sql` — run read-only SQL queries against the messages database
- `list_tools` — list available tools with compact summaries, active-state markers, toolset membership, capability metadata, and intent-based recommendations via `intent` (`list_internal_tools` remains as a deprecated compatibility alias during migration)
- `list_scripts` — discover packaged skill scripts plus workspace skill/note scripts with compact summaries, role markers (`entrypoint` vs `module`), Bun invocation hints, and the same kind of query/intent shortlisting used for tool discovery
- `activate_tools` — activate one or more available tools for the current session
- `reset_active_tools` — restore the configured default active-tool set for the current session
- `open_office_viewer` — open an Office document (`.docx`, `.xlsx`, `.pptx`, `.odt`, `.ods`, `.odp`) in the built-in JS Office viewer (`/office-viewer/*`)
- `send_adaptive_card` — post an agent-owned Adaptive Card message in the web UI timeline
- `send_dashboard_widget` — post an interactive widget with agent-authored HTML to the web timeline (opens in floating pane with piclawWidget bridge; vendored libs: Babylon.js, ECharts, D3). See [vendored-widget-libraries.md](vendored-widget-libraries.md) for API reference.

  ![ECharts treemap widget example](echarts-treemap-widget.png)
- `open_workspace_file` — ask the active web UI to open a workspace file in an editor tab or popout window; popout requests are blocked on small viewports so the agent does not force unusable layouts
- `image_process` — comprehensive workspace image manipulation via sharp, including resize/crop/convert/optimise, colour and geometry transforms, text/SVG/composite operations, metadata/info inspection, frame extraction, and spritesheet-to-GIF assembly
- `exec_batch` — run multiple shell commands and return concise summaries for each
- `powershell` — Windows-only replacement for the default shell tool; active instead of `bash` on Windows hosts
- `bun_run` — run a workspace Bun script directly; kept in the default active baseline on Windows so there is still a first-party script runner alongside PowerShell
- `exit_process` — gracefully terminate piclaw so Supervisor restarts it; kept always active because lifecycle control should not depend on same-turn lazy activation
- `ssh` — get, set, or clear the session-scoped SSH profile used by remote-backed core tools (`read`, `write`, `edit`, `bash`)
- `mcp` — token-efficient proxy for external MCP servers via the bundled `pi-mcp-adapter`; supports search, describe, connect, tool calls, and MCP UI message retrieval using shared `.mcp.json` plus optional Pi-owned override config

> **Note:** `proxmox` and `portainer` tools have been moved to the [piclaw-addons](https://github.com/rcarmo/piclaw-addons) repository. When the addons package is installed, these tools are registered automatically. They use the same session-scoped profile + `discover` → `capabilities` → `workflow` pattern as `ssh`.

`messages` `search` accepts `query`, `chat_jid` (or `*`/`all`), `role`, `sender`, `after`, `before`, `since`, `after_row`, `before_row`, `limit`, `offset`, `excerpt_chars`, and `details_max_chars` for controlling detail payloads.
`messages` `get` accepts `row_ids`, optional `chat_jid`, `role`, `context_before`, `context_after`, `details_max_chars`, `content_lines`, and `content_grep`.
`messages` `grep` accepts `pattern`, optional `chat_jid`, `role`, `sender`, `after`, `before`, `after_row`, `before_row`, `regex`, `context_lines`, `max_matches`, and `details_max_chars`.
`messages` `extract` accepts `pattern`, optional `chat_jid`, `role`, `sender`, `after`, `before`, `after_row`, `before_row`, `regex`, `capture_group`, `dedupe`, `sort`, and `max_matches`.
`messages` `diff` accepts row/time/chat filters and returns a bounded summary of activity after the chosen checkpoint.
`messages` `add` accepts `content`, optional `chat_jid`, `type` (`user` or `agent`), and `media_ids`.
`messages` `post` accepts `content`, optional `chat_jid`, `type`, and structured `content_blocks` for direct timeline/web posting.
`messages` `delete` accepts `row_ids` and optional `chat_jid`, `force`, and `dry_run`.

Infrastructure tools follow one shared pattern:
- session-scoped profile actions: `get` / `set` / `clear`
- low-context discovery: `discover`
- compact introspection: `capabilities` / `workflow_help`
- intent routing: `recommend`
- raw escape hatch: `request`
- curated orchestration: `workflow`

That shared shape improves tool discoverability and keeps prompt usage down: the agent can ask what exists, narrow by family or intent, inspect just one workflow, and only then expand into concrete execution parameters.

`ssh` uses the profile half of that model for remote-backed core tools. The `proxmox` and `portainer` addon extensions (in [piclaw-addons](https://github.com/rcarmo/piclaw-addons)) implement the full pattern.

`ssh` accepts:
- `action` — `get`, `set`, or `clear`
- `chat_jid` — optional override; defaults to the current chat
- `ssh_target` — `user@host` or `user@host:/remote/path`
- `ssh_port` — optional port (default `22`)
- `private_key_keychain` — keychain entry containing the private key
- `known_hosts_keychain` — optional keychain entry containing `known_hosts`; empty string clears it
- `strict_host_key_checking` — `yes`, `accept-new`, or `no`

When a live session already exists, `ssh set` and `ssh clear` apply immediately to subsequent tool/model steps in the same turn.

> The `proxmox` and `portainer` tool documentation below describes the addon-provided tools from [piclaw-addons](https://github.com/rcarmo/piclaw-addons). These tools are only available when the addons package is installed.

`proxmox` accepts:
- `action` — `get`, `set`, `clear`, `discover`, `capabilities`, `workflow_help`, `recommend`, `request`, or `workflow`
- `chat_jid` — optional override; defaults to the current chat
- `base_url` — Proxmox API base URL (typically `https://host:8006/api2/json`); if omitted on `set`, the tool will try to discover a likely existing instance from env/keychain hints
- `api_token_keychain` — keychain entry containing the Proxmox API token credentials; if omitted on `set`, the tool will try to discover a likely default token entry
- `allow_insecure_tls` — allow self-signed/insecure TLS for requests (default `true`)
- `method` — HTTP method for `action=request` (`GET`, `POST`, `PUT`, `DELETE`)
- `path` — relative Proxmox API path for `action=request`
- `query` — optional query-string parameters for `action=request`
- `body` — optional request body for `action=request`
- `body_mode` — `form` or `json` body encoding for `action=request`
- `workflow` — named workflow for `action=workflow` or `action=workflow_help`
- `category` — optional workflow family filter for `action=capabilities` or `action=recommend`
- `include_workflows` — include detailed workflow entries for `action=capabilities`; defaults to `false` unless `category` is set
- `include_examples` — include generated example payloads for `action=workflow_help`
- `intent` — short goal description for `action=recommend`
- `max_recommendations` — max items for `action=recommend` (default `3`)
- `vmid` — VMID for VM/LXC workflows and provisioning flows
- `node` — optional explicit node for VM/LXC/task/storage workflows; required for create/download flows
- `storage` — storage name for storage/backup workflows and `metrics.storage`
- `upid` — UPID for task workflows
- `backup_volid` — backup volid/archive identifier for `backup.restore`
- `storage_type` — storage backend type for `storage.create` (for example `dir`, `nfs`, `lvmthin`, `zfspool`)
- `timeout_ms` / `poll_ms` — polling controls for workflow execution
- `force` — stop-force option for workflows like `vm.stop` or `lxc.stop`
- `target` — desired `{ status, qmpstatus }` for `vm.wait_state`
- `timeframe` — metrics timeframe such as `hour`, `day`, or `week`
- `cf` — metrics consolidation function such as `AVERAGE` or `MAX`
- `metric` / `metrics` — retain only the requested metric keys from metrics workflow results
- `snapshot_name` — snapshot name for `vm.snapshot.*`
- `description` — optional description for snapshot/clone workflows
- `name` / `hostname` — friendly guest names for `vm.create` / `lxc.create`
- `memory` / `cores` / `sockets` — common create-workflow sizing fields
- `ostype` / `net0` — common create-workflow convenience fields
- `ostemplate` / `rootfs` / `password` / `ssh_public_keys` / `unprivileged` — common `lxc.create` inputs
- `config` — advanced extra Proxmox form fields for create/storage workflows (for example `scsi0`, `path`, `content`, `features`)
- `newid` / `new_name` — target VMID/name for `vm.clone`
- `target_node` / `target_storage` — target placement hints for `vm.clone` and `vm.migrate`
- `full` — full-clone option for `vm.clone`
- `online` / `with_local_disks` — migration options for `vm.migrate`
- `mode` / `compress` — backup options for `backup.create`
- `slot` / `iso_volume` — VM cdrom slot and existing ISO volid for `vm.iso.attach` / `vm.iso.detach`
- `disk` / `size` — disk identifier and target size for disk workflows such as `vm.disk.resize`
- `download_url` / `filename` / `content` — inputs for `storage.download_url`
- `checksum` / `checksum_algorithm` / `compression` / `verify_certificates` — optional integrity and transfer controls for `storage.download_url`
- `command` / `command_args` / `input_data` / `shell_family` — guest-agent exec inputs for `vm.agent.exec` (`shell_family=posix` for Linux/Unix guests, `shell_family=powershell` for Windows guests)
- `limit` — result limit for list-style workflows like `task.list`
- `lines` — line count for `node.log`

Supported workflows today:
- `cluster.status`
- `vm.resolve_node`
- `vm.status`
- `vm.inspect`
- `vm.create`
- `vm.start`
- `vm.stop`
- `vm.resume`
- `vm.restart`
- `vm.ip`
- `vm.migrate`
- `vm.iso.attach`
- `vm.iso.detach`
- `vm.disk.resize`
- `vm.disk.detach`
- `vm.disk.remove`
- `lxc.resolve_node`
- `lxc.status`
- `lxc.inspect`
- `lxc.create`
- `lxc.start`
- `lxc.stop`
- `lxc.restart`
- `lxc.ip`
- `node.list`
- `node.inspect`
- `node.log`
- `node.reboot`
- `node.shutdown`
- `storage.list`
- `storage.inspect`
- `storage.content.list`
- `storage.create`
- `storage.download_url`
- `backup.list`
- `backup.create`
- `backup.restore`
- `task.list`
- `task.status`
- `task.log`
- `task.wait`
- `vm.wait_state`
- `vm.snapshot.list`
- `vm.snapshot.create`
- `vm.snapshot.rollback`
- `vm.snapshot.delete`
- `vm.clone`
- `vm.template.create`
- `vm.agent.exec`
- `vm.agent.osinfo`
- `vm.agent.fsinfo`
- `vm.agent.users`
- `metrics.node`
- `metrics.vm`
- `metrics.storage`

The `proxmox` tool deliberately keeps both a raw `request` path and a higher-level `workflow` path. `action=capabilities` is compact by default: it returns workflow-family summaries unless you set `category` and/or `include_workflows`. `action=recommend` gives a short intent-based workflow shortlist. `action=workflow_help` returns required/optional fields plus `recommended_for`, `see_also`, and `guidance`; set `include_examples=true` only when you want generated example payloads. This makes the tool both discoverable and context-efficient. A good default operator flow is: `discover` (optional) → `capabilities` or `recommend` → `workflow_help` → `workflow`, falling back to raw `request` only when the native workflow surface is too specialized or not yet modeled.

`portainer` accepts:
- `action` — `get`, `set`, `clear`, `discover`, `capabilities`, `workflow_help`, `recommend`, `request`, or `workflow`
- `chat_jid` — optional override; defaults to the current chat
- `base_url` — Portainer base URL (typically `https://host:9443`); if omitted on `set`, the tool will try to discover a likely existing instance from keychain/env hints
- `api_token_keychain` — keychain entry containing the Portainer API token secret; if omitted on `set`, the tool will try to discover a likely default token entry
- `allow_insecure_tls` — allow self-signed/insecure TLS for requests (default `true`)
- `method` — HTTP method for `action=request` (`GET`, `POST`, `PUT`, `DELETE`)
- `path` — relative Portainer API path for `action=request`
- `query` — optional query-string parameters for `action=request`
- `body` — optional request body for `action=request`
- `body_mode` — `json` or `text` body encoding for `action=request`
- `headers` — optional extra request headers for `action=request`
- `workflow` — named workflow for `action=workflow` or `action=workflow_help`
- `category` — optional workflow family filter for `action=capabilities` or `action=recommend`
- `include_workflows` — include detailed workflow entries for `action=capabilities`; defaults to `false` unless `category` is set
- `include_examples` — include generated example payloads for `action=workflow_help`
- `intent` — short goal description for `action=recommend`
- `max_recommendations` — max items for `action=recommend` (default `3`)
- `endpoint_id` — endpoint ID for endpoint/stack/container/network workflows
- `stack_id` — stack ID for stack workflows
- `container_id` — container ID/prefix for container workflows
- `network_id` — network ID/prefix for network workflows
- `name` — generic lookup name for endpoint/container/network workflows, or a fallback image/volume name where applicable
- `image` — image reference for image workflows
- `volume_name` — volume name for `volume.inspect`
- `stack_name` — stack name for stack workflows
- `stack_file_content` — compose content for stack create/update workflows
- `unmanaged` — only keep unmanaged containers for `container.list`
- `force` — force deletion for `container.delete`, `container.upgrade` cleanup, or `image.delete`
- `all_unused` — prune all unused images for `image.prune`, not just dangling ones
- `tail` — tail line count for `container.logs`
- `timestamps` — include timestamps for `container.logs`
- `timeout_sec` — stop/restart timeout seconds for container workflows including `container.upgrade`
- `command` / `command_args` / `shell_family` — bounded exec inputs for `container.exec` (`shell_family=posix` for Linux/Unix containers, `shell_family=powershell` for Windows containers)
- `driver` / `internal` / `attachable` / `enable_ipv6` / `labels` / `options` — network/volume creation inputs
- `names` — container names for bulk workflows like `container.upgrade_many`

Portainer follows the same discovery pattern as Proxmox: `discover` (optional) → `capabilities` or `recommend` → `workflow_help` → `workflow`, with raw `request` reserved for API areas that are still too broad or niche to model directly. The result is the same balance: high discoverability without forcing full workflow enumeration into every turn.

Supported Portainer workflows today:
- `endpoint.list`
- `endpoint.resolve`
- `endpoint.inspect`
- `endpoint.ping`
- `endpoint.docker_info`
- `endpoint.docker_version`
- `endpoint.system_df`
- `stack.list`
- `stack.resolve`
- `stack.file`
- `stack.create_standalone`
- `stack.update`
- `stack.pull_and_update`
- `stack.delete`
- `container.list`
- `container.resolve`
- `container.inspect`
- `container.compose`
- `container.start`
- `container.stop`
- `container.restart`
- `container.logs`
- `container.mounts`
- `container.exec`
- `container.upgrade`
- `container.upgrade_many`
- `container.delete`
- `image.list`
- `image.inspect`
- `image.pull`
- `image.delete`
- `image.prune`
- `image.update_check`
- `network.list`
- `network.inspect`
- `network.create`
- `network.delete`
- `volume.list`
- `volume.inspect`
- `volume.create`
- `volume.delete`
- `volume.prune`

The `portainer` tool follows the same contract as `proxmox`: chat-scoped profile actions, a raw `request` path for ad-hoc API calls, and a named `workflow` path for common operational flows. `action=capabilities` is compact by default: it returns workflow-family summaries unless you set `category` and/or `include_workflows`. `action=recommend` gives a short intent-based workflow shortlist. `action=workflow_help` returns required/optional fields plus `recommended_for`, `see_also`, and `guidance`; set `include_examples=true` only when you want generated example payloads. For standalone containers, `container.upgrade` now bakes in the expected base flow: pull the target image, recreate in place, and roll back if the replacement fails to start.

`search_workspace` accepts:
- `query` — FTS query text
- `scope` — `notes`, `skills`, or `all` (default)
- `limit`, `offset`
- `refresh` — re-index notes/skills before searching (default `true`)
- `max_kb` — max file size to index (default 512KB, clamped 16–2048KB)

The workspace index is **aggressively cleaned** on each refresh:
- deleted files are removed from the index
- oversized files are dropped immediately

## Skills

Skills live under:

- Project scope: `/workspace/.pi/skills`
- Global scope: `/home/agent/.pi/agent/skills`

Each skill keeps its script alongside its `SKILL.md` for portability. Current set:

| Skill | Purpose |
|------|---------|
| `debug` | Diagnose container issues and environment setup |
| `setup` | Scaffold a new project with Bun + Makefile |
| `reload` | Force-restart `piclaw` after code changes (tarball install, not symlinks) |
| `playwright` | Local Playwright browser automation |
| `schedule` | Create/modify scheduled tasks via IPC |
| `send-message` | Send chat messages immediately via IPC (supports optional `media` attachments via `media` array) |
| `token-chart` | Generate token usage charts (from `token_usage`); supports `--mode provider-model` for per-provider/model breakdowns |
| `graphite-power-chart` | Generate Zigbee/Graphite charts for the web timeline |
| `graph-design` | Design, audit, and redraw inline SVG architecture/flow diagrams with source verification and orthogonal rounded-arrow conventions |
| `web-search` | Search the web via SearXNG and convert pages to Markdown |
| `web-search-summary` | Search via SearXNG with auto-summarised results |
| `twitter-summary` | Fetch a user's recent tweets via Playwright + Nitter |
| `feed-digest` | Build a deduped Markdown digest from an RSS/Atom feed index |
| `bootstrap-container` | Validate required tools and install missing dependencies |
| `mcp-adapter` | Configure and use the bundled `pi-mcp-adapter` through shared `.mcp.json` plus optional Pi-owned overrides |
| `extension-design` | Design and audit Pi extensions safely |
| `extension-troubleshoot` | Diagnose and fix extension issues (imports, DB init, watcher perms) |
| `kanban-management` | **ARCHIVED** — legacy file-board workflow kept for history only; direct users to `github-issues` |
| `github-issues` | Manage project work items via GitHub Issues and GitHub Projects v2 (including lane transitions via `gh project item-edit`) |
| `adaptive-cards-authoring` | Author Adaptive Cards for structured web interactions |
| `close-of-day` | End-of-day sweep: situate, backup, timeline cleanup, daily-notes summarisation |
| `export-timeline-pdf` | Export a chat timeline to PDF via Playwright |
| `feature-refinement-flow` | Structured 20-question refinement flow before implementation |
| `visual-design` | Apply the saved visual-design profile (charts, diagrams, Mermaid, layouts, styling defaults) consistently across generated outputs |
| `visual-artifact-generator` | Generate polished self-contained HTML pages, diagrams, data tables, diff reviews, slide decks, and draw.io files using Piclaw vendored libraries. See [visual-artifact-generator.md](visual-artifact-generator.md). |
| `situate-daily-notes` | Situation report and Obsidian-style daily summary notes |
| `timeline-cleanup` | Delete low-value timeline messages by keyword patterns |
| `remote-peer` | Send signed prompts to paired remote piclaw instances (see [cross-instance-ipc.md](cross-instance-ipc.md)) |

> **Addon-provided skills** (from [piclaw-addons](https://github.com/rcarmo/piclaw-addons), available when the addons package is installed):
>
> | Skill | Description |
> |-------|-------------|
> | `proxmox-guest-compare-chart` | Compare two Proxmox guests and render SVG/CSV outputs |
> | `portainer-container-compare-chart` | Compare two Portainer containers and render SVG/CSV outputs |

`kanban-management` is now archived and retains historical references only. Active project operations use GitHub Issues + GitHub Projects.

For agent-driven infrastructure work, use the addon-provided `proxmox` / `portainer` tools from [piclaw-addons](https://github.com/rcarmo/piclaw-addons). These tools and their colocated skills are registered automatically when the addons package is installed.

## Web extension UI note

For web-facing extension work, prefer the following order of surfaces:

1. **Pane extensions** for substantial mounted UI
2. **Adaptive Cards / timeline messages** for structured conversational UI
3. **`extension_ui_*` bridge events** for lightweight browser-session integrations

See [extension-ui-contract.md](extension-ui-contract.md) and [web-pane-extensions.md](web-pane-extensions.md) for the current contract.

## Slash commands

Direct commands (no LLM round-trip):

| Command | Purpose |
|---------|---------|
| `/model [provider/model]` (alias `/models`) | Select model or list available models |
| `/cycle-model [back]` | Cycle to the next available model |
| `/thinking [level]` | Show or set thinking level |
| `/cycle-thinking` | Cycle thinking level |
| `/theme [name]` | Set UI theme (use `/theme list` to see options) |
| `/tint [#hex|name|off]` | Tint the default light/dark UI (e.g. `/tint #3b82f6`, `/tint orange`) |
| `/state` | Show current session state |
| `/stats` | Show session token and cost stats |
| `/context` (alias `/ctx`) | Show context window usage |
| `/last` | Show last assistant response |
| `/compact [instructions]` | Manually compact the session |
| `/auto-compact on\|off` | Toggle auto-compaction |
| `/auto-retry on\|off` | Toggle auto-retry |
| `/abort` | Abort the current response |
| `/abort-retry` | Abort retry backoff |
| `/abort-bash` | Abort running bash command |
| `/shell <cmd>` | Run a shell command and return output |
| `/bash <cmd>` | Run a shell command and add output to context |
| `/queue <msg>` | Queue a follow-up message (one at a time) |
| `/queue-all <msg>` | Queue a follow-up message (batch all) |
| `/steer <msg>` | Send immediate steering input to the current response |
| `/steering-mode all\|one` | Set steering mode |
| `/followup-mode all\|one` | Set follow-up mode |
| `/session-name [name]` | Set or show the session name |
| `/new-session` | Start a new session |
| `/switch-session <file>` | Switch to a session file |
| `/session-rotate` | Rotate the current persisted session into an archived file |
| `/fork` | Fork from a previous message |
| `/forks` | List forkable messages |
| `/tree` | List the session tree and navigate branches |
| `/label` | Set or clear a label on a tree entry |
| `/labels` | List labelled entries |
| `/agent-name [name]` | Set or show the agent display name |
| `/agent-avatar [url]` | Set or show the agent avatar URL |
| `/user-name [name]` | Set or show your display name |
| `/user-avatar [url]` | Set or show your avatar URL |
| `/user-github <url>` | Set your name/avatar from a GitHub profile |
| `/export-html` | Export session to HTML |
| `/passkey [enrol|list|delete]` | Manage passkeys (enrolment link, list, delete) |
| `/totp` / `/totp reset <code>` | Open the single-card TOTP setup/secondary/reset flow; commit only after confirmation |
| `/qr <text>` | Generate a QR code for text or a URL |
| `/search <query>` | Search notes and skills in the workspace |
| `/login [provider]` | Login to an AI model provider (OAuth or API key) |
| `/logout [provider]` | Logout from an AI model provider |
| `/image <prompt> [--size ...] [--count ...] [--quality ...] [--style ...] [--transparent]` | Generate an Azure OpenAI image into workspace-backed files; `--transparent` requests transparent PNG output |
| `/flux <prompt> [--size ...] [--count ...] [--quality ...]` | Generate an Azure Foundry image into workspace-backed files |
| `/restart` | Restart the agent and stop subprocesses |
| `/exit` | Exit the current piclaw process immediately so the service manager restarts it |
| `/commands` | List available commands (shows sourceInfo provenance: scope, source, and origin for extension commands, templates, and skills) |
| `/btw <question>` | Open a side-conversation panel in the web UI and stream an answer without interrupting the main chat |
| `/meters on\|off\|toggle` | Toggle the web UI CPU/RAM HUD |
| `/tasks [filter]` | List scheduled tasks (via extension) |
| `/scheduled [filter]` | Alias for `/tasks` |
| `/dream [days]` | Queue an out-of-band Dream cycle on a temporary `dream:` channel; runtime backs up notes, seeds daily notes from DB, the model follows Orient / Signal / Consolidate / Prune and Index, and runtime refreshes FTS at the end |
| `/mcp [status\|tools\|reconnect [server]\|setup]` | Open the MCP management panel in the web UI (or text status elsewhere), list MCP tools, reconnect bundled `pi-mcp-adapter` servers, or launch guided MCP setup |
| `/mcp-auth <server>` | Show OAuth token-setup guidance for an MCP server managed by `pi-mcp-adapter` |

> [!NOTE]
> Provider auth works via `pi /login` in the terminal or the experimental `/login` card flow in the web UI.
> The card-based `/login` flow supports GitHub Copilot, Codex, and standard OpenAI providers. Anthropic is untested. The terminal remains the reliable fallback.

The bundled `pi-mcp-adapter` now prefers shared MCP config first: `~/.config/mcp/mcp.json` and project-local `.mcp.json`. Pi-owned config still works under `~/.pi/agent/mcp.json` (inside the container image this typically maps to `/config/.pi/agent/mcp.json`) and project-local `.pi/mcp.json`, with `.pi/mcp.json` acting as the final Pi-specific override. Starter examples are seeded at `.mcp.json.example` and `.pi/mcp.json.example`. Use `/mcp setup` for guided onboarding.

`/image` writes generated images back into the workspace and renders them as workspace-backed timeline images plus file-path listings. `/flux` follows the same output pattern, but transparent background requests are currently supported only on `/image`.

`/search` performs a workspace full‑text search (notes + skills) without calling the LLM:

```
/search "graphite power"
/search --scope notes restic
/search --scope skills --no-refresh "search_workspace"
/search --scope notes --limit 20 --offset 20 "token pricing"
```

Supported flags: `--scope notes|skills|all`, `--limit`, `--offset`, `--refresh`, `--no-refresh`, `--max-kb`.

Adaptive Card and side-conversation helpers are intentionally explicit web-facing affordances:
- `send_adaptive_card` is the preferred internal tool for posting agent-owned Adaptive Cards in the web UI without routing through a local slash command.
- card submissions are persisted as structured `adaptive_card_submission` blocks, so the timeline can render compact receipt UI and finished cards can display their submitted values read-only.
- `/btw` is currently a thin consumer of the side-prompt substrate: it streams a side answer in the web panel, reseeds from current main-chat context, and only injects back into the main chat when explicitly requested.
- `/btw` currently reuses the chat's model/thinking context but is still prompt-only rather than a full side tool-using agent loop.
- `/theme`, `/tint`, and `/meters` are web-local UI commands handled without an LLM round-trip.
- `/context` reports current context-window usage; the compose-footer indicator is refreshed on reconnect and when returning to the tab so the compaction affordance stays current.

## Skill pipeline

Skills create tasks via IPC JSON files. Each task can optionally specify a `model` field (e.g. `anthropic/claude-sonnet-4-20250514`) to run on a cheaper or different model than the user's current one. The scheduler handles model switching and restoration automatically.

Tasks are isolated from the user's conversation using the **session tree** — the scheduler saves the tree position before execution and navigates back afterwards. This prevents the task's prompt/response from appearing in the user's conversation context while still preserving it in a side branch for inspection via `/tree`. See [runtime-flows.md](runtime-flows.md) for the full flow.

## Dream and AutoDream

PiClaw has two memory-maintenance modes:

- `Dream` — the manual `/dream [days]` command
- `AutoDream` — the built-in nightly internal task

Both are now **model-driven** and run as out-of-band agent turns on a temporary `dream:` channel.
The temporary dream channel is cleaned up after the cycle ends.

Default windows:
- manual Dream keeps the 7-day default unless you pass `/dream <days>`
- nightly AutoDream defaults to a narrower 2-day window

Dream/AutoDream follow the original 4-phase flow:
- Orient — inspect startup memory and existing daily/memory state first
- Signal — gather only narrow confirming evidence for suspected drift
- Consolidate — merge, normalize dates, and correct contradictions at the source
- Prune and Index — prune stale pointers, add references to newly important memories, shorten overly verbose `MEMORY.md` lines, and let runtime refresh FTS afterward

Search behavior follows Claude-style rough criteria:
- inspect existing daily/memory files first
- inspect memories that drifted
- use narrow `messages.search` queries only for things already suspected to matter
- avoid exhaustive transcript sweeps

AutoDream is gated, but it no longer requires a 24-hour gap.
- if there is no prior consolidation, it runs
- if there have been no sessions since the last consolidation, it skips
- otherwise the nightly run proceeds

Dream keeps the two note layers aligned:
- `notes/daily/` — concise human-readable overview
- `notes/memory/` — agent-facing durable memory and transcript-derived detail

See also: [runtime/docs/dream-memory.md](../runtime/docs/dream-memory.md)

Model names are validated at task creation time — invalid or ambiguous model identifiers are rejected before the task is persisted.

```mermaid
flowchart LR
  Skill[Skill script] --> IPC[IPC file]
  IPC --> Scheduler[Task scheduler]
  Scheduler --> Tree[Save/restore tree position]
  Tree --> Pool[AgentPool]
  Pool --> Channel[Web UI / WhatsApp]
```
