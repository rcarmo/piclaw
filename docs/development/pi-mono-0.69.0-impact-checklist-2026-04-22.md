# Pi upstream 0.69.0 impact checklist for Piclaw

Date: 2026-04-22

Scope audited:
- `@mariozechner/pi-coding-agent` `0.68.1 -> 0.69.0`
- related upstream package deltas in `packages/ai` and `packages/tui`
- current Piclaw codebase usage and likely impact areas

Upstream references:
- release: `badlogic/pi-mono` `v0.69.0`
- coding-agent gitHead: `85a9ce30241adf7ef62e7f4ad8bbfe2580a387e0`
- previous coding-agent gitHead: `a2c183db0fb1718eff6b6c1c67ffd0c1997b1196`

## Test status during audit

Full Piclaw test suite run:
- command: `bun run test`
- result: pass
- controlled report: `runtime/generated/controlled-test-report.json`
- report summary:
  - total files: `484`
  - stages completed: `20`
  - exit code: `0`
  - elapsed: `83136 ms`
  - peak process-tree RSS: `522512 KB`
  - peak cgroup memory: `687009792 bytes`

## Upstream delta summary

Notable upstream changes in `0.69.0`:
- TypeBox 1.x migration in coding-agent/ai
- terminating tool results (`terminate: true`)
- stacked autocomplete providers
- OSC `9;4` progress indicators in TUI/coding-agent
- replacement-session callbacks / stale-session invalidation (`withSession`)
- fixed chained `before_agent_start` system prompt behavior
- fixed headers-only model overrides
- fixed trailing orphaned tool-result synthesis
- fixed exported session HTML markdown-link sanitization
- added Gemini 3.1 Flash Lite Cloud Code Assist model

Approximate upstream file churn in the audited delta:
- `packages/coding-agent/`: 71 files
- `packages/ai/`: 28 files
- `packages/tui/`: 7 files
- `packages/agent-core/`: no direct compare-file hits in this delta

## Piclaw impact checklist

### 1) TypeBox 1.x migration

Risk: **high**
Status: **not yet adopted in Piclaw**

Piclaw still imports `@sinclair/typebox` in multiple runtime surfaces:
- `runtime/src/tools/context-tools.ts`
- `runtime/src/extensions/bun-runner.ts`
- `runtime/src/extensions/portainer.ts`
- `runtime/src/extensions/model-control.ts`
- `runtime/src/extensions/tool-activation.ts`
- `runtime/src/extensions/image-processing.ts`
- `runtime/src/extensions/sql-introspect.ts`
- `runtime/src/extensions/open-workspace-file.ts`
- `runtime/src/extensions/ssh.ts`
- `runtime/src/extensions/runtime-scripts.ts`
- `runtime/src/extensions/messages-crud.ts`
- `runtime/src/extensions/autoresearch-supervisor.ts`
- `runtime/src/extensions/env-tools.ts`
- `runtime/src/extensions/scheduled-tasks.ts`
- `runtime/src/extensions/keychain-tools.ts`
- `runtime/src/extensions/send-dashboard-widget.ts`
- `runtime/src/extensions/workspace-search.ts`
- `runtime/src/extensions/send-adaptive-card.ts`
- `runtime/src/extensions/exit-process.ts`
- `runtime/src/extensions/file-attachments.ts`
- `runtime/src/extensions/proxmox.ts`
- `runtime/src/extensions/internal-tools.ts`
- `runtime/extensions/browser/cdp-browser/index.ts`
- `runtime/extensions/platform/windows/win-ui/index.ts`
- `runtime/extensions/integrations/office-tools/index.ts`
- `runtime/extensions/experimental/m365/index.ts`
- `runtime/vendor/autoresearch/extensions/pi-autoresearch/index.ts`

Related package-local pins still present:
- `runtime/extensions/experimental/m365/package.json`
- `runtime/extensions/experimental/m365/bun.lock`

Checklist:
- [ ] Decide whether to stay temporarily on the legacy alias path or migrate Piclaw to `typebox` 1.x imports explicitly.
- [ ] Verify no Piclaw code depends on `@sinclair/typebox/compiler` shims.
- [ ] Re-test all tool-schema coercion paths after any migration, especially stringified JSON tool arguments.
- [ ] Re-test bundled/runtime extensions plus vendored extensions (`autoresearch`, `m365`, `cdp-browser`, `win-ui`).
- [ ] Re-test direct repo install after any TypeBox migration because packaged extensions resolve through the runtime `node_modules` symlink path.

