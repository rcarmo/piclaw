/**
  * agent-pool/omp-rpc/rpc-protocol-types.ts – Wire types for the omp `--mode rpc`
  * ndjson protocol subset piclaw uses.
  *
  * Declared locally rather than imported: omp (@oh-my-pi/pi-coding-agent) is a
  * subprocess, not a piclaw dependency. Shapes verified against
  * D:/oh-my-pi/packages/coding-agent/src/modes/rpc/rpc-types.ts.
  */

export interface RpcHostToolDefinition {
  name: string;
  label?: string;
  description: string;
  /** JSON Schema object — TypeBox schema objects satisfy this directly. */
  parameters: Record<string, unknown>;
  hidden?: boolean;
}

export type RpcCommand =
  | { id?: string; type: "prompt"; message: string }
  | { id?: string; type: "abort" }
  | { id?: string; type: "new_session" }
  | { id?: string; type: "set_host_tools"; tools: RpcHostToolDefinition[] };

export type RpcHostToolResultContent =
  | { type: "text"; text: string }
  | ({ type: "image" } & Record<string, unknown>);

export interface RpcHostToolResult {
  type: "host_tool_result";
  id: string;
  result: { content: RpcHostToolResultContent[]; details?: unknown };
  isError?: boolean;
}

export interface RpcHostToolUpdate {
  type: "host_tool_update";
  id: string;
  partialResult: RpcHostToolResult["result"];
}

export interface RpcHostToolCallFrame {
  type: "host_tool_call";
  id: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface RpcHostToolCancelFrame {
  type: "host_tool_cancel";
  id: string;
  targetId: string;
}

export interface RpcReadyFrame {
  type: "ready";
}

export interface RpcResponseFrame {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface RpcPromptResultFrame {
  type: "prompt_result";
  id?: string;
  agentInvoked: boolean;
}

/**
  * Streaming session-event frames. Member-for-member aligned with piclaw's own
  * AgentEvent union (node_modules/@earendil-works/pi-agent-core/dist/types.d.ts)
  * except: turn_end carries no toolResults here, agent_end carries no willRetry,
  * and tool_execution_update carries partialResult (piclaw uses args instead).
  */
export type RpcSessionEventFrame =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: unknown[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: Record<string, unknown> }
  | { type: "message_start"; message: Record<string, unknown> }
  | { type: "message_update"; message: Record<string, unknown>; assistantMessageEvent: Record<string, unknown> }
  | { type: "message_end"; message: Record<string, unknown> }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool_execution_update"; toolCallId: string; toolName: string; partialResult: unknown }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError?: boolean };

export type RpcInboundFrame =
  | RpcReadyFrame
  | RpcResponseFrame
  | RpcPromptResultFrame
  | RpcSessionEventFrame
  | RpcHostToolCallFrame
  | RpcHostToolCancelFrame;
