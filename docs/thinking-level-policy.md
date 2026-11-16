# Historical legacy thinking policy

The legacy constructor and its JSONL resume/rewrite paths were removed under
#2017. The policy utility below remains covered by isolated SDK tests. Current
native model/thinking controls use `runtime/durable-engine/src/host-model-controls.ts`
and persisted native state; native status returns `thinking_policy: null`.
No legacy session is hydrated for inspection or model selection.

The following sections record the old policy and its historical behaviour.

Piclaw preserves a session's thinking preference when switching models. A lower
workspace or global startup default cannot silently replace that preference.

## Selection order

For a model-only change:

1. A thinking level pinned to the destination in a scoped model cycle.
2. An explicit per-model preference in `modelThinkingLevels`.
3. The current session's preferred level.
4. SDK capability clamping determines the effective level for the destination.

A `/thinking`, `switch_thinking`, family thinking-control or cycle-thinking action
changes the session preference. Explicitly choosing a lower level remains valid.
Target-model and scoped-cycle preferences apply to that destination without
rewriting the session preference.

For example, a session preferring `high` uses `off` on a non-reasoning model, then
returns to `high` on a model supporting it. This does not bypass model capability
checks. The SDK's supported-level mapping and clamp algorithm remain authoritative.

New sessions retain the existing startup selection rules: personal defaults where
applicable, trusted project settings over global settings, and SDK fallback.
Existing recorded session choices take precedence on restoration. Operators can
still deliberately edit startup defaults; switching one session does not write
those defaults for other sessions.

## Implementation boundary

`runtime/src/agent-pool/thinking-policy.ts` decorates each created SDK session's
public `setModel`, `cycleModel` and `setThinkingLevel` methods. It does not modify
an SDK prototype or shared SettingsManager. Extension model controls invoke the
same session methods. The adapter replaces the SDK's default-first *selection*
with the order above while retaining SDK authentication, model events, capability
clamping and effective-level transcript entries.

An async-local, per-session switch marker distinguishes the SDK's internal
thinking assignment from a later explicit extension override. The marker is
consumed before thinking notifications, so a model-select extension can still
choose a new session preference. Separate sessions never share preference state.

The wrapper depends on SDK 0.85.1's model methods assigning thinking through the
public setter. Tests use the actual SDK to detect a change in that contract.
There is no new model-control endpoint or background timer.

## Persistence and diagnostics

The ordinary `thinking_level_change` entry records the effective level. A small
`piclaw.thinking-policy.v1` custom entry records the preferred level and a bounded
transition: operation, source, previous/requested/effective levels and whether
clamping occurred. Custom entries do not enter model context.

Restoration reads only the active branch. It captures preference before SDK
startup can append an effective clamp. Normal/emergency rotation, deferred
branching and destructive pre-compaction trimming carry preference separately
from the effective level. Older sessions without custom metadata begin with their
recorded thinking level; the code does not invent an earlier user preference.
Side-session and deferred-seed restoration carry the effective level independently:
a destination override of `medium` stays `medium` even if session preference is
`high`. Restoration is not treated as an explicit new thinking choice.

- `/thinking` reports the session preference, effective default and its source.
- A hydrated session's `/agent/models` response adds `thinking_policy` with
  `preferred_level`, `effective_level`, `defaults` and `last_transition`. A cold
  session returns `null` policy rather than being hydrated for inspection.
- `thinking.selection` logs contain bounded levels and transition/default source.
  They omit chat/session IDs, prompts, credentials, settings contents and paths.
- Default provenance distinguishes project, global, runtime override and SDK
  fallback. It describes the settings snapshot loaded by that process; an external
  file edit does not imply the running SettingsManager has reloaded it.

The legacy native-`max` compatibility path no longer writes a global default when
changing a session. Family admission and ownership checks remain in their existing
adapters; this policy grants no new access.

## Regression coverage

`runtime/test/agent-pool/thinking-policy.test.ts` uses private in-memory credentials,
settings and synthetic providers. Provider requests throw if attempted. It covers
the upstream high-to-low reproduction, direct and extension controls, cycling,
target overrides, explicit lowering, capability clamps, concurrent sessions,
rejected model changes, active-branch restoration, repeated cold hydration,
compaction, rotation and default provenance.

Constructor-bound sanitisation, trimming and deferred replay tests were retired
with their implementation. Existing native model controls, history and compaction
qualification remain separate. Run the retained SDK utility tests through the
repository launcher:

```sh
bun run test:local --cwd runtime -- bun test test/agent-pool/thinking-policy.test.ts
```

Issue #1359 contains the anonymised operational evidence. No raw session content
or identifying remote configuration is included in this implementation.
