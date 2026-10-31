import { getDb } from "../../src/db/connection.js";
import { reserveHostRequest } from "./host-request-accounting.js";
import type { HostRegretsBindingOptions } from "./host-regrets-bindings.js";

type Decision = NonNullable<HostRegretsBindingOptions<never>["accountedDecision"]>;
/** Optional transport adapter for parents using host-request-accounting directly.
 * Parents with controller-owned reservations instead pass their accountedDecision
 * callback to createHostRegretsBindings; do not wrap that callback a second time.
 */
export function createHostRegretsAccountedDecision(options: Omit<Parameters<typeof reserveHostRequest>[0], "model" | "maxTokens"> & {
  getAvailable: Decision["getAvailable"];
  /** Transport resolves credentials first, then calls dispatch immediately before send. */
  request(model: Parameters<Decision['complete']>[0], context: Parameters<Decision['complete']>[1],
    options: Parameters<Decision['complete']>[2], dispatch: () => Promise<void>): ReturnType<Decision['complete']>;
}): Decision {
  return {
    getAvailable() { options.assertCurrent(); return options.getAvailable(); },
    async complete(model, context, requestOptions) {
      const signal = requestOptions.signal ? AbortSignal.any([options.signal, requestOptions.signal]) : options.signal;
      const current = () => {
        options.assertCurrent(); signal.throwIfAborted();
        if (!options.getAvailable().some(candidate => candidate.provider === model.provider && candidate.id === model.id && candidate.api === model.api))
          throw Error('Regrets model no longer approved');
      };
      current();
      // Reservation admission uses the application connection; never split ledgers.
      if (getDb() !== options.database) throw Error("Regrets accounting requires the active host Root database");
      const reservation = await reserveHostRequest({ ...options, model, maxTokens: requestOptions.maxTokens, signal });
      // No stored account/cost evidence is not permission for a free nested call.
      if (!reservation) throw Error("Regrets model request cannot be accounted");
      try {
        current();
        if (reservation.recoveredTerminal) { reservation.assertRecoveredCurrent(); current(); return reservation.recoveredTerminal; }
        const message = await options.request(model, context, { ...requestOptions, signal }, async () => {
          current(); await reservation.dispatch(); current();
        });
        // Settle original evidence even if authority was revoked while awaiting.
        await reservation.settle(message);
        current(); return message;
      } finally { await reservation.abandon(); }
    },
  };
}
