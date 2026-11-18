// SPDX-License-Identifier: Apache-2.0
import type { ConversationId } from "@earendil-works/pi-durable";
import type { JsonObject } from "@earendil-works/pi-ai";
import type { JsonValue } from "@earendil-works/chord/json";
import type { Observation, Scope, ToolInfo } from "../core/types.ts";
import type { ToolMapping } from "../core/observations.ts";

/** Trusted host metadata. Never derive these identities from tool/model arguments. */
export type HostSession = {
  id: string; conversationId: ConversationId; scope: Scope; repositoryRoot: string;
  environmentRevision: string; classificationGroup: string; delegated: boolean;
  /**
   * Set for a subagent: the ID of its parent's learning session in the same scope. A subagent receives the parent's
   * frozen facts and its own loop guard; its tool use reaches the parent's evidence through the host trajectory. It has
   * no learning session, fold or tool mask of its own: hosts copy the parent's tool settings when creating it.
   */
  parent?: string;
};
export type CatalogueSnapshot = {
  revision: string; source: string; complete: boolean; tools: ToolInfo[];
};
export type Trajectory =
  | { kind: "ready"; cutoff: string; observations: Observation[]; prompts: number | null; transcriptActivity: number }
  | { kind: "absent"; reason: string }
  | { kind: "later"; reason: string }
  | { kind: "unreadable"; reason: string };
export type SessionStart = {
  event: "startup" | "new" | "resume" | "fork" | "reload";
  visibleHistory: boolean; carriedSections: Record<string, string>;
  /** A resumed in-flight run keeps its already prepared mask until an idle start. */
  runningMask?:string[];
  /** Exclusive committed boundary: inherited fork history must not earn new fact votes. */
  learningAfter?:string;
};
/** A host may expose its own committed receipts without leaking their document type. */
export type ReceiptAdapter = {
  observations(session: HostSession, cutoff: string): Promise<Observation[]>;
};
export type ToolResultData = {name:string;structured:JsonValue|null;details:JsonValue|null;output:string;isError:boolean;diagnostics:{code:string;message:string}[]};
export type DecodedResult = {output:string;exitCode:number|null;timedOut:boolean;aborted:boolean;coverage:"complete"|"partial"};
export type HostDomain = {
  integrationId: string;
  session(conversationId: ConversationId): Promise<HostSession | null>;
  tool(name: string): ToolMapping;
  arguments(name:string,args:JsonObject): {command:string;targets:string[];coverage:"complete"|"partial"};
  decode(result:ToolResultData): DecodedResult;
  catalogue(session: HostSession): Promise<CatalogueSnapshot>;
  setTools(session:HostSession,excluded:string[],expiresAt?:number):Promise<void>;
  /** Hosts opting into incremental learning must honour the exclusive after cursor. */
  incrementalLearning?: boolean;
  trajectory(session: HostSession, cutoff: string | null, after?: string | null): Promise<Trajectory>;
  receiptAdapter?: ReceiptAdapter;
};
