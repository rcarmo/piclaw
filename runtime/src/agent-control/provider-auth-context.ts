import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AgentControlResult } from "./agent-control-types.js";

/** Host-owned authentication scope. It has no AgentSession execution methods. */
export interface NativeProviderAuthContext {
  readonly kind: "native-provider-auth";
  readonly chatJid: string;
  readonly bindingId: string;
  readonly runtime: ModelRuntime;
  readonly signal: AbortSignal;
  assertCurrent(): void;
  /** Host shutdown joins entered credential operations before releasing ownership. */
  runOwned<T>(operation: () => Promise<T>): Promise<T>;
  activateModel(provider: string, modelId: string): Promise<AgentControlResult>;
}