### 2) `before_agent_start` chaining fix

Risk: **medium-positive**
Status: **likely beneficial to Piclaw**

Piclaw has many `before_agent_start` prompt-mutating hooks:
- `runtime/src/extensions/bun-runner.ts`
- `runtime/src/extensions/portainer.ts`
- `runtime/src/extensions/model-control.ts`
- `runtime/src/extensions/tool-activation.ts`
- `runtime/src/extensions/ssh-core.ts`
- `runtime/src/extensions/image-processing.ts`
- `runtime/src/extensions/sql-introspect.ts`
- `runtime/src/extensions/open-workspace-file.ts`
- `runtime/src/extensions/ssh.ts`
- `runtime/src/extensions/runtime-scripts.ts`
- `runtime/src/extensions/messages-crud.ts`
- `runtime/src/extensions/autoresearch-supervisor.ts`
- `runtime/src/extensions/env-tools.ts`
- `runtime/src/extensions/workspace-memory-bootstrap.ts`
- `runtime/src/extensions/keychain-tools.ts`
- `runtime/src/extensions/send-dashboard-widget.ts`
- `runtime/src/extensions/workspace-search.ts`
- `runtime/src/extensions/send-adaptive-card.ts`
- `runtime/src/extensions/exit-process.ts`
- `runtime/src/extensions/file-attachments.ts`
- `runtime/src/extensions/proxmox.ts`
- `runtime/src/extensions/internal-tools.ts`
- `runtime/extensions/platform/windows/powershell/index.ts`
- `runtime/vendor/autoresearch/extensions/pi-autoresearch/index.ts`

Checklist:
- [ ] Add or expand a regression test covering chained system-prompt composition order across multiple Piclaw extensions.
- [ ] Verify that prompt-mutating extensions still compose as intended after a future `0.69.0` bump.
- [ ] Spot-check `workspace-memory-bootstrap`, `tool-activation`, `ssh-core`, and `autoresearch` because they all append meaningful prompt content.

### 3) Session replacement callback changes (`withSession`)

Risk: **low currently, high if adopted later**
Status: **no current direct Piclaw usage found**

Search result:
- no direct Piclaw usage found for `ctx.newSession(...)`, `ctx.fork(...)`, `ctx.switchSession(...)`, or `withSession`

Checklist:
- [x] No direct migration needed today.
- [ ] If future Piclaw extensions start using replacement-session APIs, require `withSession` and forbid reuse of stale captured `pi` / `ctx` / session-manager references.
- [ ] Review any future session-replacement code in bundled npm extensions separately from Piclaw core.

### 4) Terminating tool results (`terminate: true`)

Risk: **low**
Status: **not used in Piclaw today**

Search result:
- no current Piclaw use of `terminate: true`

Checklist:
- [x] No migration needed.
- [ ] Consider whether any Piclaw tools could use `terminate: true` later to avoid an extra LLM follow-up turn for pure structured-output flows.

### 5) Stacked autocomplete providers

Risk: **low**
Status: **not used in Piclaw today**

Search result:
- no current Piclaw use of `addAutocompleteProvider`

Checklist:
- [x] No migration needed.
- [ ] Future opportunity only: use stacked providers for workspace-specific slash/template/session completion if web/TUI UX needs it.

### 6) OSC `9;4` terminal progress support

Risk: **low**
Status: **mostly upstream TUI benefit**

Piclaw impact is indirect:
- useful for terminal users
- low direct effect on web runtime

Checklist:
- [ ] After a future bump, smoke-test terminal progress during long responses and compaction.
- [ ] Verify no conflicts with Piclaw-specific status handling or compaction timing UX.

### 7) Headers-only model overrides

Risk: **medium**
Status: **upstream capability exceeds some Piclaw assumptions**

Potential Piclaw mismatch:
- `runtime/src/agent-control/handlers/login.ts` still models custom provider setup around `baseUrl`-required flows for OpenAI-compatible providers.
- Upstream `0.69.0` specifically relaxed built-in model override handling so `headers` can work without `baseUrl`.

