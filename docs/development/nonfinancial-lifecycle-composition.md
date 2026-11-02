# Nonfinancial lifecycle composition

The application passes the actual `HostConversationRuntime` to the existing Core adapter. Two explicit operations carry host policy: the optional wait acknowledgement boundary and recovered-maintenance reconciliation. Ordinary operations no longer cross a runtime-wide forwarding Proxy.

## Captured operations

`createDurableConversationAdapter` captures these 18 methods once, with the real runtime as receiver:

- submit, submitIntent, reconcile, cancel, resume, wait, settle and close;
- readSessionState, readSessionContextUsage, readSessionMetadata, readSessionReport and readSessionTree;
- setSessionThinkingLevel, setSessionModel, resetSession, compactSession and reconcileMaintenance.

The adapter reads no runtime data getters, enumerates no properties and performs no dynamic method lookup after capture. The former Proxy was used only at this construction site; the application already exposes the actual runtime through `onRuntime`. Dynamic replacement of ordinary runtime methods cannot redirect an existing adapter.

The explicit wait operation receives the original accepted input, submission ID and observer signal. `wrapWait` still receives a bound real wait operation; its acknowledgement error does not replay provider input. The adapter's wait remains an asynchronous observation boundary. The maintenance operation retains its direct promise return and immutable session target.

Recovered maintenance still checks the live application, incarnation and current chat/branch/conversation route before resuming the controller's same task. Other maintenance reconciliation still calls the runtime. Neither operation admits replacement compaction. No SDK object crosses the Core/private-engine boundary.

## Rollback refusal

The live controller cannot produce the required public storage identity and complete historical mutation frontier. Its rollback attempt still:

1. Rejects a repeated attempt or a controller already closing.
2. Reads and binds both supplied callbacks synchronously. Invalid callbacks fail before sealing or consuming the attempt.
3. Retains ownership and synchronously seals the runtime.
4. Detaches observers, joins entered host calls and underlying waits, and checks actual task/submission quiescence.
5. Refuses before storage close, writer restoration or owner release when historical proof is unavailable.

The guaranteed-unreachable successful restore/release continuation has been removed. The rejecting-callback overload of `quiesceForRollback` records its `Promise<never>` result without a cast or a replacement success path. Ordinary close remains unchanged.

Focused regressions cover callback getter order, invalid argument timing, late callback mutation, held observations, concurrent close, pending/running SDK work, candidate-only commits, retired documents, terminal-record changes, cleanup failure and zero writer flips. Independent host-only/offline cutover and copied-upgrade tools retain their supported behaviour.

## Retained modes and deletion conditions

| Surface | Current consumer or invariant | Deletion condition |
|---|---|---|
| checkpointCutover refusal | Exported host-controller API and its negative qualification; no historical proof is persisted | Explicit live-API retirement approval, or a qualified supported storage/frontier contract |
| rollbackAttempt and retainOwner | One-attempt refusal, concurrent close coordination and retaining the borrowed owner until confirmed cleanup | Approved retirement with equivalent sealing, joins and uncertainty behaviour |
| quiesceForRollback and shutdown's quiescence branch | The live controller joins underlying callbacks and checks tasks before refusing; ordinary close intentionally detaches observers | Approved API retirement and equivalent held-callback/close/owner proofs |
| underlyingWaits | Actual host lookup may continue after its observer detaches; rollback must join it | Remove its last supported quiescent-shutdown consumer, with explicit approval |
| active calls, maintenance and shell/Dream joins | Distinct admitted-call, SDK task and host resource lifetimes | Concrete SDK/host replacement proof for each lifetime; file size is insufficient |

These modes remain under #1890's evidence-backed retention option. Generic implementation permission does not retire an exported API. No normal shutdown join is removed to increase the line reduction.

## Ownership and validation

#1889 owns the forwarding Proxy removal; #1838 owns only the impossible rollback continuation. #1890 records the retained larger mode/API boundary. There is one fewer forwarding stage and one fewer impossible call edge, with no new service, state cache, queue, or resource owner.

#1893's checked-read consolidation was already merged before this change's base and gets no additional credit. #1875/#1880 retains ownership of expense-only dependencies and their removal; their remaining callbacks are outside this nonfinancial change. Reassess the residual composition after that deletion using current callers and resource invariants, rather than extracting more service classes.

The user authorised focused tests only. Validation uses the isolated local launcher for the adapter boundary, actual application/web and bootstrap recovery, host-controller refusal/close, native compaction and independent offline cutover/import regressions. The engine and qualification type projects check the affected public/private contracts. No full CI/native gate, provider probe, deployment or restart is implied by these focused results.
