import { TOOL_PREPARATION_MANIFEST } from "./manifest.js";
import type {
  ToolAbortExpectation,
  ToolContextField,
  ToolEffectClass,
  ToolReplayPolicy,
  ToolServiceEffector,
} from "./types.js";

export type NullAuthorityKind = "query" | "local" | "process" | "harness" | "model" | "credential" | "external" | "unsupported_mixed_authority";

export interface ToolPreparationPolicyEvidence {
  readonly toolName: string;
  readonly effectClass: ToolEffectClass;
  readonly replay: ToolReplayPolicy;
  readonly contextFields: readonly ToolContextField[];
  readonly serviceEffector: ToolServiceEffector;
  readonly abortExpectation: ToolAbortExpectation;
  readonly safeProof: string | null;
  readonly nullAuthorityKind: NullAuthorityKind | null;
  readonly authorityRationale: string;
  readonly contextRationale: string;
  readonly idempotencyIdentity: string | null;
  readonly certainty: string;
  readonly activationPrerequisites: readonly string[];
  readonly activationStatus: "latent";
  readonly currentIntegration: "existing-production-wiring";
  readonly currentServiceEffector: null;
  readonly currentContextSource: string;
  readonly currentAuthorityKind: "repository_file" | "sdk_package" | "external_package";
  readonly currentAuthorityPath: string;
  readonly currentAuthorityDescription: string;
  readonly futureContextFields: readonly ToolContextField[];
  readonly futureServiceEffector: ToolServiceEffector;
  readonly futureIntegrationTarget: string;
}

type PolicyInput = Omit<
  ToolPreparationPolicyEvidence,
  "toolName" | "activationStatus" | "contextRationale" | "currentIntegration" | "currentServiceEffector" | "currentContextSource" | "currentAuthorityKind" | "currentAuthorityPath" | "currentAuthorityDescription" | "futureContextFields" | "futureServiceEffector" | "futureIntegrationTarget"
>;

const CURRENT_AUTHORITY_PATHS: Readonly<Record<string, string>> = Object.freeze({
  chat: "runtime/src/extensions/chat-tool.ts resolves the live session-tree registry and installed one-hop chat transport before delivery.",
  chat_project: "runtime/src/extensions/chat-project.ts validates and persists the current chat's repository through the branch-owned SQLite project store.",
  session_control: "runtime/src/extensions/session-control.ts resolves and mutates the current AgentPool/session registry lane directly.",
  send_adaptive_card: "runtime/src/extensions/send-adaptive-card.ts writes the messages SQLite timeline and broadcasts the adaptive-card block over web SSE to the renderer.",
  send_dashboard_widget: "runtime/src/extensions/send-dashboard-widget.ts writes the messages SQLite timeline and broadcasts widget metadata over web SSE to the pane renderer.",
  attach_file: "runtime/src/extensions/file-attachments.ts uses the attachment registry, workspace filesystem, media persistence, and timeline delivery path.",
  read_attachment: "runtime/src/extensions/file-attachments.ts reads the current attachment/media persistence and returns bounded decoded bytes.",
  export_attachment: "runtime/src/extensions/file-attachments.ts reads attachment/media persistence and writes the workspace tmp filesystem.",
  refresh_workspace_index: "runtime/src/extensions/workspace-search.ts invokes the current workspace FTS indexer and its SQLite-backed index directly.",
  memory_get: "runtime/src/extensions/memory-search.ts reads the admitted SQLite note index and source filesystem; stale files dirty index metadata and enqueue a background refresh.",
  memory_query: "runtime/src/extensions/memory-search.ts searches the bounded admitted SQLite note index and source filesystem; stale candidates dirty index metadata and enqueue a background refresh.",
  open_workspace_file: "runtime/src/extensions/open-workspace-file.ts addresses the active web client and waits for the current SSE/browser acknowledgement path.",
  schedule_task: "runtime/src/extensions/scheduled-tasks.ts writes the scheduled-task SQLite store and wakes the in-process task scheduler.",
  scheduled_tasks: "runtime/src/extensions/scheduled-tasks.ts reads or mutates the scheduled-task SQLite store and in-process task scheduler.",
  budget_status: "runtime/src/extensions/budget-limits.ts reads the current chat's budget caps, usage, provider evidence, work state, and blockers without granting spending authority.",
  messages: "runtime/src/extensions/messages-crud.ts reads or mutates the messages SQLite timeline and uses the current web/SSE broadcast path where applicable.",
});

