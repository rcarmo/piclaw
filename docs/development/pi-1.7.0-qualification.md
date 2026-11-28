# Earendil 1.7.0 migration qualification

Piclaw pins the Root and private Durable graphs separately to [Earendil 1.7.0](https://github.com/earendil-works/pi/releases/tag/v1.7.0), tag commit `fb0fe823539f6d04850f6e34748c01f01f212e1f`. The direct Root OpenAI pin remains 7.52.0. This upgrade does not add session deletion, change the add-on fixture revisions, or patch the SDK.

## Disposable verification

Use the separate frozen dependency graphs and the add-on checkouts described in [Native validation](../native-validation.md). Run `make ci-full` and an isolated package or Git install smoke on the exact candidate. Package evidence can be regenerated with:

```sh
bun scripts/qualification/pi160/generate-current-contracts.ts --allow-network --release=1.7.0
bun run test:local -- bun --no-env-file scripts/qualification/pi160/finish-auth-160.ts --release=1.7.0
bun run test:local -- bun --no-env-file scripts/qualification/pi160/measure-cli-remaining.ts --release=1.7.0
bun qualification/native/src/provenance.ts --record
```

Acquisition checks registry digests and decoded attestation subjects and tag identity. It does not independently verify attestation signatures. Auth checks use synthetic profiles, intercepted requests or the existing loopback-only process guard. Historical 1.6.1 receipts remain unchanged.

A local transition fixture used the 1.6.1 Piclaw factory to complete a synthetic turn, closed it, then reopened the same disposable database under the 1.7.0 factory. It compared conversation, transcript, task, submission, host binding, message and ID-ledger records before any new work, checked for foreign-key errors and verified no replay. A second synthetic turn completed on 1.7.0 and remained settled on reopen. SQLite storage and migration modules are byte-identical between the published versions. This evidence does not establish that an older executable can reopen every store after 1.7.0 starts writing to it.

## Smith rollout and rollback

1. Obtain approval for the exact Core and add-on versions. Verify the current host, service manager, database paths, installed artifacts and dependency graph. Stage the qualified package in a private area; do not overwrite the running installation.
2. Verify a matched recovery checkpoint: closed or verified SQLite snapshot, required sidecars and immutable payloads, and matching executable/add-on/configuration inventory. Rehearse restoring a disposable copy with scheduling and external effects disabled. Keep a verified 1.6.1 package and both pinned dependency graphs.
3. Check native activity, queued inputs, scheduled work and uncertain operations. If the owner cannot stop cleanly, defer. Activate only after an approved graceful owner handoff; do not replay pending work as a test.
4. Check the restarted service's package versions, database identity and read-only timeline/status and session routing before any separately approved live write or provider canary. Copilot provider/cache behaviour changes in this SDK release; the store test is not a cache-hit or latency guarantee.
5. If activation fails, preserve the failed candidate and post-upgrade database. Do not copy the old executable over a database that 1.7.0 could have written. Use the rehearsed, matched recovery checkpoint after reconciling any work since it was captured, or use a separately qualified forward repair.