Checklist:
- [ ] Audit Piclaw `/login` and related model-config UI/UX for assumptions that a usable override always has a `baseUrl`.
- [ ] Decide whether Piclaw should expose header-only built-in override editing explicitly, or leave that to manual `models.json` editing.
- [ ] Document the supported path if we want users to take advantage of headers-only overrides.

### 8) Trailing orphaned tool-result synthesis

Risk: **medium-positive**
Status: **Piclaw already has compensating logic**

Piclaw already contains custom protection for this class of issue:
- `runtime/src/agent-pool/orphan-tool-results.ts`
- related tests under `runtime/test/agent-pool/orphan-tool-results.test.ts`
- restart/recovery and no-output handling in web runtime/agent orchestration

Checklist:
- [ ] Keep Piclaw’s orphan-tool-result protections until a future upstream bump proves them redundant.
- [ ] After bumping to `0.69.0`, re-run targeted tests for:
  - `runtime/test/agent-pool/orphan-tool-results.test.ts`
  - `runtime/test/agent-pool/run-agent-orchestrator.test.ts`
  - `runtime/test/channels/web/web-channel.test.ts`
  - `runtime/test/channels/web/recovery.test.ts`
  - `runtime/test/channels/web/web-channel-recovery-state.test.ts`
- [ ] Check whether upstream synthesis changes any expected error/recovery wording in our web runtime tests.

### 9) Exported-session HTML link sanitization

Risk: **low-positive**
Status: **beneficial**

Checklist:
- [ ] After a future bump, smoke-test any Piclaw session export/share flows that rely on upstream exported HTML rendering.
- [ ] Confirm no regressions for markdown links, code blocks, and inline HTML-like text in exported transcripts.

### 10) New model catalog entries / provider metadata

Risk: **low**
Status: **beneficial**

Notable upstream addition:
- Gemini 3.1 Flash Lite Cloud Code Assist model

Checklist:
- [ ] After a future bump, verify model discovery surfaces (`/model`, model selectors, provider-ready UX) still behave correctly.
- [ ] Confirm Piclaw-specific provider filtering and context usage surfaces do not assume the older model set.

## Piclaw-specific areas to re-audit immediately after a future `0.69.0` bump

### Core runtime
- [ ] `runtime/src/agent-pool/session.ts`
- [ ] `runtime/src/agent-pool/run-agent-orchestrator.ts`
- [ ] `runtime/src/agent-pool/orphan-tool-results.ts`
- [ ] `runtime/src/channels/web/handlers/agent.ts`
- [ ] `runtime/src/channels/web/runtime/recovery.ts`
- [ ] `runtime/src/agent-control/handlers/login.ts`

### Extensions/tools with TypeBox usage
- [ ] all `runtime/src/extensions/*.ts` files still importing `@sinclair/typebox`
- [ ] `runtime/extensions/browser/cdp-browser/index.ts`
- [ ] `runtime/extensions/platform/windows/win-ui/index.ts`
- [ ] `runtime/extensions/integrations/office-tools/index.ts`
- [ ] `runtime/extensions/experimental/m365/*`
- [ ] `runtime/vendor/autoresearch/extensions/pi-autoresearch/index.ts`

### Packaged/bundled extension behavior
- [ ] repo install smoke
- [ ] bundled extension loading from `node_modules/`
- [ ] runtime session boot with packaged extensions enabled
- [ ] MCP adapter still loads cleanly alongside a bumped coding-agent

## Recommended upgrade order

1. **Do not bump `@mariozechner/pi-coding-agent` blindly.**
2. Land a dedicated TypeBox migration plan first, or at minimum define whether Piclaw will intentionally stay on the compatibility path for one more upstream cycle.
3. When bumping, run at least:
   - [ ] `bun run test`
   - [ ] `bun run check:pack-hygiene`
   - [ ] repo-install smoke
   - [ ] targeted restart/recovery tests
   - [ ] targeted extension loading tests
4. Only after those pass, evaluate whether any Piclaw-local compensating code can be simplified.

## Current conclusion

`0.69.0` looks attractive, but the **TypeBox 1.x migration** is the real adoption gate for Piclaw.

Everything else in the upstream release is either:
- immediately beneficial with low risk, or
- a future opportunity,

while TypeBox migration is the one change that directly intersects many Piclaw runtime and extension entry points.
