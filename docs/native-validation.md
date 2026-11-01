# Native validation

`make ci-full` requires both host checks and offline native qualification. A green `make ci-fast` covers the host only.

| Command | Required work |
|---|---|
| `make ci-fast` | Host guardrails, runtime/feature tests and web build |
| `make ci-native` / `bun run ci:native` | Native preflight, installed-package provenance, two private type projects, accepted-source integration and every required native test file |
| `make ci-full` / `bun run ci:full` | `ci:fast` followed by `ci:native` |
| `make ci-integration` | Integration stages including required `ci:native`; Docker/Playwright skip flags do not skip native qualification |

[`scripts/native-gate-contract.json`](../scripts/native-gate-contract.json) defines fixture repositories and immutable SHAs, four source-root mappings, catalogue dependencies, the two type projects, two accepted-source tests, two gate/launcher contract files and the complete required file inventory. Goal catalogue, tools, usage, settlement and terminal-race files are mandatory. No filter, skip, empty discovery or missing fixture can produce native success.

The root and `runtime/durable-engine` each pin Pi 1.4.0, with separate physical dependency graphs and lockfiles. Qualification imports the engine graph through public re-exports; do not symlink root dependencies into the engine or mix SDK handles, contexts, telemetry spans or TypeBox objects across them. Package acquisition records the matching published bytes before offline validation.

Pi Durable 1.4.0 opens SQLite stores at format 2, rebuilding the task table to support durable sleep. Earlier SDKs cannot reopen that format. Source qualification uses disposable stores; deployment requires a separate checkpoint and rollback plan. See [1.4.0 qualification](development/pi-1.4.0-qualification.md).

## Prepare local fixtures offline

Use a disposable checkout with previously provisioned dependencies and add-on source. Nothing in the gate downloads source, installs packages or repairs fixtures. Root tooling, `runtime/durable-engine/node_modules`, `qualification/pi-durable-130/node_modules` and the native add-on checkout's `node_modules` must already be available from frozen-lockfile provisioning. Catalogue tests use the qualification directory's frozen dependencies, never a live profile's installation. Keep the engine's recorded package bytes unchanged; the gate imports the existing provenance verifier and never runs its acquisition/record mode.

Run the following from the repository root. Replace the two example paths with existing local checkouts. The native checkout must match `fixtures.native.ref`; the historical contract checkout must match `fixtures.contract.ref`. The commands read the SHAs from the JSON and check local Git objects without fetching:

```sh
set -eu
NATIVE_FIXTURE=/absolute/path/to/provisioned-native-addons
CONTRACT_FIXTURE=/absolute/path/to/provisioned-contract-addons
native_ref="$(bun -e 'console.log(require("./scripts/native-gate-contract.json").fixtures.native.ref)')"
contract_ref="$(bun -e 'console.log(require("./scripts/native-gate-contract.json").fixtures.contract.ref)')"
```

If only a local Git object store exists, prepare source worktrees before dependency provisioning. These optional commands use existing objects only; use new paths and do not reset a working checkout:

```sh
# LOCAL_ADDONS_REPO already contains both JSON SHAs. No clone or fetch runs here.
git -C "$LOCAL_ADDONS_REPO" cat-file -e "$native_ref^{commit}"
git -C "$LOCAL_ADDONS_REPO" cat-file -e "$contract_ref^{commit}"
git -C "$LOCAL_ADDONS_REPO" worktree add --detach "$NATIVE_FIXTURE" "$native_ref"
git -C "$LOCAL_ADDONS_REPO" worktree add --detach "$CONTRACT_FIXTURE" "$contract_ref"
```

A new worktree supplies source only. It cannot pass until its required dependency graph has been provisioned separately. If an object or dependency is missing, stop and arrange provisioning outside the gate; do not add acquisition commands or fallback roots to `ci:native`.

With provisioned checkouts and dependencies, verify the local revisions, export all five paths and run the gate in the same shell:

```sh
git -C "$NATIVE_FIXTURE" cat-file -e "$native_ref^{commit}"
git -C "$CONTRACT_FIXTURE" cat-file -e "$contract_ref^{commit}"
test "$(git -C "$NATIVE_FIXTURE" rev-parse HEAD)" = "$native_ref"
test "$(git -C "$CONTRACT_FIXTURE" rev-parse HEAD)" = "$contract_ref"
test -z "$(git -C "$NATIVE_FIXTURE" status --porcelain --untracked-files=normal)"
test -z "$(git -C "$CONTRACT_FIXTURE" status --porcelain --untracked-files=normal)"
# These fixture packages have independent frozen locks; provision both outside the gate.
(cd "$NATIVE_FIXTURE" && bun install --frozen-lockfile --ignore-scripts)
(cd "$NATIVE_FIXTURE/addons/code-review" && bun install --frozen-lockfile --ignore-scripts)
test -d "$NATIVE_FIXTURE/node_modules"
test -d "$NATIVE_FIXTURE/addons/code-review/node_modules"
test -d runtime/durable-engine/node_modules
test -d qualification/pi-durable-130/node_modules

export DURABLE_ADDONS_ROOT="$NATIVE_FIXTURE"
export DURABLE_CORE_ADDONS_ROOT="$NATIVE_FIXTURE"
export DURABLE_GOAL_ADDON_ROOT="$NATIVE_FIXTURE"
export DURABLE_CONTRACT_ADDONS_ROOT="$CONTRACT_FIXTURE"
export DURABLE_CATALOG_DEPENDENCIES="$(pwd -P)/qualification/pi-durable-130/node_modules"

make ci-native
# Run make ci-full when both host and native evidence are required.
```

All five exports are required. ADDONS, CORE and GOAL use the same physical native checkout. CONTRACT uses the separate historical source. Preflight rejects `DURABLE_CORE_ROOT`, inherited case-selection variables and `BUN_OPTIONS`; unset them before running. Merely having a checkout at another revision, or a live installed add-on with the same version number, does not satisfy preflight.

Make creates project-scoped scratch through `policy-dirs`. `make policy-config` prints the selected paths without creating directories. Direct Bun invocation must use those paths and create the scratch directories first, as described in [AGENTS.md](../AGENTS.md#portable-build-caches-and-scratch). The native runner owns its run scratch and prints its receipt path.

## Hosted provisioning and required execution

[CI](../.github/workflows/ci.yml) and the reusable [integration gate](../.github/workflows/integration-gate.yml) use [native-qualification-setup](../.github/actions/native-qualification-setup/action.yml). The composite reads and validates immutable pins from the shared JSON, checks out both fixtures without persisted credentials, installs the private engine, qualification and native add-on dependencies with `--frozen-lockfile --ignore-scripts`, then exports all five paths through `GITHUB_ENV`. Hosted provisioning may use the network. The subsequent native gate is offline.

CI runs `make ci-full` after setup. Integration runs `make ci-integration` after the same setup; its native stage is required even when Docker or Playwright is unavailable or explicitly skipped. Native failures are never advisory. Workflow security, exact-SHA release routing and the integration timeout remain in force.

## Receipts and limits

Explicit offline maintenance may initialise the owned SDK application manifest, configuration and branch identities without admitting execution. Initial publication retains owner, lifetime and exact-branch fences; normal startup also retains model/admission checks. Runtime conversation creation checks execution admission before and after publication. Maintenance still denies channel binding/attachment, scheduled and side dispatch, host commands and compaction, and must not start model calls or transports. Metadata publication does not authorise recovery, replay or deployment.

Exit 0 requires successful type projects and a fresh parent-specific JUnit artifact plus a terminal positive-pass Bun report for required integration and every native file. The launcher owns its reporter flags; remove custom `--reporter` and `--reporter-outfile` options. Nested-child reports cannot certify an unfinished parent. Normal test skips are allowed alongside passing tests; skipped-only files and skipped mandatory stages fail.

Files have a 300-second wall-clock budget. The shared contract gives `default-application-runtime.test.ts` 900 seconds for its 200-case serial cold-start matrix and lifecycle checks; each scenario retains its 30-second deadline and its own completion launcher. Other file budgets are unchanged. Timeouts still fail qualification.

The launcher and outer gate bound stdout/stderr draining after process exit. Leaked descriptors, interruption, timeout, missing files and zero-test runs fail qualification. The receipt records tracked changes and untracked source bytes; source changes during the run invalidate it. Keep the printed receipt and complete logs with the exact source revision.

Browser acceptance, live-model requests and platform installation checks run outside this offline gate. Passing native qualification does not establish deployment, migration, live credentials or browser acceptance. Historical checkpoints and their original counts remain in the [qualification evidence](../qualification/pi-durable-130/README.md); they do not replace a receipt for the revision under review.
