// SPDX-License-Identifier: Apache-2.0
import type { LiveState } from "@earendil-works/pi-durable";
/** Generation task IDs hand over after every tool round. The admitted input anchor does not. */
export function runIdentity(run:Pick<NonNullable<LiveState["run"]>,"first"|"inputs">):string|null {
  return run.first === undefined && !run.inputs.length ? null : JSON.stringify([run.first ?? null,run.inputs[0] ?? null]);
}
