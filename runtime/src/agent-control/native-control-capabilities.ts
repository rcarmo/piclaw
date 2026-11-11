import type { DurableSessionPositionPort } from "../agent-pool/durable-runtime-adapter.js";
import type { AgentControlCommand } from "./agent-control-types.js";
import { CONTROL_COMMAND_DEFINITIONS } from "./command-registry.js";
import { parseControlCommand } from "./agent-control-parser.js";

export type NativeControlStatus = "native" | "web input" | "web UI" | "unavailable";

/** Display-only capability audit. This table never grants admission or execution. */
export function getNativeControlCapabilities(port: DurableSessionPositionPort): Record<AgentControlCommand["type"], NativeControlStatus> {
  const available = (value: unknown): NativeControlStatus => value ? "native" : "unavailable";
  const auth = port.assertCurrent && port.runOwnedControl && port.lifetimeSignal && !port.lifetimeSignal.aborted;
  return {
    model: available(port.readModel && port.setModel), thinking: available(port.readThinkingLevel && port.setThinkingLevel),
    commands: "native", restart: "native", exit: "native", shell: "native", bash: available(port.runBash),
    queue: "web input", queue_all: "unavailable", steer: "web input", state: "native",
    stats: available(port.readReport), context: available(port.readReport), quota: "native", last: available(port.readReport),
    compact: available(port.compact), auto_compact: available(port.readExecutionPolicy && port.setExecutionPolicy), auto_retry: available(port.readExecutionPolicy && port.setExecutionPolicy), abort: available(port.abort),
    abort_retry: available(port.abortRetry), abort_bash: available(port.abortBash),
    cycle_model: available(port.readModel && port.setModel), cycle_thinking: available(port.readThinkingLevel && port.setThinkingLevel),
    steering_mode: "unavailable", followup_mode: "unavailable", session_name: "unavailable", new_session: available(port.reset),
    switch_session: "unavailable", session_rotate: "unavailable", rollup: "unavailable", fork: "unavailable", clone: "unavailable",
    forks: "unavailable", export_html: "unavailable", passkey: "native", login: available(auth), logout: available(auth),
    totp: "native", qr: "native", search_workspace: "native", tree: available(port.readTree), label: "unavailable", labels: "unavailable",
    agent_name: "native", agent_avatar: "native", user_name: "native", user_avatar: "native", user_github: "native",
  };
}

export function getNativeCommandCatalogue(port: DurableSessionPositionPort) {
  const capabilities = getNativeControlCapabilities(port);
  return CONTROL_COMMAND_DEFINITIONS.map(definition => {
    const type = parseControlCommand(definition.name)?.type ?? null;
    const status: NativeControlStatus = type ? capabilities[type]
      : ["/theme", "/settings"].includes(definition.name) ? "web UI" : "unavailable";
    return { ...definition, type, status };
  });
}
