# Child request runtime registration

Core exposes the unchanged `ChildRequestsApiV1` as
`__piclaw_runtime.childRequests`. The production provider host is unset.
Registration succeeds during an installed add-on's startup import; scope creation
rejects `unavailable` until core explicitly supplies a qualified host.

## Invocation authority

`child-request-runtime.ts` wraps public loaded tool definitions whose resolved
entry files belong to installed add-on manifests. Each resource loader owns a
generation; a successful reload invalidates the previous definitions without
invalidating another loader for the same chat. Original execute functions remain
in a weak map, so rebinding does not stack wrappers.

The wrapper captures the add-on, tool-call ID, admitted work, chat, execution
identity, database handle/file identity and workspace/store/data/config paths.
`createScope` requires the exact active tool-local work context and matching
startup add-on. The child supplies only model selection, signal and deadline.
Unknown fields, required MCP, invalid models and deadlines beyond five minutes
reject before host work. Limits are sixteen scopes per invocation and 256
outstanding scopes across the runtime.

Private-pipe callbacks use the captured `ChildRequestInvocation.authorise`
closure. They do not acquire authority from callback-local chat or work context.
The closure rechecks the active lease, resource generation, signal/deadline,
single-user policy, captured database/path identity and durable work status.
The qualified executor must also check model policy, account generation and
budget reservation at preparation and dispatch. Those executor checks are not
implemented by this registration slice.

On normal or exceptional tool completion, the wrapper revokes new admission,
aborts the invocation signal and awaits every owned scope's raw close promise.
Failed closes remain tracked and reject successful tool delivery. Explicit close
also stops further stream admission before its asynchronous cleanup starts.
Runtime shutdown permanently disables host installation and admission, starts
independent legacy cleanup, and awaits child scopes separately from the legacy
four-second handler timeout. The process-wide exit backstop can still terminate
the process; it cannot establish raw settlement or release durable holds.

With no installed host, ordinary add-on execution takes the existing execute
path and has no invocation timer or database lease. Session construction does
not install the runtime API; startup remains its sole owner.

## Public transcript subset

`child-request-validation.ts` admits bounded Pi 1.0.3 tool declarations,
system text blocks and tool deltas, assistant text/thinking/tool-call history,
and user/tool-result text and base64 images. Constrained sampling accepts
`false`, `json_schema` with `prefer`/`require`, or declared OpenAI grammar
variants. Tool callbacks, provider options and account/work authority fields
reject. Tool-result bookkeeping, deferred execution and provider diagnostics
are outside this subset and must stay local to the consumer.

JSON has a four-MiB request cap, depth/node limits and prototype-key rejection.
Images require canonical base64 and an image MIME type. Schema admission grants
no host-side tool execution, image pricing permission or filesystem access.
The actual published `read` declaration and a 512-KiB synthetic image are tested.

## Qualification

The current local focused gate passes 84 tests with 320 assertions across eleven
files. All five type projects pass; the compose checker reports 95 unchanged
pre-existing transitive diagnostics. Changed-file Oxlint, logging guards and
`git diff --check` pass. Tests use disposable fixtures and injected hosts, with
no credentials or network inference. A real startup import and public
`DefaultResourceLoader` reload exercise installed-entry ownership.

The bounded peer review identified re-entrant shutdown during `host.createScope`.
Core now publishes the pending close obligation before calling the host and
rechecks authority/plan afterwards. Four held-tail tests cover shutdown, abort,
reload and mismatched plans; tool delivery and shutdown wait for raw close.

The WAL/FULL fixture runs 500 sequential installed-tool invocations with 500
admissions, authorisation checks and scope closes. One plain run took 42.37 ms;
one CPU/JSON-instrumented run took 51.02 ms. The latter counted 1,500 JSON parses
(0.47 ms) and 5,000 serialisations (1.07 ms). One-ms event-loop sampling collected
nine samples, with maxima 4.32 and 6.55 ms. Setup is outside measured wall/CPU;
the CPU artefact includes startup. This small offline workload has injected
scopes and no auth, provider, HTTP, budget reservation or child process. There
is no baseline improvement claim.

Retained failures include initial runtime/type tests, three new edge-case
failures (shutdown reinstallation, changed work context and stream-after-close),
and the initial unsafe-finally lint error. Two independent model reviews timed
out at 240 and 120 seconds; neither supplies approval. A first broad test command
passed only ten lifecycle tests because its cwd-relative glob did not expand;
the explicit-file rerun and final run cover all eleven files.

Frozen `bdf9bf913` / tree `96f07225` passed the isolated full low-priority
`make ci-fast` gate: 6,566 pass, eight opt-in skips, zero failures and 42,879
assertions, plus 25 feature and nine web tests. The full launcher took 673.57 s;
source and tree remained clean and unchanged. One-second `/proc` samples tracked
262 process IDs, including the actual test child at nice 10. Short-lived children
can be missed; sampled RSS/CPU are not complete attribution or leak evidence.
The first full launcher failed before starting because `/usr/bin/time` was absent;
its exit 127 is retained. The replacement Bun sampler launched the passing gate.
See `receipts/child-request-runtime-registration.json` for source hashes and scope.

Publication/hosted checks remain separate. No
installation, restart, provider executor or Delegate production activation is
part of this slice. The next implementation requires public task-owned
authentication/provider handles, account-generation dispatch leases and reviewed
child filesystem/process confinement.
