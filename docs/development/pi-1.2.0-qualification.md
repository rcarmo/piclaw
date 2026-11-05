# Pi 1.2.0 qualification

The current core dependency and test loop qualifies Pi 1.2.0 from source anchor `cb2e8fd63c9590d606072c5ae87a5932edec41fa`, with working-tree dependency, test migration and fixture fixes. The anchor alone does not identify those uncommitted changes. The parent will publish the core and add-on PRs; this work does not commit, push, deploy or restart anything.

## Recorded results and limits

| Gate | Recorded result |
| --- | --- |
| Core full gate | 6,906 pass, 74 skip, 0 fail; separate 25-test and 9-test phases pass |
| Browser qualification | 58 pass, 1,160 assertions |
| Plan sidebar matrix | 22 cases, 111 trace rows, Pi 1.2.0, sidebar 0.1.25, zero fetch attempts |
| Disposable test VM, real SDK and bundled CLI | Four local MCP calls per path; five synthetic credential cases pass |
| Registry/archive qualification | Exact 1.2.0 package archives, hashes, installed export bytes and provenance subject/ref/commit checked |

The 74 full-suite skips are the baseline optional tests; they are not additional 1.2.0 passes. The pre-PR review was conditionally clear, subject to current-version labels and reproducible generators. Full-gate evidence is retained in the operator's `reviews/pi120/core-ci-qualified.log`; browser, matrix and VM evidence stays in that review directory. These logs are separate from the tracked current receipt JSON.

Native MCP parity is **not qualified**. `scripts/check-earendil-mcp-public-120.ts` retains ten negative public-type diagnostics: `lazy`, `statusObserver`, `resourceFilter`, `authStart`, `appRenderer`, `absoluteDeadlineMs`, `McpOAuthCredentialStore`, `socket`, `listPrompts` and `getPrompt`. The public compile probe does not replace the shipping wrapper or activate native MCP, Harness or durable services.

The VM used the actual local `pi-mcp-adapter` 2.31.0 bytes. Forty files differ from the npm 2.31.0 archive. That result qualifies the measured local wrapper, not the pristine npm wrapper. Synthetic refresh, cancellation, revocation, logout and two-runtime same-file concurrency passed. The VM concurrency case uses one process; it does not establish cross-process refresh. Cancellation returned an error while preserving rotated credentials. No production deployment, live OAuth account flow or real provider inference was tested. Registry provenance statements were decoded and matched; signatures were not independently verified.

The add-on `before_agent_start` custom skill/model/effort branch is separate work. This core housekeeping adds no runtime behaviour. Existing dependency changes, active test migrations and fixture fixes belong to the parent qualification change.

## Current test labels and historical evidence

These six executable files resolve the root-installed SDK. Their descriptions now say 1.2.0; their legacy filenames remain unchanged to avoid unrelated entrypoint churn:

- `runtime/test/agent-pool/earendil-110-codemode.test.ts`
- `runtime/test/agent-pool/pi-110-cli-loading.test.ts`
- `runtime/test/agent-pool/pi-110-codemode-private-files.test.ts`
- `runtime/test/agent-pool/pi-110-refresh-cancellation.test.ts`
- `runtime/test/agent-pool/pi-110-sampling.test.ts`
- `runtime/test/agent-pool/pi-110-tool-selection.test.ts`

Only display descriptions changed in these files. Assertions, fixture identifiers, timeouts and execution paths are unchanged, so the earlier full receipt still describes their behaviour. Historical 1.1.0 registry/CLI JSON, release-bound fixture source and archive receipts remain immutable. Historical admission-negative tests and optional private-UI tests retain their original version labels.

Check references and archive integrity from the repository root:

```sh
rg -n 'pi-110-(cli-loading|codemode-private-files|refresh-cancellation|sampling|tool-selection)|earendil-110-codemode' scripts runtime/scripts docs .github
# Historical receipts/fixtures must have no diff; current test migrations are separate.
git diff cb2e8fd63 -- 'docs/**/earendil-110*.json' 'runtime/test/fixtures/**/registry-1.1.0.json' 'runtime/test/fixtures/**/cli-artifact-1.1.0.json' 'runtime/test/**/fixtures/*110*'
```

## Reproduce current receipts

Run commands deliberately in a disposable checkout with the exact locked dependencies installed (`bun install --frozen-lockfile`). Recorded runtime is Bun 1.4.2. Generators resolve the repository from `import.meta.dir`; they do not import sources from an operator review directory. Temporary directories use the OS temporary-directory API. They overwrite only named current 1.2.0 outputs. Run `--help` to inspect the entrypoints without measuring or fetching. No generator was run to regenerate evidence during this housekeeping.

Prerequisites:

- Bun 1.4.2 and the eight installed Earendil packages at exactly 1.2.0; the existing `bun.lock` and current executable fixtures.
- `tar` and explicit registry HTTPS access for archive/provenance measurement.
- Repository TypeScript compiler for `check-earendil-mcp-public-120.ts` (the generator imports this tracked helper).
- Linux `/proc/self/ns/net`, UID/GID APIs, non-interactive `sudo`, `unshare`, `ip`, `setpriv` and `timeout` for CLI/browser measurements. Namespace creation must be permitted. Fixtures drop privilege and use distinct loopback-only namespaces; no host credentials are copied.

From the repository root, run in this order:

```sh
# Explicit network opt-in: npm metadata, archives and attestation statements.
bun --no-env-file scripts/qualification/pi120/generate-current-contracts.ts --allow-network
# Inventory fixture prints one synthetic JSON result; no account/provider call.
env -i PATH="$PATH" HOME=/nonexistent PI_OFFLINE=1 PI_TELEMETRY=0 \
  bun --no-env-file runtime/test/agent-control/fixtures/provider-auth-inventory-120.ts \
  > runtime/test/agent-control/fixtures/provider-auth-inventory-120.json
# Installed trees, CLI fingerprints, provider inventory, guarded imports, public types.
bun --no-env-file scripts/qualification/pi120/finish-auth-120.ts
# Ten CLI cases run sequentially (two providers × five outcomes).
bun --no-env-file scripts/qualification/pi120/measure-cli-remaining.ts
```

`generate-current-contracts.ts` writes `runtime/test/fixtures/earendil-package-admission/registry-1.2.0.json`, plus `dependency-manifest.json`, `receipts/earendil-120-registry.json` and `receipts/earendil-120-current-lock.json` under `docs/design/earendil-agent-harness-integration-adr/evidence/`.

`finish-auth-120.ts` writes `runtime/test/fixtures/earendil-package-admission/cli-artifact-1.2.0.json` and the evidence receipts `earendil-120-provider-auth.json`, `earendil-120-package-admission.json` and `earendil-120-mcp-public.json`. It performs measurements only; it does not rewrite test source or migrate historical files. Fixed test/fixture fingerprints must be reviewed if installed bytes differ.

`measure-cli-remaining.ts` writes `receipts/earendil-120-packaged-cli-auth-bun.json`. Timing fields may vary. Each case uses a disposable profile, guarded synthetic exchanges and a 65-second timeout; provider inference is not invoked.

The remaining public auth receipts can be measured manually without the old migration script:

```sh
receipts=docs/design/earendil-agent-harness-integration-adr/evidence/receipts
for pair in 'codex-device-flow codex-device' 'provider-device-matrix provider-devices'; do
  set -- $pair
  env -i PATH="$PATH" HOME=/nonexistent PI_OFFLINE=1 PI_TELEMETRY=0 OTEL_SDK_DISABLED=true \
    bun --no-env-file "runtime/test/agent-control/fixtures/$1-120.mjs" \
    > "$receipts/earendil-120-$2-bun.json"
done
# Browser/copy-code matrix requires its own OS network namespace.
parent_netns=$(readlink /proc/self/ns/net)
uid=$(id -u); gid=$(id -g); bun_bin=$(command -v bun)
fixture="$PWD/runtime/test/agent-control/fixtures/provider-browser-matrix-120.mjs"
sudo -n unshare --net /bin/sh -c \
  'ip link set lo up && exec setpriv --reuid="$1" --regid="$2" --clear-groups --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs env -i PATH=/usr/bin:/bin HOME=/nonexistent SYNTHETIC_EXPECT_UID="$1" SYNTHETIC_PARENT_NETNS="$3" timeout --kill-after=2s 90s "$4" --no-env-file "$5"' \
  browser120 "$uid" "$gid" "$parent_netns" "$bun_bin" "$fixture" \
  > "$receipts/earendil-120-provider-browser-bun.json"
```

The device/Codex fixtures use fetch interception, without an OS network sandbox. Browser and CLI fixtures require namespace isolation. Check command exit codes and JSON before accepting newly measured files. Never substitute historical receipt content. The ephemeral `migrate-current-auth.ts` script is intentionally excluded.

## Reproduce Plan sidebar and local checks

The historical Plan harness pinned sidebar 0.1.25 and SDK 1.2.0. It has been retired after the native SDK cutover; its existing receipts remain historical evidence. The current native suites include `qualification/pi-durable-130/plan.test.ts` and `installed-tool-catalog.test.ts`. Run `make ci-full` for the required host and native gates; these older commands do not qualify the current native runtime.

```sh
bun run runtime/scripts/repo-dev-command.ts typecheck:scripts
make lint
bun run test:local --cwd runtime --env PICLAW_DB_IN_MEMORY=1 -- bun test \
  test/agent-pool/earendil-110-codemode.test.ts \
  test/agent-pool/pi-110-cli-loading.test.ts \
  test/agent-pool/pi-110-codemode-private-files.test.ts \
  test/agent-pool/pi-110-refresh-cancellation.test.ts \
  test/agent-pool/pi-110-sampling.test.ts \
  test/agent-pool/pi-110-tool-selection.test.ts
```

Housekeeping validation passed: 12 tests across the six label-only files, 73 assertions, scripts TypeScript check, scoped lint and all three generator `--help` entrypoints. Thirty historical 1.1.0 JSON/fixture files matched source-anchor bytes exactly; `git diff --check` passed. The housekeeping `make lint` rerun failed on existing files outside this scope, including historical ambient declaration fixtures and unused-variable/caught-error rules. It reported no errors in these generators, the Plan matrix script or the six label-only files; the parent must reconcile that broad lint result before publication. The recorded `ci:fast` pipeline does not include `make lint`.

VM staging scripts and raw SDK/CLI/credential/wrapper attestation logs remain operator review artifacts, not core receipt generators. Re-running them requires an explicitly authorised disposable VM and the same measured local wrapper bytes. This checkout does not automate VM provisioning, production reloads or live account access.