const CONTEXT_RATIONALE: Readonly<Record<string, string>> = Object.freeze({
  "": "No Piclaw execution context field is required by this catalogue or harness-local operation.",
  env: "env selects the current Earendil execution root and process/filesystem isolation boundary.",
  localEnv: "localEnv selects Piclaw's canonical local workspace without borrowing the remote execution root.",
  chatJid: "chatJid scopes the bounded service/session query to the current conversation.",
  "chatJid,localEnv": "chatJid pins the session binding while localEnv selects the canonical local note/index workspace.",
  "chatJid,operationId": "chatJid selects service authority and operationId supplies the stale-result/idempotency fence.",
  "operationId,localEnv": "operationId fences the asynchronous effect while localEnv selects the local workspace/index boundary.",
  "chatJid,operationId,localEnv": "chatJid selects service authority, operationId fences completion, and localEnv selects the local file/workspace boundary.",
});

const SDK_TOOL_NAMES = new Set(["read", "write", "edit", "bash", "grep", "find", "ls"]);
const MANIFEST_SOURCE_BY_TOOL = new Map(TOOL_PREPARATION_MANIFEST.map((row) => [row.toolName, row.currentSource]));

function currentAuthority(toolName: string): Readonly<{
  kind: ToolPreparationPolicyEvidence["currentAuthorityKind"];
  path: string;
}> {
  if (SDK_TOOL_NAMES.has(toolName)) return Object.freeze({ kind: "sdk_package", path: "package:@earendil-works/pi-coding-agent" });
  if (toolName === "mcp") return Object.freeze({ kind: "external_package", path: "package:pi-mcp-adapter" });
  const source = MANIFEST_SOURCE_BY_TOOL.get(toolName) ?? "";
  const path = source.match(/runtime\/[A-Za-z0-9_./-]+\.ts/)?.[0];
  if (!path) throw new Error(`Missing closed current authority path for ${toolName}`);
  return Object.freeze({ kind: "repository_file", path });
}

function policy(toolNames: readonly string[], input: PolicyInput): readonly ToolPreparationPolicyEvidence[] {
  return Object.freeze(toolNames.map((toolName) => {
    const authority = currentAuthority(toolName);
    return Object.freeze({
    toolName,
    ...input,
    contextFields: Object.freeze([...input.contextFields]),
    contextRationale: CONTEXT_RATIONALE[input.contextFields.join(",")] ?? "The exact context vector requires source review before activation.",
    activationPrerequisites: Object.freeze([...input.activationPrerequisites]),
    activationStatus: "latent" as const,
    currentIntegration: "existing-production-wiring" as const,
    currentServiceEffector: null,
    currentContextSource: "Current production tools retain their existing closure/context plumbing and receive neither PiclawToolContext nor a latent WP-3C service effector.",
    currentAuthorityKind: authority.kind,
    currentAuthorityPath: authority.path,
    currentAuthorityDescription: CURRENT_AUTHORITY_PATHS[toolName] ?? `Current production ${toolName} executes through its released registration, closure dependencies, and ${input.nullAuthorityKind ?? "service"} authority path.`,
    futureContextFields: Object.freeze([...input.contextFields]),
    futureServiceEffector: input.serviceEffector,
    futureIntegrationTarget: input.serviceEffector
      ? `A selected direct tool may call exactly ${input.serviceEffector} after its listed activation prerequisites pass.`
      : "A selected direct tool may use the declared context without acquiring Piclaw service-operation authority.",
    });
  }));
}

function servicePolicy(
  toolNames: readonly string[],
  input: Pick<PolicyInput, "effectClass" | "replay" | "contextFields" | "abortExpectation" | "serviceEffector" | "authorityRationale" | "idempotencyIdentity" | "certainty" | "activationPrerequisites"> & { safeProof?: string },
): readonly ToolPreparationPolicyEvidence[] {
  return policy(toolNames, { ...input, safeProof: input.safeProof ?? null, nullAuthorityKind: null });
}

const DIRECT_QUERY = {
  serviceEffector: null,
  nullAuthorityKind: "query",
  idempotencyIdentity: null,
  certainty: "A fresh bounded read may be discarded and repeated because it commits no mutation.",
  activationPrerequisites: ["selected tagged Harness v3 direct-tool contract"],
} as const;

