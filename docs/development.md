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

## Layout

See [architecture.md](architecture.md) for the full source layout and module boundaries.
