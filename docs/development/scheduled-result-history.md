# Scheduled result identity and history projection

New admitted scheduler results link `task_run_logs` payload bytes to an exact EF-S07 occurrence. S07 completion, its decision/head advancement and the history row commit in one synchronous SQLite transaction. The previous independent durable-run log insert is removed. Direct legacy callers retain their existing unlinked log API.

## Authority and payload

| State | Owner |
| --- | --- |
| Occurrence identity, revision, lease, outcome, completion time and next/head decision | EF-S07 |
| Captured result/error bytes and their version/hash | Host history payload linked by `occurrence_id` |
| User-facing task/run/time/duration/status fields | Rebuildable projection of the committed S07 occurrence/log |
| Historical/direct rows with no occurrence link | Existing legacy history; no inferred native identity |

This uses the existing payload table. It adds no duplicate result store or lifecycle engine. SDK execution tasks remain separate from recurrence, admission, leases, revocation and repeatability policy.

A native success reference is `task_run_result:<scheduled_run_id>`, independent of the history row's integer ID. Error completions retain the existing S07 rule that `resultRef` is NULL; the occurrence ID still identifies their captured error payload. Old `task_run_log:<integer>` references are unchanged.

`CompleteScheduledRunRequest.resultPayload`, when present, is a closed version1 object containing nullable result/error strings. Both independent input parsers validate and freeze it; the normal completion request hash binds its exact bytes. Omitted payloads retain the existing opaque-reference protocol, regardless of reference spelling. A payload-bearing success must use the run-derived reference; its prefix alone grants no payload ownership or repair authority.

## Commit and repair

The production adapter owns the write inside `completeRun`:

1. Validate the original request hash and lease/revision/source fence, or recognise its exact completion replay.
2. Commit canonical S07 transitions, log and decision.
3. Write/repair the linked payload/history row before the same transaction commits.

Statement failure rolls back the whole transaction. A lost acknowledgment retries the identical sealed completion request, never task execution. Any earlier uncertain commit remains uncertain across a later retry's `not_applied` failure. It may be resolved only by success or a matching canonical completed record. Unresolved uncertainty does not become a false source-error settlement. A later poll validates completed S07 receipts, exact source bindings and current source version/ownership before repairing settlement. Completed runs are never reclassified as interrupted; an unavailable probe or a native-owned/cancelled source remains protected.

`projectScheduledHistory(database, runId)` rebuilds cache metadata using committed S07 detail and retained, hash-verified bytes. Restoring missing bytes additionally requires the original closed completion request and its matching persisted completion-decision hash. A caller-supplied body alone cannot create another result authority.

- Retained bytes permit metadata repair without changing the payload.
- Missing bytes without the original evidence return `unavailable`; no output or execution identity is fabricated.
- Corrupt version/hash or conflicting completion evidence fails without overwriting it.
- An owner-deleted task returns `retired`. Completion/replay never resurrects its definition or history.
- Repaired physical rows may receive a new integer ID; the occurrence identity and logical result reference stay stable.

The guarantee covers reconstructible projection metadata. Whole-row loss also loses its sole payload copy; backups or the original validated completion request are needed for those bytes. It does not promise reconstruction from an opaque reference alone.

## Migration and legacy preservation

Owned migration `host.scheduled-history / occurrence-payload-v1` adds nullable `occurrence_id`, `payload_version` and `payload_hash`, their coupled CHECK and a partial unique occurrence index. Existing IDs, text, timestamps and other fields remain unchanged; all historical links stay NULL. No matching by task/time/prompt is attempted.

Fresh and upgraded stores use the same migration. Partial/unowned additions, temp shadows, occupied index names, changed receipts or missing/malformed required shapes fail without adoption or repair. The ownership inventory updates only this table and its new exact index.

Explicitly linked payloads protect canonical S07 cleanup/replay detail. An old numeric result reference protects its exact same-task legacy payload too, without backfilling an occurrence identity. Task-owner deletion keeps its previous history-removal semantics; tombstones remain owned by S07. Broader retention rules remain #1702; this work adds no global age cutoff or cleanup job.

## Delivery and scope

Blocked-run budget notices wait while an exactly identified durable occurrence is active. New durable work IDs and native operation-work identities provide that linkage; historical unlinked notices keep their existing semantics. The completion transaction precedes the blocked-run drain. Notification transport remains at-least-once and never replays agent work.

Create/edit/definition and `scheduled_tasks` head/next-run projection ownership remain #1694. This change does not claim to close that separate recovery window. Existing UI/shell/internal/native history fields remain available; only admitted durable execution uses the new completion-owned payload path.

All new state remains in the main SQLite database; backup copies include its columns, index and owned receipt. No database files or dependency graphs are added. Older binaries may continue creating unlinked rows; they must not be used to drop new columns or receipts. No installation, live migration, restore, restart, replay or data cleanup is authorised by this source change.

## Focused checks

Run only the new history test file and the directly changed acknowledgment/notification cases through the repository launchers:

```sh
TMPDIR=/workspace/tmp/piclaw/tests bun runtime/scripts/local-test-priority.ts \
  --cwd runtime --env PICLAW_DB_IN_MEMORY=1 -- bun test ./test/service-effects/scheduled-history-projection.test.ts

TMPDIR=/workspace/tmp/piclaw/tests bun runtime/scripts/local-test-priority.ts \
  --cwd runtime --env PICLAW_DB_IN_MEMORY=1 -- bun test ./test/task-scheduler-budget-notifications.test.ts \
  -t 'defers an exact live occurrence notice'

# With the existing approved native fixture exports:
bun runtime/scripts/local-test-priority.ts --cwd qualification/native \
  -- bun test ./scheduled.test.ts -t 'lost completion ACK repairs'
```