const entries = Object.freeze([
  ...policy(["read", "grep", "find", "ls"], {
    effectClass: "query", replay: "safe", contextFields: ["env"], abortExpectation: "must_stop",
    ...DIRECT_QUERY,
    safeProof: "ExecutionEnv performs a bounded filesystem read/search with no write path.",
    authorityRationale: "Filesystem query; no Piclaw service-operation authority is mutated.",
  }),
  ...policy(["search_tool_output"], {
    effectClass: "query", replay: "safe", contextFields: ["localEnv"],
    abortExpectation: "may_finish_late", ...DIRECT_QUERY,
    safeProof: "Bounded local output-store lookup has no mutation path.",
    authorityRationale: "Local query; no Piclaw service-operation authority is mutated.",
  }),
  ...policy(["search_workspace"], {
    effectClass: "query", replay: "safe", contextFields: ["localEnv"],
    abortExpectation: "must_stop", ...DIRECT_QUERY,
    safeProof: "Bounded local index lookup has no mutation path.",
    authorityRationale: "Local query; no Piclaw service-operation authority is mutated.",
  }),
  ...policy(["memory_query"], {
    effectClass: "mixed", replay: "never", contextFields: ["chatJid", "localEnv"],
    serviceEffector: null, abortExpectation: "may_finish_late", safeProof: null,
    nullAuthorityKind: "unsupported_mixed_authority",
    authorityRationale: "A stale query candidate dirties note-index SQLite metadata and enqueues reconciliation through workspace-index coordination.",
    idempotencyIdentity: null,
    certainty: "Dirty markers or background refresh requests may persist after cancellation; automatic replay is forbidden.",
    activationPrerequisites: ["separate admitted query and fenced dirty/refresh service authority before direct-tool migration"],
  }),
  ...policy(["memory_get"], {
    effectClass: "mixed", replay: "never", contextFields: ["chatJid", "localEnv"],
    serviceEffector: null, abortExpectation: "may_finish_late", safeProof: null,
    nullAuthorityKind: "unsupported_mixed_authority",
    authorityRationale: "A stale read dirties the note-index SQLite metadata and enqueues reconciliation through existing workspace-index coordination.",
    idempotencyIdentity: null,
    certainty: "A dirty marker or background refresh request may persist after cancellation; automatic replay is forbidden.",
    activationPrerequisites: ["separate admitted query and fenced dirty/refresh service authority before direct-tool migration"],
  }),
  ...policy(["list_tools", "list_scripts", "get_model_state", "list_models", "context_tree_query"], {
    effectClass: "query", replay: "safe", contextFields: [], abortExpectation: "may_finish_late", ...DIRECT_QUERY,
    safeProof: "Deterministic bounded catalogue or selected-state snapshot with no mutation path.",
    authorityRationale: "Harness/catalogue query; no Piclaw service-operation authority is mutated.",
  }),
  ...policy(["introspect_sql", "session_status", "budget_status"], {
    effectClass: "query", replay: "safe", contextFields: ["chatJid"], abortExpectation: "may_finish_late", ...DIRECT_QUERY,
    safeProof: "Read-only bounded service/session snapshot; grammar and action surface reject writes.",
    authorityRationale: "Service projection query; no service-operation authority is mutated.",
  }),
  ...policy(["write", "edit"], {
    effectClass: "mutation", replay: "never", contextFields: ["env"], serviceEffector: null,
    abortExpectation: "may_finish_late", safeProof: null, nullAuthorityKind: "local",
    authorityRationale: "ExecutionEnv filesystem mutation is outside Piclaw service-operation stores.",
    idempotencyIdentity: null, certainty: "A write may land before cancellation; automatic replay is forbidden.",
    activationPrerequisites: ["selected tagged Harness v3 factories", "preserved Earendil path queue and edit diagnostics"],
  }),
  ...policy(["bash", "powershell", "exec_batch", "bun_run"], {
    effectClass: "mutation", replay: "never", contextFields: ["env"], serviceEffector: null,
    abortExpectation: "must_stop", safeProof: null, nullAuthorityKind: "process",
    authorityRationale: "Child-process effects are outside Piclaw service-operation stores.",
    idempotencyIdentity: null, certainty: "Abort must stop the process group; prior external effects may still be unknown.",
    activationPrerequisites: ["selected tagged Harness v3 ExecutionEnv", "single-execution process-group abort evidence"],
  }),
  ...policy(["local_bash"], {
    effectClass: "mutation", replay: "never", contextFields: ["localEnv"], serviceEffector: null,
    abortExpectation: "must_stop", safeProof: null, nullAuthorityKind: "process",
    authorityRationale: "Local child-process effects are outside Piclaw service-operation stores.",
    idempotencyIdentity: null, certainty: "Abort must stop the process group; prior external effects may still be unknown.",
    activationPrerequisites: ["selected tagged Harness v3 local ExecutionEnv", "single-execution process-group abort evidence"],
  }),
  ...policy(["activate_tools", "reset_active_tools", "context_prune"], {
    effectClass: "mutation", replay: "never", contextFields: [], serviceEffector: null,
    abortExpectation: "may_finish_late", safeProof: null, nullAuthorityKind: "harness",
    authorityRationale: "Selected harness/lane state is not Piclaw service-operation authority.",
    idempotencyIdentity: null, certainty: "The selected lane may change before cancellation is observed; no replay.",
    activationPrerequisites: ["selected tagged Harness v3 constructor dependencies", "lane owner/version fence"],
  }),
  ...policy(["provider_quota"], {
    effectClass: "mixed", replay: "never", contextFields: [], serviceEffector: null,
    abortExpectation: "may_finish_late", safeProof: null, nullAuthorityKind: "model",
    authorityRationale: "Provider quota/authentication belongs to the model runtime, not Piclaw service-operation authority.",
    idempotencyIdentity: null, certainty: "Authentication refresh and shared quota/cache work may finish after cancellation; no replay.",
    activationPrerequisites: ["credential-bound model runtime query", "bounded wait with explicit late-operation certainty"],
  }),
  ...policy(["set_model"], {
    effectClass: "mutation", replay: "never", contextFields: [], serviceEffector: null,
    abortExpectation: "may_finish_late", safeProof: null, nullAuthorityKind: "model",
    authorityRationale: "Selected model and thinking state belong to the model runtime, not Piclaw service-operation authority.",
    idempotencyIdentity: null, certainty: "The selected model or effort may change before cancellation is observed; no replay.",
    activationPrerequisites: ["complete model/effort validation before mutation", "public scoped model snapshot"],
  }),
  ...policy(["switch_model", "switch_thinking"], {
    effectClass: "mutation", replay: "never", contextFields: [], serviceEffector: null,
    abortExpectation: "may_finish_late", safeProof: null, nullAuthorityKind: "model",
    authorityRationale: "Selected model/runtime state is not Piclaw service-operation authority.",
    idempotencyIdentity: null, certainty: "The selected lane may change before cancellation is observed; no replay.",
    activationPrerequisites: ["selected tagged Harness v3 model runtime", "lane owner/version fence"],
  }),
  ...policy(["env", "image_process"], {
    effectClass: "mixed", replay: "never", contextFields: ["localEnv"], serviceEffector: null,
    abortExpectation: "may_finish_late", safeProof: null, nullAuthorityKind: "local",
    authorityRationale: "Workspace configuration and image/filesystem effects are outside service-operation authority.",
    idempotencyIdentity: null, certainty: "Action-specific local mutations can finish after cancellation; no replay.",
    activationPrerequisites: ["action split or retained conservative mixed policy", "selected tagged Harness v3 local ExecutionEnv"],
  }),
  ...policy(["keychain"], {
    effectClass: "mixed", replay: "never", contextFields: ["chatJid", "operationId"], serviceEffector: null,
    abortExpectation: "may_finish_late", safeProof: null, nullAuthorityKind: "credential",
    authorityRationale: "CredentialStore authority is separate from Piclaw service-operation stores.",
    idempotencyIdentity: null, certainty: "A credential mutation may commit before cancellation; no replay.",
    activationPrerequisites: ["public CredentialStore direct contract", "protected-field observer evidence"],
  }),
  ...policy(["ssh"], {
    effectClass: "mixed", replay: "never", contextFields: ["chatJid", "operationId"], serviceEffector: null,
    abortExpectation: "may_finish_late", safeProof: null, nullAuthorityKind: "external",
    authorityRationale: "SSH profile/connection and remote effects are not service-operation authority.",
    idempotencyIdentity: null, certainty: "Remote connection or command effects may be unknown after disconnect; no replay.",
    activationPrerequisites: ["selected tagged Harness v3 environment selection", "remote certainty remains conservative"],
  }),
  ...policy(["cdp_browser"], {
    effectClass: "mixed", replay: "never", contextFields: ["localEnv"], serviceEffector: null,
    abortExpectation: "may_finish_late", safeProof: null, nullAuthorityKind: "external",
    authorityRationale: "Browser and output-file effects are external/local, not service-operation authority.",
    idempotencyIdentity: null, certainty: "A browser action may land before abort; no replay.",
    activationPrerequisites: ["action split or retained conservative mixed policy", "direct browser abort evidence"],
  }),
  ...policy(["mcp"], {
    effectClass: "mixed", replay: "never", contextFields: ["chatJid", "operationId", "localEnv"], serviceEffector: null,
    abortExpectation: "may_finish_late", safeProof: null, nullAuthorityKind: "external",
    authorityRationale: "MCP discovery/auth/remote calls are external and not service-operation authority.",
    idempotencyIdentity: null, certainty: "Remote mutation certainty may be unknown after disconnect; no replay.",
    activationPrerequisites: ["exact selected adapter contract", "tool-specific review before any direct safe policy"],
  }),
  ...policy(["messages"], {
    effectClass: "mixed", replay: "never", contextFields: ["chatJid", "operationId"], serviceEffector: null,
    abortExpectation: "may_finish_late", safeProof: null, nullAuthorityKind: "unsupported_mixed_authority",
    authorityRationale: "add/post are future EF-S03 candidates; delete/move lack closed arbitrary-history authority.",
    idempotencyIdentity: null, certainty: "Activation is blocked; no mixed action is replayed.",
    activationPrerequisites: ["separately approved fenced administrative timeline authority or delete/move retirement"],
  }),

  ...servicePolicy(["chat"], {
    effectClass: "mutation", replay: "never", contextFields: ["chatJid", "operationId"], abortExpectation: "may_finish_late", serviceEffector: "EF-S01",
    authorityRationale: "ServiceWorkStore owns accepted cross-session work before wake intent.", idempotencyIdentity: "source ID plus request hash",
    certainty: "Equal identity reconciles; changed hash conflicts; stale wake results are ignored.", activationPrerequisites: ["EF-S01 accepted-source API", "owner/version fence", "selected tagged Harness v3"],
  }),
  ...policy(["chat_project"], {
    effectClass: "mutation", replay: "never", contextFields: ["chatJid", "operationId"], serviceEffector: null,
    abortExpectation: "may_finish_late", safeProof: null, nullAuthorityKind: "unsupported_mixed_authority",
    authorityRationale: "The current branch-owned SQLite project setting has no approved WP-3C service effector.",
    idempotencyIdentity: null, certainty: "The SQLite mutation may commit before cancellation; automatic replay is forbidden.",
    activationPrerequisites: ["separately approved branch-settings service authority"],
  }),
  ...servicePolicy(["session_control"], {
    effectClass: "mixed", replay: "never", contextFields: ["chatJid", "operationId"], abortExpectation: "may_finish_late", serviceEffector: "EF-S01",
    authorityRationale: "Mutating control paths persist cancellation/queue authority in ServiceWorkStore.", idempotencyIdentity: "operation ID and owner/version plus request hash",
    certainty: "Stale lane results fail the owner/version fence.", activationPrerequisites: ["query/mutation dispatch", "EF-S01 control API", "selected harness/lane dependency"],
  }),
  ...servicePolicy(["send_adaptive_card", "send_dashboard_widget"], {
    effectClass: "mutation", replay: "never", contextFields: ["chatJid", "operationId"], abortExpectation: "may_finish_late", serviceEffector: "EF-S03",
    authorityRationale: "TimelineDraftStore owns non-terminal operation drafts/service notices.", idempotencyIdentity: "operation ID, draft kind and revision plus payload hash",
    certainty: "Equal draft identity reconciles; changed hash conflicts; broadcast remains outside the store.", activationPrerequisites: ["EF-S03 draft API", "post-commit broadcast driver", "selected tagged Harness v3"],
  }),
  ...servicePolicy(["attach_file"], {
    effectClass: "mutation", replay: "never", contextFields: ["chatJid", "operationId", "localEnv"], abortExpectation: "may_finish_late", serviceEffector: "EF-S04",
    authorityRationale: "OperationMediaStore owns upload metadata and operation/media binding.", idempotencyIdentity: "upload ID plus digest/request hash and operation/media/role binding",
    certainty: "Exact upload/binding reconciles; bytes never enter traces.", activationPrerequisites: ["EF-S04 upload/bind API", "bounded local file read", "selected tagged Harness v3"],
  }),
  ...servicePolicy(["read_attachment"], {
    effectClass: "query", replay: "safe", contextFields: ["chatJid", "operationId"], abortExpectation: "may_finish_late", serviceEffector: "EF-S04",
    safeProof: "Exact bounded MediaRef lookup has no mutation path.", authorityRationale: "OperationMediaStore is the sole media metadata/bytes authority.",
    idempotencyIdentity: "operation/media reference", certainty: "Read result can be discarded and repeated.", activationPrerequisites: ["EF-S04 bounded read API", "selected tagged Harness v3"],
  }),
  ...servicePolicy(["export_attachment"], {
    effectClass: "mixed", replay: "never", contextFields: ["chatJid", "operationId", "localEnv"], abortExpectation: "may_finish_late", serviceEffector: "EF-S04",
    authorityRationale: "OperationMediaStore supplies the sole service read before a local filesystem write.", idempotencyIdentity: "operation/media reference; local export has no replay identity",
    certainty: "Local export may finish late; no second service store is involved and no replay occurs.", activationPrerequisites: ["EF-S04 bounded read API", "local output fence", "selected tagged Harness v3"],
  }),
  ...servicePolicy(["refresh_workspace_index"], {
    effectClass: "mutation", replay: "never", contextFields: ["operationId", "localEnv"], abortExpectation: "may_finish_late", serviceEffector: "EF-S05",
    authorityRationale: "ServiceOutboxStore owns the index-refresh effect request.", idempotencyIdentity: "effect/outbox ID plus request hash",
    certainty: "Driver records applied, not-applied or unknown; model-visible tool is never replayed.", activationPrerequisites: ["EF-S05 enqueue API", "separate index driver", "selected tagged Harness v3"],
  }),
  ...servicePolicy(["open_workspace_file"], {
    effectClass: "mutation", replay: "never", contextFields: ["chatJid", "operationId", "localEnv"], abortExpectation: "may_finish_late", serviceEffector: "EF-S05",
    authorityRationale: "ServiceOutboxStore owns the browser UI open request.", idempotencyIdentity: "effect/outbox ID plus request hash",
    certainty: "Driver records applied, not-applied or unknown; stale UI completion is fenced.", activationPrerequisites: ["EF-S05 enqueue API", "browser UI driver", "selected tagged Harness v3"],
  }),
  ...servicePolicy(["schedule_task"], {
    effectClass: "mutation", replay: "never", contextFields: ["chatJid", "operationId"], abortExpectation: "may_finish_late", serviceEffector: "EF-S07",
    authorityRationale: "ScheduledRunStore owns task/run occurrence authority.", idempotencyIdentity: "task ID plus scheduled occurrence/run ID and request hash",
    certainty: "Lease/version and equal/conflicting completion reconcile; tool is not replayed.", activationPrerequisites: ["EF-S07 task mutation API", "lease/version fence", "selected tagged Harness v3"],
  }),
  ...servicePolicy(["scheduled_tasks"], {
    effectClass: "mixed", replay: "never", contextFields: ["chatJid", "operationId"], abortExpectation: "may_finish_late", serviceEffector: "EF-S07",
    authorityRationale: "ScheduledRunStore owns mutating task actions and bounded task snapshots.", idempotencyIdentity: "task ID plus scheduled occurrence/run ID and request hash",
    certainty: "Mutations use lease/version fences; mixed action surface is never replayed.", activationPrerequisites: ["query/mutation dispatch", "EF-S07 task API", "selected tagged Harness v3"],
  }),

]);

const policyByToolName = new Map(entries.map((entry) => [entry.toolName, entry]));

/** Closed lookup without exposing Map mutation methods. */
export function getToolPreparationPolicy(toolName: string): ToolPreparationPolicyEvidence | undefined {
  return policyByToolName.get(toolName);
}

/** Deeply frozen evidence snapshot for audits and tests. */
export function listToolPreparationPolicies(): readonly ToolPreparationPolicyEvidence[] {
  return entries;
}
