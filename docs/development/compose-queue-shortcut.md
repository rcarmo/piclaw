# Compose submission shortcuts and draft safety

The web composer uses these keyboard shortcuts:

- Enter submits normally; a busy chat queues a follow-up.
- Ctrl+Enter or Cmd+Enter requests steering, even if the browser has not yet received a busy-state update.
- Shift+Enter inserts a newline.

Search-mode behaviour and model/session popup pinning shortcuts remain separate. IME composition, already-handled events, repeats, and Alt combinations do not submit through the steering shortcut. Classic recognises the shortcut before mention/slash autocomplete consumes Enter.

## Starting-turn boundary

A processing lane becomes busy when work is scheduled, before its callback executes. A protected agent run is active before SDK hydration or prompting sets `isStreaming`. Admission now checks these in-memory states as well as streaming/compaction/retry activity. Passive session prewarming alone does not imply an active run.

A streaming session accepts steering through the existing SDK path. If no stream can accept the correction yet, the web handler records a durable follow-up using the existing guarded queue admission. It acknowledges that fallback as a follow-up, not as successful steering. This also covers a stream ending during delivery and a new turn starting while the request waits for storage. Pending startup input is not inserted as an ordinary row that a current turn's cursor could consume. If the chat becomes idle after the queue commit, the existing wake path resumes it.

Fallback admission preserves media IDs, content blocks, link previews and screen hints. Direct browser steering requests timeline persistence through the existing `persist_steer` option; accepted injected input appears as a user timeline message, not an acknowledgement notice. Startup fallback uses the existing follow-up queue card and waits for the normal next-turn boundary. There are no separate queued-status text notices. A persisted request that reaches an ended stream remains one ordinary accepted row in the serialized chat lane, with no extra deferred copy.

## Preserve text when acknowledgement is unconfirmed

The composer decodes and validates an explicit acceptance result before treating the request as successful. A successful HTTP status with malformed JSON, an empty payload or an explicit rejection is not acceptance. Classic uses its existing captured-draft restoration. Text entered during a pending acknowledgement remains available. Errors are visible; the composer never automatically retries uncertain submissions.

Positive queue/steer, durable-message/thread, successful control-command and UI-only acknowledgements remain compatible. A `source_committed` relay receipt takes precedence over a forwarding error; restoring that source as unsent could encourage a duplicate. Uncertain responses advise checking the timeline or queue before retrying.

PR #1617 established the consistent shortcuts and startup-lane safety. The feedback-conventions correction removes its added acknowledgement notices, restores direct timeline input for browser steering and retains the draft-safety protections. No provider, credential, live prompt, configuration, installation or restart changes were made.
