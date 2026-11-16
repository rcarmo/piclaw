// Compile-only contract: checked by the normal qualification type project.
import type { AgentRuntimeFacadeOptions } from "../../runtime/src/agent-pool/runtime-facade.js";
import type { DurableSessionPositionPort } from "../../runtime/src/agent-pool/durable-runtime-adapter.js";

declare const options: AgentRuntimeFacadeOptions;
declare const port: DurableSessionPositionPort;
const supported: AgentRuntimeFacadeOptions = { ...options, getDurableSession: (chat: string) => chat ? port : undefined };
// @ts-expect-error The isolated durableSessions map input is retired.
const retired: AgentRuntimeFacadeOptions = { ...options, durableSessions: new Map([["native", port]]) };
// @ts-expect-error Backend lookup takes the exact chat string.
const wrongArgument: AgentRuntimeFacadeOptions = { ...options, getDurableSession: (_chat: number) => port };
// @ts-expect-error A lookup cannot return malformed session identity.
const wrongPort: AgentRuntimeFacadeOptions = { ...options, getDurableSession: () => ({ sessionId: 123, branchId: "main", readPosition: async () => null }) };
void [supported, retired, wrongArgument, wrongPort];
