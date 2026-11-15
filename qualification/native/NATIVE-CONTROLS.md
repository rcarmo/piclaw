# Native session controls

The pi-durable application routes core commands without constructing an `AgentSession`. This document describes the source implementation. Installation and live verification require separate evidence.

## Command routing

`runtime/src/agent-control/command-registry.ts` defines core command names and aliases. The parser also accepts underscore forms of hyphenated names. `native-control-capabilities.ts` supplies the display-only `/commands` catalogue. Runtime ownership, binding and admission checks authorise each operation independently of that catalogue.

| Commands | Native behaviour |
|---|---|
| `/state`, `/stats`, `/context` (`/ctx`), `/last` | Read the captured conversation's public SDK state and committed ledger. Reports create no model turn. |
| `/quota` | Read credential-bound provider usage for the selected model. |
| `/model`, `/cycle-model`, `/thinking` (`/effort`), `/cycle-thinking` | Use the captured model/thinking ports. Validate available models and effort levels. |
| `/abort` | Cancel the exact current ordinary operation; preserve accepted successor inputs. |
| `/new-session` | Reset context in the same conversation. Retain previous history and invalidate pending authentication flows. Legacy session-file parents are rejected. |
| `/compact` | Compact the captured current conversation through the public SDK, including while it is busy. Keep raw history and active work; place the summary at the next safe turn boundary. Preserve the running turn's status ownership. |
| `/restart`, `/exit` | Request host shutdown before Goal, queue or harness inspection. Cleanup has a 15-second process-exit backstop. The service manager controls whether the process starts again. |
| `/tree` | Read the public context tree. Entry navigation is unavailable. |
| `/queue`, `/steer` | Use web input admission and the accepted-source ledger. These commands do not use legacy prompt queues. |
| `/login`, `/logout` | Use a host-owned authentication lifetime and owned credential-operation scopes. |
| `/shell` (`!`) | Run the existing host shell control. Its output does not become durable model input. |
| `/passkey` (`/passkeys`), `/totp`, `/qr`, `/search` | Use session-independent host handlers. |
| `/agent-name`, `/agent-avatar`, `/user-name`, `/user-avatar`, `/user-github` | Use existing host display-profile handlers. |
| `/settings`, `/theme`, `/meters` | Use existing web UI handlers. |
| `/commands` | Show core command classifications. Add-on commands have separate admission rules. |

Optional ports must exist for a command to be classified as native. Missing ports, revoked ownership and changed bindings fail closed. A configured durable application never falls back to a legacy session factory, including for an unbound chat.

## Unavailable controls

These controls return errors without creating model operations or modifying the accepted-source ledger:

| Commands | Missing contract |
|---|---|
| `/auto-compact`, `/auto-retry`, `/steering-mode`, `/followup-mode` | The public harness settings are harness-wide. The application has no qualified per-conversation policy mutation. |
| `/abort-retry`, `/abort-bash` | No qualified exact native retry/process cancellation port. Use `/abort` for the current ordinary operation. |
| `/bash`, `/queue-all` | No qualified durable contract for adding arbitrary shell output to context or batching all queued inputs. |
| `/session-name`, `/switch-session`, `/session-rotate` | No native application contract for legacy session metadata, file switching or JSONL rotation. `/new-session` resets context without rotating identity. |
| `/rollup`, `/fork`, `/clone`, `/forks` | No qualified application branch/route mutation ports. |
| `/label`, `/labels`, `/export-html` | No qualified native metadata/export adapter. |

Tests enumerate every unavailable core command, its registered aliases and underscore forms against both the facade and an actual bootstrapped durable application. They check error results, unchanged context, no timeline/source/operation/terminal records, and no model or credential calls. The catalogue grants no execution authority.

## Provider authentication

`NativeProviderAuthContext` contains the chat/binding identity, model runtime, lifetime signal, synchronous authority check, owned-operation runner and explicit model activation callback. It exposes no execution-session methods.

The application registers entered credential operations before callback entry. Shutdown seals admissions, aborts the lifetime and joins those operations before closing the controller or releasing ownership. Flow cancellation can return without joining a blocked credential recovery; the host still owns that recovery until it settles.

Authentication alone leaves the selected model unchanged. Activation requires explicit confirmation of an allowed model ID, including when only one model is available. Provider-response model suggestions do not establish selection authority.

A `CredentialSynchronizationError` can occur after credentials have been saved. Recovery uses `refresh({ allowNetwork: false })`; it does not repeat login, roll back credentials or forward credential-bearing errors and causes. Warning fields and user messages remain bounded and secret-free.

## Service interruption

Stopping the backend seals host producers and observers without aborting execution dependencies. Closing it joins owned credential operations and closes the public SDK before disposing provider and tool dependencies. This prevents shutdown cancellation from being committed as a provider failure while the SDK scheduler is still writable.

Reopening can continue the same accepted submission from its committed request checkpoint, retaining completed tool results. It may issue another provider request; it does not resume the original token stream or clear uncertain accounting holds. A tool interrupted before its result commits has no new exactly-once guarantee. Genuine committed model errors remain terminal and are not replayed.

If cleanup or held maintenance cannot finish, ownership and dependencies stay retained. The operator's process-wide shutdown backstop still applies; no successful cleanup is fabricated.

## Replies and timeline data

Command execution and reply delivery have separate results. A successful native command can return HTTP 201 with `response_delivery: failed` when publication fails. Do not repeat the command to repair delivery. Root threading is resolved in the message transaction.

Timeline content can be edited or deleted. Terminal reconciliation uses the committed operation and submission records. Display changes do not undo execution, recreate deleted replies or prevent startup. Host-generated messages, including shell-task output, need no additional recording protocol.

An unanswered `model_error` settles the ordinary operation as failed, consumes its claimed inputs and releases the worker lane. The terminal transaction inserts one fixed failure notice without provider diagnostics or partial tool media. Retry and reopen reconcile the terminal commit without duplicating the notice.

## Verification

On 22 October Smith started with its existing messages and accepted work preserved. Its previously queued input settled through normal recovery. A focused test confirms terminal replay after reply editing and deletion; the durable-engine typecheck passes. Rui requested no CI or long checks for this repair.
