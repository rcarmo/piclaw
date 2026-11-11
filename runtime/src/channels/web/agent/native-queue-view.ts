/** UI projection of the public SDK inbox. Never persisted as a host queue. */
export interface NativeQueueItem {
  row_id: number;
  /** Steering is placed after the current tool round; a follow-up when the run answers. */
  mode: "steer" | "followUp";
  content: string;
  timestamp: string;
  thread_id: number | null;
  source?: string;
  queued_by?: Record<string, string>;
}
