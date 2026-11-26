---
name: algorithm-engineering
description: Run a bounded performance-engineering campaign with falsifiable hypotheses, fixed correctness checks, paired benchmarks and reviewable Git patches. Use only on explicit request to run an experiment campaign.
compatibility: Bun 1.4+, Git, and an isolated checkout with a runnable benchmark and correctness checks.
distribution: repository
---

# Algorithm engineering

Use this skill for an explicitly requested campaign. Reading it does not authorise starting a campaign, background work, publishing, or deployment. Use Piclaw's existing tools and permissions. Do not start a child agent or another experiment supervisor.

## Agree on the contract

1. Read the target's `AGENTS.md`. Confirm the exact base commit and an owned worktree. Give the run a unique, private artifact directory outside the target checkout (on Smith, under `/workspace/tmp/piclaw/runs/`). Preserve existing work and the running service.
2. Agree on editable files, a fixed correctness command, a fixed benchmark command, fixture and harness hashes, one primary metric (unit and direction), and minimum meaningful improvement in that unit. Use separate correctness assertions; protect semantics, reliability, and other required guardrails even if the primary metric improves. Read the unmodified harness and confirm it really exercises the intended workload. Put harness, checks and fixtures outside the candidate's editable scope. Changes to them require a separately agreed contract and fresh baseline.
3. Set a finite experiment count (including the baseline), an overall deadline, per-experiment time limit, memory ceiling, and an odd number of paired repetitions (at least three). Require a test environment that can enforce the resource limits and cancel/join the complete owned job. Stop if that environment is unavailable. The recorder validates evidence; it does not enforce process isolation or limits.
4. Capture machine/runtime, load, seed, fixture versions and cold/warm conditions. Fix these for comparison and run shared-resource tests serially. Use the existing test launcher where the repository requires it. Reuse decisions already supplied; ask about missing scope or limits before proceeding.

Copy `contract.example.json` and fill it in. From this skill directory:

```sh
bun evidence.ts init "$RUN_DIR" /absolute/path/to/contract.json
bun evidence.ts status "$RUN_DIR"
```

The recorder never executes commands, edits source, or makes network calls. It writes one contract and separate, write-once plan/result files. Keep the directory private; it is not an audit log resistant to editing by its owner. See `EVIDENCE.md` for the file and CLI contract.

## Run the campaign

1. **Baseline.** Begin with the unmodified commit, then check correctness and measure it repeatedly. Record the baseline even when checks or measurements fail. A failed baseline stops the campaign; do not score a candidate against it.
2. **Predict before editing.** Save the observed bottleneck, one falsifiable hypothesis, expected direction and magnitude, and what would disprove it. Record the hypothesis against the current best commit with `begin` before editing. Take a small, reviewable step. Verify the editable scope and fixed inputs by Git diff and hashes, including untracked files that might affect the run.
3. **Check and measure.** Name the exact candidate commit. Run correctness checks before timing. If checks pass, measure current best and candidate in paired runs, alternating order and using the same seeds and conditions. Save raw results and actual peak memory. Checks failed, timeouts, missing data, interrupted work and excessive resource use never count as a win or a numeric zero. Record absolute guardrails separately: e.g. HTTP timeouts, p95/p99/max, or accepted-work integrity. On held-out inputs, confirm any benefit that could be explained by tuning to the benchmark.
4. **Decide.** Compare the median paired improvement to the threshold. Only retain a candidate with a practical gain and passing guardrails. Discard marginal or noisy results and explain conflicting samples. Keep raw logs, failed diffs and rationale. Export one reviewable patch for each retained candidate; never reset a shared checkout or remove unrelated work. For a meaningful performance gain, check that complexity and maintenance costs are justified. Report simpler equal-speed alternatives separately; this performance gate does not auto-promote them.
5. **Stop or resume.** Stop at the agreed limits, on cancellation, or when evidence is uncertain. Join owned work before marking an interrupted experiment resolved. `status` shows any unfinished plan, the best recorded commit, deadline and count. Resume by verifying the pinned inputs, best commit and remaining scope, never by rerunning an unresolved command. Record an explicit interrupted result only after establishing what happened. Save a small Markdown report with baseline, kept and rejected changes, checks, measurements and unresolved risks.

Keep raw logs, patches and project data local by default. Share only explicitly approved, reviewed artifacts. Do not include secrets, prompts, unpublished user data or live databases. “Keep” selects a local candidate; changes still go through normal PR review and separate rollout approval.

## Attribution

Adapted from [Agentic Algorithm Engineering](https://github.com/CHSZLab/AgenticAlgorithmEngineering/blob/69c4dbec6bad48a742b3019b64aefa9b2fb2a1d1/AAE.md) by Christian Schulz and contributors, MIT. See `LICENSE`. Piclaw uses a finite loop and its own authority, evidence and reporting paths.
