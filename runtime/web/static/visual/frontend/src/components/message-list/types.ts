// Shared types for message-list modules

export interface ContentBlock {
  type: "tool_use" | "tool_result" | "text" | "adaptive_card" | "adaptive_card_submission" | string;
  id?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  tool_use_id?: string;
  // Adaptive card fields
  card_id?: string;
  schema_version?: string | number;
  state?: "active" | "completed" | "cancelled" | "failed";
  payload?: Record<string, unknown>;
  fallback_text?: string;
  completed_at?: string;
  last_submission?: unknown;
  // Protected-recovery control/outcome fields
  intent?: string;
  label?: string;
  title?: string;
  detail?: string;
  kind?: string;
  severity?: string;
  source_message_id?: string;
  source_row_id?: number;
  thread_id?: number;
  handoff_depth?: number;
  reason?: string;
  compaction?: string;
  tools_required?: boolean;
  retryable?: boolean;
  recovery_attempts?: number;
  primary_failure_category?: string;
  primary_failure_detail?: string;
  primary_failure_elapsed_ms?: number;
  primary_failure_execution_tools?: boolean;
  primary_failure_had_partial_output?: boolean;
  primary_failure_had_tool_activity?: boolean;
  primary_failure_tool_executions?: number;
  next_action?: string;
}

export interface Interaction {
  id: number;
  type: "user" | "agent";
  content: string;
  content_blocks?: ContentBlock[];
  media_ids?: number[];
  created_at: string;
  data?: Record<string, unknown>;
}

export interface TimelineResponse {
  posts?: Array<Record<string, unknown>>;
  has_more?: boolean;
}
