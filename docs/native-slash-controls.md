# Native recovery and execution controls

These commands use the current durable conversation binding and host ownership. They never open a legacy `AgentSession`.

| Command | Behaviour |
| --- | --- |
| `/restart` | Abort the bound conversation's active generation and user shell, join cleanup, then read committed context and agent state. Keep the conversation ID, history and accepted queues. Refuse reload while shared host work is active or uncertain. The process stays running. |
| `/bash <command>` | Run a tracked shell command from the service working directory. Save command, output and exit status in native conversation context without starting a model request. Require shared idle authority. Limit execution to 30 seconds and capture 20,000 output characters. |
| `/abort-bash` | Cancel this conversation's current user shell. Leave model/tool runs and other chats alone. |
| `/auto-compact [on\|off]` | Read or change runtime-wide automatic compaction through the existing compaction configuration. |
| `/auto-retry [on\|off]` | Read or change runtime-wide SDK retry policy. Store the choice in `router_state`; default to disabled when no choice exists. |
| `/abort-retry` | Cancel the exact active generation only while its committed checkpoint is in retry backoff. Recheck task identity, conversation and checkpoint in the cancellation transaction. |

`/restart` differs from `/exit`, which requests process shutdown through the global idle controls. `/bash` differs from `/shell`, which returns shell output without adding it to model context.

Policy changes apply at subsequent SDK decisions. They do not replay or restart existing work. Invalid policy arguments return an error without changing configuration.

Shell commands are not replayed after recovery. If execution finishes but context persistence cannot be confirmed, the command returns an uncertainty error; do not automatically rerun it. Concurrent user shells for the same conversation are rejected. A restart refuses uncertain cleanup instead of aborting unrelated work to obtain idle.

The `/commands` audit reports availability from the bound native ports. `GET /agent/commands` uses the same catalogue for autocomplete: supported commands and aliases appear in `commands`; unsupported names and aliases appear in `unavailable_commands`. The existing `unavailable` feature categories are unchanged. Unbound chats return 404. Failed metadata reads or missing catalogues return 503 without opening a legacy session.

## Focused checks

Run through the repository's isolated launcher:

```sh
bun run test:local --cwd qualification/native --env PICLAW_DB_IN_MEMORY=1 -- bun test ./native-critical-controls.test.ts ./native-control-bootstrap.test.ts
bun run test:local --cwd runtime --env PICLAW_DB_IN_MEMORY=1 -- bun test ./test/agent-pool/runtime-facade.test.ts ./test/agent-control/native-control-capabilities.test.ts
```

The bootstrap tests exercise idle reload, cancellation of a held generation, refusal to cancel a non-retrying generation, and cancellation during real SDK retry backoff using a synthetic provider.
