# Development

## Build from source

> Source builds are primarily for development and local testing.

```bash
make build
make up
```

The compose stack passes `PUID` / `PGID` by default (`1000:1000`). To match the container `agent` user/group to your host user:

```bash
PUID=$(id -u) PGID=$(id -g) make up
```

The default compose container name is `pibox`:

```bash
docker exec -u agent -it pibox bash
cd /workspace && pi
```

## Build targets

Run build/package commands from the **repo root**:

```bash
make build-piclaw    # full build: vendor bundle + web assets + TypeScript
make vendor          # rebuild vendored assets
make lint            # ESLint
make test            # full test suite
make ci-fast         # canonical fast CI guardrails + web build
make local-install   # pack and install piclaw globally (no restart)
make restart         # restart piclaw via the detected service manager
```

## Testing

The implementation lives under `runtime/`, so direct Bun test runs should target that subtree. Sequential mode is recommended for SQLite safety:

```bash
cd runtime && bun test --max-concurrency=1
```

## Recent focused integration notes

### MCP adapter

PiClaw now bundles `pi-mcp-adapter` as a normal package dependency and loads it as a packaged session extension from `node_modules/`.

Relevant files when working on MCP integration:

- `package.json` / `bun.lock`
- `runtime/src/agent-pool/session.ts`
- `docs/mcp.md`
- `skel/.mcp.json.example`
- `skel/.pi/mcp.json.example`
- `skel/.pi/skills/mcp-adapter/SKILL.md`

Focused regression test:

```bash
PICLAW_DB_IN_MEMORY=1 bun test runtime/test/agent-pool/mcp-adapter-bundled.test.ts
```

### Azure OpenAI image commands

Recent Azure OpenAI work hardened the shared helper resolution path, improved image-output formatting, and added transparent PNG support to `/image`.

Relevant files:

- `runtime/extensions/integrations/azure-openai.ts`
- `runtime/src/extensions/azure-openai-api.ts`
- `runtime/test/extensions/azure-openai-api.test.ts`
- `runtime/test/extensions/azure-openai-image-output.test.ts`
- `docs/azure/azure-openai-extension.md`

Focused regression tests:

```bash
bun test \
  runtime/test/extensions/azure-openai-api.test.ts \
  runtime/test/extensions/azure-openai-image-output.test.ts
```

Notes:

- `/image --transparent` requests transparent PNG output on the Azure OpenAI image path.
- `/flux` still rejects transparent background requests.
- Successful image runs now format results as workspace-backed inline images plus file listings rather than raw download links.

### Azure OpenAI / Foundry harness

Use the standalone harness when you need provider-level evidence without reloading the running Piclaw process.

Relevant files:

- `runtime/scripts/azure-openai-harness.ts`
- `runtime/extensions/experimental/azure-openai.harness.ts`
- `runtime/extensions/integrations/azure-openai.ts`
- `runtime/src/extensions/azure-openai-api.ts`
- `docs/azure/azure-openai-extension.md`

Typical commands:

```bash
bun run scripts/azure-openai-harness.ts --list
bun run scripts/azure-openai-harness.ts --models gpt-5-3-codex,gpt-5-4 --cases json,tool,history --tool-rounds 2 --history-turns 3
AOAI_EXPERIMENT_AZURE_CLIENT_REQUEST_ID=1 bun run scripts/azure-openai-harness.ts --providers azure-openai --models gpt-5-3-codex --cases json,tool,history --tool-rounds 2 --history-turns 3
```

Notes:

- the harness bundles to `/workspace/piclaw/.tmp/azure-openai.harness.bundle.mjs` so Bun resolves this repo's dependencies correctly
- the live Azure extension now aligns `prompt_cache_key`, `session_id`, and `x-client-request-id` from the active session id on the Azure Responses path
- the harness now checks those correlation fields automatically and fails if they drift
- the harness also fails if replayed request payloads still contain leaked `partialJson` scratch buffers
- the `0.67.2` package set and focused Azure `json` / `tool` / `history` runs were validated locally on `gpt-5-3-codex` and `gpt-5-4`
- `AOAI_EXPERIMENT_AZURE_CLIENT_REQUEST_ID=1` remains available for the optional `x-ms-client-request-id` experiment

### Workspace search / reindex UI

Recent workspace explorer changes added an index-status surface and manual reindex control on top of the existing FTS search/indexing pipeline.

Relevant files:

- `runtime/src/workspace-search.ts`
- `runtime/src/extensions/workspace-search.ts`
- `runtime/src/channels/web/handlers/workspace.ts`
- `runtime/src/channels/web/workspace/service.ts`
- `runtime/web/src/components/workspace-explorer.ts`

Focused regression tests:

```bash
PICLAW_DB_IN_MEMORY=1 bun test \
  runtime/test/channels/web/http-dispatch-workspace.test.ts \
  runtime/test/channels/web/http-route-classification.test.ts \
  runtime/test/channels/web/workspace-service.test.ts \
  runtime/test/workspace-search.test.ts
```

### OOBE local container + Playwright smoke

A realistic OOBE browser pass can be run against a local Docker container rather
than only against the in-process dedicated web test instance.

Default command:

```bash
bun run test:oobe:local-container
```

What it does:

- ensures Playwright Chromium is available
- builds a local image (`piclaw-oobe-test:local`) unless skipped
- mounts the repo's current `runtime/web/static/dist` into the container so web-bundle changes can be validated against the latest local build without requiring a fresh image for every UI-only tweak
- starts a temporary local Piclaw container on a random localhost port
- runs Playwright against the live web UI
- writes screenshots, DOM dumps, state captures, and container logs under `artifacts/oobe-local-container/`
- validates:
  - provider-missing OOBE panel copy
  - `/login` compose prefill
  - dismiss persistence after reload
  - provider-ready OOBE state
  - `/model` compose prefill
  - ready-state completion persistence after reload

Useful flags/env:

```bash
# Skip the image rebuild when only the web bundle changed locally.
# Rebuild the local web assets first so the mounted dist is current.
cd runtime && bun run build:web && cd ..
PICLAW_OOBE_TEST_SKIP_BUILD=1 bun run test:oobe:local-container
PICLAW_OOBE_TEST_IMAGE=pibox:latest bun run test:oobe:local-container
PICLAW_OOBE_TEST_HEADLESS=0 bun run test:oobe:local-container
```

Implementation surface:

- `runtime/scripts/playwright/oobe-local-container.ts`

Notes:

- The generated `artifacts/oobe-local-container/` files are local smoke-test artefacts, not release payloads.
- Clean them up before tagging if you do not intend to keep the latest repro bundle around.

### Editor file conflict detection

The editor pane now monitors for external file changes via `GET /workspace/stat?path=<file>` (polled every 5s while the tab is focused) and shows a conflict resolution bar when the on-disk mtime advances past the last known mtime. The same `FileConflictMonitor` is shared by the editor, mindmap pane, and kanban pane.

Relevant files:
- `runtime/extensions/viewers/editor/editor-extension.ts`
- `runtime/web/src/panes/file-conflict-monitor.ts`
- `runtime/test/web/file-conflict-monitor.test.ts`

### Recovery and resilience

Blank-turn detection, compaction stall bounding, the recovery chip, and the held-failed-run retry/skip model are documented in [architecture.md](architecture.md) under "Per-chat turn lifecycle and failure model", "Recovery chip", "Blank turn detection", and "Compaction stall guard".

Relevant files:
- `runtime/src/agent-pool/blank-turn-detection.ts`
- `runtime/src/agent-pool/prompt-utils.ts` — `waitForSessionIdle`, session idle defaults
- `runtime/src/agent-pool/automatic-recovery.ts` — auto-recovery classification / retry policy
- `runtime/src/channels/web/handlers/agent.ts` — web turn finalization, held-failure behavior, retry/skip resolution points
- `runtime/src/channels/web/runtime/chat-run-control.ts` — explicit retry/skip cursor helpers
- `runtime/src/db/chat-cursors.ts` — `beginChatRun`, inflight rollback, failed-run storage, rollback-with-error
- `runtime/src/extensions/smart-compaction.ts` — working-indicator UI hooks

Focused regression tests:

```bash
bun test \
  runtime/test/db/chat-cursors.test.ts \
  runtime/test/channels/web/runtime/chat-run-control.test.ts \
  runtime/test/channels/web/recovery.test.ts \
  runtime/test/channels/web/web-channel-recovery-state.test.ts \
  runtime/test/channels/web/web-channel.test.ts
```

## Layout

See [architecture.md](architecture.md) for the full source layout and module boundaries.

## Skill and extension development

New skills go in `.pi/skills/<name>/SKILL.md` (workspace-local) or
`skel/.pi/skills/<name>/` (shipped with the skel for new installs).

New internal tools register through the extension API:

```ts
pi.registerTool({ name, description, parameters, execute });
```

For visual artifacts, always load and follow:

- `/workspace/.pi/skills/visual-artifact-generator/SKILL.md`
- `/workspace/.pi/skills/visual-design/SKILL.md`

Use the `mermaid-fixup.js` helper for any artifact that renders Mermaid diagrams.

## Adding new HTTP endpoints

New `GET /agent/*` or `POST /agent/*` endpoints follow this chain:

1. `runtime/src/channels/web/http/dispatch-agent.ts` — register the route
2. `runtime/src/channels/web/endpoints/channel-endpoint-facade-service.ts` — add handler method
3. `runtime/src/channels/web/core/web-channel-http-surface-service.ts` — delegate from surface
4. `runtime/src/channels/web/core/web-channel-contracts.ts` — declare the interface
5. `runtime/src/channels/web/core/web-channel-prototype.ts` — bind the prototype method

See `runtime/src/channels/web/agent/agent-commands.ts` (`GET /agent/commands`)
as the canonical simple example.

## Documentation updates

When shipping new features, update:

- `docs/tools-and-skills.md` — if new tools, skills, or slash commands are added
- `docs/architecture.md` — if new endpoints or subsystems are added
- `docs/configuration.md` — if new environment variables or config keys are added
- `README.md` — if the feature merits a bullet in the Why/Feature overview
- `docs/vendored-widget-libraries.md` — if new vendored libraries or fonts are added
