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
  schema_version?: string;
  state?: "active" | "completed" | "cancelled" | "failed";
  payload?: Record<string, unknown>;
  fallback_text?: string;
  completed_at?: string;
  last_submission?: unknown;
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
