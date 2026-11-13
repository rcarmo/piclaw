# SQLite connection roles and checkpoint progress

Root, native SDK and scheduler writers share a file through separate handles. `db/sqlite-role-policy.ts` opens and verifies each connection's effective policy; schema migration and transaction ownership remain with their existing callers.

## Effective policy

| Policy | Root | Native SDK | Scheduler file handle |
|---|---|---|---|
| File journal / synchronous | WAL / FULL (`2`) | WAL / FULL (`2`) | WAL / FULL (`2`) |
| Busy timeout, milliseconds | 0 | 0 | 0 |
| Foreign keys | Preserve the existing setting | ON | ON |
| Secure delete | ON (`1`) | ON (`1`) | ON (`1`) |
| Page cache, non-ZFS | 1 MB | 2 MB | 2 MB |
| Page cache, ZFS | 8 MB | 2 MB | 2 MB |
| File mmap, non-ZFS | 256 MB | 0 | 0 |
| File mmap, ZFS | 0 | 0 | 0 |
| Bun strict bindings | Off | On | Off |
| File creation in production | Allowed for root startup | Guarded shared open forbids creation | Forbidden; requires root binding |

Root's schema batch temporarily enables foreign keys and restores the prior setting on success or failure. This does not globally enable legacy foreign keys. A standalone memory handle retains MEMORY journal, FULL, a 2 MB cache and its role-specific waits/FKs. The production memory scheduler instead borrows the root handle, enables FKs for its reference-counted store lifetime, and restores the original FK setting after the final borrower closes. It does not flatten the root handle's other policies to scheduler defaults.

Root, SDK and scheduler configuration use busy-timeout zero and a single WAL transition attempt; none enters a synchronous transition-retry loop. Its existing asynchronous writer admission still retries before entering the protected callback. [Host write admission](sqlite-write-admission.md) likewise never replays an entered callback.

Explicit maintenance uses two additional noncreating existing-WAL roles through the same opener: `maintenance-reader` opens SQLite readonly for dry-runs; `maintenance-writer` is selected only for an apply operation. Neither runs root migrations, converts file format or registers checkpoint workers. Roles cannot be changed in place or promoted to root. The thinking-purge and archived-branch CLIs close their owned handle on both success and failure. Index workers retain their separate existing-store probes and lifecycle.

## File identity and lifetime

An opener checks the requested file identity before and after configuration, compares SQLite's opened main path with the supplied binding, and verifies the open descriptor through `SQLITE_FCNTL_HAS_MOVED` (both return code and output flag). SDK and scheduler shared opens also require the expected root identity/canonical path. Supported symlinks resolve to that same file; alternate hardlink WAL names are rejected for shared opens. Filesystem classification follows the real target without rewriting the caller's declared source path.

SDK owner checks and per-transaction guards remain in the adapter. Scheduler opens use the root binding; its lease/authority checks remain in the store. Configuration failure closes a newly owned handle before publication. A failed close produces `RuntimeStartupCleanupError`, preserving uncertain-cleanup ownership. Reconfiguring an existing caller-owned handle does not transfer its lifecycle to the helper. No file is deleted to repair an opening failure.

Root retains its existing bootstrap `STORE_DIR`, mode and cache-key precedence. The helper receives explicit paths; it does not read new live path settings or perform workspace migration. The broader bootstrap/live configuration contract remains #1275, with its existing scope and parent unchanged.

## Shared checkpoint participation

Eligible ZFS WAL/FULL writers register with the existing off-thread PASSIVE coordinator after opening. Root, SDK and scheduler file handles join one group by canonical file and device/inode identity. A scheduler's private handle joins only after store construction succeeds and unregisters before close. Store-construction failure closes the owned handle; queued scheduler work retains its store until it can settle. A memory FK-enable failure also releases its borrowed reference before a later loop starts. Memory borrowing and stop/join semantics remain intact.

Non-ZFS, non-WAL and memory handles keep built-in checkpointing. A mismatched path, unsupported hardlink identity or non-FULL writer is rejected without disabling its existing checkpoint policy. Coordinator eligibility additionally requires a single file link. The worker checks the same file identity before opening and on every tick, including the open descriptor. Confirmed SQLite closure is acknowledged before the parent terminates the worker and releases the registry lifetime.

Automatic checkpoints are disabled only after worker readiness. Repeated registrations reference-count the original per-handle policy. Unregistering the last reference restores that policy. Worker startup, posting, readiness, identity or runtime failure restores positive custom policies; an originally disabled policy receives the safe 1000-page fallback while the failed group remains registered. Explicit unregister restores the caller's original value, including zero. Failed groups remain failed until all participants leave. Late participants also receive safe fallback without spawning another worker; late readiness cannot disable it or create overlapping replacements.

The worker performs PASSIVE checkpoints once per second. FULL commit policy remains effective; there is no NORMAL mode, forced TRUNCATE checkpoint, schema cleanup or history retention change. A worker is not a backup or a replacement for a complete recovery unit.

## Existing structured log surface

`sqlite_checkpoint.ready`, `sqlite_checkpoint.fallback`, `sqlite_checkpoint.rejected` and `sqlite_checkpoint.progress` use the existing logger/sinks. There is no new UI, route or parallel runtime status system.

Progress records expose `logFrames`, `checkpointedFrames`, `pendingFrames`, `busy`, `walBytes` and `activeConnectionCount`. The connection count describes uniquely registered participants; a caller that closes without unregistering remains registered until cleanup. Unknown busy-result counters use `pendingFrames: null`, so unavailable work is not reported as zero. States are inferred from observed frame counters: repeated pending work without increased checkpointed frames can report stalled; a counter reset starts a new observation instead of fabricating a stall.

The coordinator logs the first observation, state/participant changes, or a 30-second heartbeat. Repeated identical stalls/errors are bounded. WAL allocation can remain large when all observed frames are checkpointed. Frame progress does not establish logical data retention, account usage or permission to truncate the file. Pinned-reader tests retain the reader snapshot while reporting stall and later completion with a still-allocated WAL.

## Verification and operational boundary

Focused fixtures exercise effective policies on three actual file-backed roles, ZFS/non-ZFS classification, memory borrowing, symlinks/unsupported aliases, replacement and failed-open cleanup, original checkpoint values, worker failures and late messages. Actual scheduler fixtures verify three distinct handles/one worker, registration removal before close, file/memory construction failure and memory FK restoration. Existing callback-once, lock contention, scheduled authority, queued settlement and runtime-upgrade tests remain required.

These are offline owned fixtures and source changes. No installation, restart, dependency change, live database/configuration/backup action, replay/discard or historical-data cleanup accompanies them. FULL PRAGMA verification is not a power-loss test. Production activation and broader recovery acceptance remain separate. The frozen issue campaign runs focused tests only.
