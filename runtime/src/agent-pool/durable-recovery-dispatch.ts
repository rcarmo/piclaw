// INACTIVE existing-worker bridge. No admission, scheduling grant or replacement queue.
import type { DurableConversationOperation } from './durable-runtime-adapter.js';

/** Retains only uncertain committed identities. The supplied submit must be the existing
 * fenced adapter's same-request-ID replay (including public committed binding repair).
 * A boot controller can supply reconcileRecovered to rescan/validate its entire domain. */
export function createDurableRecoveryDispatch(options: {
  assertCurrentWriter(): void;
  submitIntent(input: DurableConversationOperation): Promise<number>;
  reconcileRecovered?(): Promise<void>;
  shutdown: AbortSignal;
}) {
  const assert = options.assertCurrentWriter.bind(options), submit = options.submitIntent.bind(options);
  const reconcile = options.reconcileRecovered?.bind(options), shutdown = options.shutdown;
  const retained = new Map<string, DurableConversationOperation>();
  const listeners = new Set<() => void>();
  let flight: Promise<void> | undefined;
  const notify = () => { for (const wake of [...listeners]) wake(); };
  shutdown.addEventListener('abort', () => { retained.clear(); notify(); }, { once: true });
  return Object.freeze({
    onPendingIntent(input: DurableConversationOperation) {
      assert();
      if (shutdown.aborted) return;
      const copy = structuredClone(input);
      const key = JSON.stringify([copy.claimed.source.chatJid, copy.requestId]);
      const prior = retained.get(key);
      if (prior && JSON.stringify(prior) !== JSON.stringify(copy)) throw Error('Recovery identity conflict');
      retained.set(key, copy);
      notify();
    },
    onReconcile() { assert(); if (!shutdown.aborted) notify(); },
    // Register synchronously; the worker subscribes before reading terminal SQL evidence.
    waitForReconciliation(_identity: unknown, signal: AbortSignal): Promise<void> {
      return new Promise(resolve => {
        const wake = () => { listeners.delete(wake); signal.removeEventListener('abort', wake); resolve(); };
        listeners.add(wake);
        signal.addEventListener('abort', wake, { once: true });
        if (signal.aborted || shutdown.aborted) wake();
      });
    },
    retryRecoveredWork(): Promise<void> {
      if (flight) return flight;
      flight = (async () => {
        assert();
        if (shutdown.aborted) return;
        notify();
        if (reconcile) { await reconcile(); assert(); }
        for (const [key, input] of retained) {
          assert();
          if (shutdown.aborted) return;
          await submit(structuredClone(input)); assert();
          // Successful adapter return proves the public submission binding was repaired.
          // Errors retain the exact identity and propagate to the explicit recovery caller.
          if (!shutdown.aborted) retained.delete(key);
        }
        if (!shutdown.aborted) notify();
      })().finally(() => { flight = undefined; });
      return flight;
    },
  });
}
