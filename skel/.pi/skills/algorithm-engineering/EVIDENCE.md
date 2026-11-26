# Campaign evidence

`evidence.ts` is a local recorder, not a runner, scheduler or security boundary. It validates the shape and consistency of supplied evidence. It does not execute the benchmark, verify Git or input hashes, inspect log contents, or enforce memory/process limits. The operator verifies those facts outside the recorder. Use a fresh private directory on a local filesystem supporting hard links and directory sync.

## Commands

| Command | Input | Result |
|---|---|---|
| `init <run-dir> <contract.json>` | Filled `contract.example.json`; future UTC deadline | Creates the directory and writes `contract.json` |
| `status <run-dir>` | None | Best commit, remaining slots, deadline and pending plan |
| `begin <run-dir> <plan.json>` | Parent, hypothesis, prediction, falsifier | Writes an exclusive numbered plan before edits or execution |
| `finish <run-dir> <result.json>` | Exact pending plan identity and evidence | Writes an exclusive result; advances best only for `keep` |

Use `bun /absolute/path/to/skill/evidence.ts …`. Keep raw logs, diffs and reports alongside the records under the approved run directory, not in the repository under test. Never overwrite an existing receipt. If a call is interrupted or prints an error after publishing, read `status` and inspect the files before deciding what happened. An unfinished plan blocks another `begin`; it never instructs the agent to execute again.

## Inputs

A plan names the current best full Git commit. The first plan is the baseline; its candidate must equal the contract's baseline. The returned `id` and `startedAt` identify the plan for `finish`.

```json
{
  "parent": "<full current best commit>",
  "hypothesis": "Repeated sorting dominates run time for larger inputs.",
  "prediction": "Reusing the sorted state should save at least 5 ms.",
  "falsifier": "Paired improvement is below 5 ms, or golden output changes."
}
```

A measured candidate supplies one sample per repetition in both `samples` and `control`. Pair by index. The baseline uses only `samples`. `elapsedMs` covers the measured experiment's checks and runs; `peakBytes` is the maximum measured memory across them. Record the measurement method in the contract's environment field. `evidence` lists the local receipt/log/diff references; it should include the independent checks and per-pair run order. `retain: true` asks to retain the change after all review and guardrails. Without that explicit choice, an improved candidate is recorded as `discard`.

```json
{
  "id": 2,
  "startedAt": "<exact value from the plan>",
  "candidate": "<full candidate commit>",
  "outcome": "measured",
  "checksPassed": true,
  "elapsedMs": 1350,
  "peakBytes": 32000000,
  "samples": [20, 21, 20],
  "control": [28, 27, 29],
  "retain": true,
  "evidence": ["raw/002.log", "checks/002.log", "patches/002.patch"],
  "reason": "All checks and secondary guardrails passed; paired gain clears the threshold."
}
```

Median paired improvement is positive when the candidate moves in the agreed direction, expressed in the metric's unit. Equality never counts as improvement. A measured result fails on missing/failed correctness, exceeded reported memory/time, or an expired campaign deadline. Malformed samples are rejected while the plan remains pending. Save a `failed` result for a crash, check failure or unusable measurement; save `interrupted` only after confirming the owned job is no longer running and documenting its outcome. Both allow `candidate` and `peakBytes` to be null when unknown and omit samples. Neither imputes zero or changes best. A failed or interrupted baseline closes the campaign.
