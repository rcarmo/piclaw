import "../../helpers.ts";

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";

import { WebAgentPeerMessageRelayService } from "../../../src/channels/web/agent/agent-peer-message-relay-service.js";
import { WebAdaptiveCardSidePromptService } from "../../../src/channels/web/cards/adaptive-card-side-prompt-service.js";
import { WebAgentControlPlaneService } from "../../../src/channels/web/agent/agent-control-plane-service.js";
import { handleAgentMessage } from "../../../src/channels/web/handlers/agent.ts";
import {
  handleAgentRespondRequest,
  handleThoughtVisibilityRequest,
  type UiEndpointsContext,
} from "../../../src/channels/web/endpoints/ui-endpoints.js";
import { runExtensionHookDeterminismAudit } from "../../extensions/extension-hook-determinism-audit.ts";

export const DEFAULT_FUZZ_SEED = 424242;
export const DEFAULT_FUZZ_ITERATIONS = 96;
export const DEFAULT_FUZZ_ARTIFACT_DIR = "artifacts/web-control-plane-fuzz";

interface AuditRunOptions {
  seed?: number;
  iterations?: number;
  artifactDir?: string;
  replayCaseId?: number | null;
}

type FailureCategory = "exception" | "typed_failure" | "extension_hook_order";

interface AuditFailure {
  category: FailureCategory;
  caseId: number;
  seed: number;
  route: string;
  payloadClass: string;
  detail: string;
  requestBody: string;
  responseStatus?: number;
  responseBody?: unknown;
  replayCommand: string;
  artifactPath?: string;
}

export interface WebControlPlaneAuditSummary {
  seed: number;
  iterations: number;
  payload_classes_run: number;
  failing_seeds: number;
  replayable_failures: number;
  typed_payload_failures: number;
  extension_hook_order_failures: number;
  artifact_outputs_present: number;
  targeted_runtime_sec: number;
  web_fuzz_gap_count: number;
  unhandled_exceptions: number;
  typed_failure_gaps: number;
  summaryPath: string;
  latestPath: string;
  corpusPath: string;
  failures: AuditFailure[];
}

interface PayloadSpec {
  payloadClass: string;
  bodyText: string;
  expectedError: string;
}

interface AuditCase {
  route: string;
  payloadClass: string;
  requestBody: string;
  expectedError: string;
  execute: () => Promise<Response>;
}

interface CorpusManifestEntry {
  route: string;
  payloadClasses: string[];
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createUiEndpointContext(): UiEndpointsContext {
  return {
    json: jsonResponse,
    getWorkspaceVisible: () => false,
    setWorkspaceVisible: () => {},
    getWorkspaceShowHidden: () => false,
    setWorkspaceShowHidden: () => {},
    setPanelExpanded: () => {},
    handleUiResponse: () => ({ status: "ok" as const }),
  };
}

function createControlPlaneService(): WebAgentControlPlaneService {
  return new WebAgentControlPlaneService({
    defaultChatJid: "web:default",
    defaultAgentId: "default",
    json: jsonResponse,
    broadcastEvent: () => {},
    queue: {
      enqueue: (task: () => unknown) => task(),
    },
    agentPool: {} as any,
    readNativeQueue: async () => [],
    controlNativeQueue: async () => false,
  });
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}

function buildReplayCommand(seed: number, iterations: number, caseId: number): string {
  return `PICLAW_DB_IN_MEMORY=1 PICLAW_FUZZ_SEED=${seed} PICLAW_FUZZ_ITERATIONS=${iterations} PICLAW_FUZZ_REPLAY_CASE=${caseId} bun run runtime/scripts/web-control-plane-fuzz-audit.ts`;
}

function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function createRequest(pathname: string, bodyText: string): Request {
  return new Request(`https://example.com${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bodyText,
  });
}

function agentMessageCases(rand: () => number): PayloadSpec {
  return pick(rand, [
    { payloadClass: "invalid-json-syntax", bodyText: "{", expectedError: "Invalid JSON" },
    { payloadClass: "json-null", bodyText: "null", expectedError: "JSON body must be an object" },
    { payloadClass: "content-not-string", bodyText: JSON.stringify({ content: 42 }), expectedError: "'content' must be a string" },
    { payloadClass: "invalid-mode", bodyText: JSON.stringify({ content: "hi", mode: "sideways" }), expectedError: "'mode' must be one of: auto, queue, steer" },
    { payloadClass: "invalid-thread-id", bodyText: JSON.stringify({ content: "hi", thread_id: "oops" }), expectedError: "'thread_id' must be a positive integer or null" },
    { payloadClass: "content-blocks-not-array", bodyText: JSON.stringify({ content: "hi", content_blocks: { type: "text" } }), expectedError: "'content_blocks' must be an array" },
    { payloadClass: "media-ids-not-array", bodyText: JSON.stringify({ content: "hi", media_ids: { id: 1 } }), expectedError: "'media_ids' must be an array" },
    { payloadClass: "link-previews-not-array", bodyText: JSON.stringify({ content: "hi", link_previews: "https://example.com" }), expectedError: "'link_previews' must be an array" },
    { payloadClass: "content-too-large", bodyText: JSON.stringify({ content: "x".repeat(100 * 1024 + 1) }), expectedError: "Content too large (max 100 KB)" },
  ]);
}

function queueCases(rand: () => number): PayloadSpec {
  return pick(rand, [
    { payloadClass: "invalid-json-syntax", bodyText: "{", expectedError: "Invalid JSON" },
    { payloadClass: "json-array", bodyText: JSON.stringify([1, 2, 3]), expectedError: "JSON body must be an object" },
    { payloadClass: "missing-row-id", bodyText: JSON.stringify({}), expectedError: "Missing or invalid row_id" },
    { payloadClass: "row-id-string-nan", bodyText: JSON.stringify({ row_id: "NaN" }), expectedError: "Missing or invalid row_id" },
  ]);
}

function thoughtVisibilityCases(rand: () => number): PayloadSpec {
  return pick(rand, [
    { payloadClass: "invalid-json-syntax", bodyText: "{", expectedError: "Invalid JSON" },
    { payloadClass: "json-null", bodyText: "null", expectedError: "JSON body must be an object" },
    { payloadClass: "missing-turn-id", bodyText: JSON.stringify({ panel: "draft", expanded: true }), expectedError: "Missing turn_id" },
  ]);
}

function agentRespondCases(rand: () => number): PayloadSpec {
  return pick(rand, [
    { payloadClass: "invalid-json-syntax", bodyText: "{", expectedError: "Invalid JSON" },
    { payloadClass: "json-null", bodyText: "null", expectedError: "JSON body must be an object" },
    { payloadClass: "missing-request-id", bodyText: JSON.stringify({ outcome: { ok: true } }), expectedError: "Missing or invalid request_id" },
    { payloadClass: "request-id-too-long", bodyText: JSON.stringify({ request_id: "x".repeat(257) }), expectedError: "request_id too long" },
  ]);
}

function branchForkCases(rand: () => number): PayloadSpec {
  return pick(rand, [
    { payloadClass: "invalid-json-syntax", bodyText: "{", expectedError: "Invalid JSON" },
    { payloadClass: "json-null", bodyText: "null", expectedError: "JSON body must be an object" },
    { payloadClass: "json-array", bodyText: JSON.stringify(["bad"]), expectedError: "JSON body must be an object" },
  ]);
}

function branchRenameCases(rand: () => number): PayloadSpec {
  return pick(rand, [
    { payloadClass: "invalid-json-syntax", bodyText: "{", expectedError: "Invalid JSON" },
    { payloadClass: "json-array", bodyText: JSON.stringify(["bad"]), expectedError: "JSON body must be an object" },
    { payloadClass: "missing-agent-name", bodyText: JSON.stringify({ chat_jid: "web:branch" }), expectedError: "Missing agent_name" },
  ]);
}

function branchPruneCases(rand: () => number): PayloadSpec {
  return pick(rand, [
    { payloadClass: "invalid-json-syntax", bodyText: "{", expectedError: "Invalid JSON" },
    { payloadClass: "json-null", bodyText: "null", expectedError: "JSON body must be an object" },
    { payloadClass: "missing-chat-jid", bodyText: JSON.stringify({}), expectedError: "Missing chat_jid" },
  ]);
}

function branchRestoreCases(rand: () => number): PayloadSpec {
  return pick(rand, [
    { payloadClass: "invalid-json-syntax", bodyText: "{", expectedError: "Invalid JSON" },
    { payloadClass: "json-array", bodyText: JSON.stringify(["bad"]), expectedError: "JSON body must be an object" },
    { payloadClass: "missing-chat-jid", bodyText: JSON.stringify({ agent_name: "restored" }), expectedError: "Missing chat_jid" },
  ]);
}

function peerMessageCases(rand: () => number): PayloadSpec {
  return pick(rand, [
    { payloadClass: "invalid-json-syntax", bodyText: "{", expectedError: "Invalid JSON" },
    { payloadClass: "json-null", bodyText: "null", expectedError: "JSON body must be an object" },
    { payloadClass: "missing-source-chat-jid", bodyText: JSON.stringify({ target_chat_jid: "web:other", content: "hello" }), expectedError: "Missing source_chat_jid" },
    { payloadClass: "missing-target", bodyText: JSON.stringify({ source_chat_jid: "web:source", content: "hello" }), expectedError: "Missing target_chat_jid or target_agent_name" },
  ]);
}

function sidePromptCases(rand: () => number): PayloadSpec {
  return pick(rand, [
    { payloadClass: "invalid-json-syntax", bodyText: "{", expectedError: "Invalid JSON" },
    { payloadClass: "json-null", bodyText: "null", expectedError: "JSON body must be an object" },
    { payloadClass: "missing-prompt", bodyText: JSON.stringify({}), expectedError: "Missing or invalid prompt" },
  ]);
}

function sidePromptStreamCases(rand: () => number): PayloadSpec {
  return pick(rand, [
    { payloadClass: "invalid-json-syntax", bodyText: "{", expectedError: "Invalid JSON" },
    { payloadClass: "json-null", bodyText: "null", expectedError: "JSON body must be an object" },
    { payloadClass: "missing-prompt", bodyText: JSON.stringify({ prompt: 123 }), expectedError: "Missing or invalid prompt" },
  ]);
}

function autoresearchStopCases(rand: () => number): PayloadSpec {
  return pick(rand, [
    { payloadClass: "invalid-json-syntax", bodyText: "{", expectedError: "Invalid JSON" },
    { payloadClass: "json-boolean", bodyText: "true", expectedError: "JSON body must be an object" },
    { payloadClass: "json-array", bodyText: JSON.stringify(["bad"]), expectedError: "JSON body must be an object" },
  ]);
}

function autoresearchDismissCases(rand: () => number): PayloadSpec {
  return pick(rand, [
    { payloadClass: "invalid-json-syntax", bodyText: "{", expectedError: "Invalid JSON" },
    { payloadClass: "json-array", bodyText: JSON.stringify(["bad"]), expectedError: "JSON body must be an object" },
    { payloadClass: "json-null", bodyText: "null", expectedError: "JSON body must be an object" },
  ]);
}

function adaptiveCardCases(rand: () => number): PayloadSpec {
  return pick(rand, [
    { payloadClass: "invalid-json-syntax", bodyText: "{", expectedError: "Invalid JSON" },
    { payloadClass: "json-null", bodyText: "null", expectedError: "JSON body must be an object" },
    { payloadClass: "missing-post-id", bodyText: JSON.stringify({ card_id: "card-1", action: { type: "Action.Submit" } }), expectedError: "Missing or invalid post_id" },
    { payloadClass: "invalid-post-id", bodyText: JSON.stringify({ post_id: "nan", card_id: "card-1", action: { type: "Action.Submit" } }), expectedError: "Missing or invalid post_id" },
    { payloadClass: "missing-card-id", bodyText: JSON.stringify({ post_id: 1, action: { type: "Action.Submit" } }), expectedError: "Missing or invalid card_id" },
    { payloadClass: "missing-action-type", bodyText: JSON.stringify({ post_id: 1, card_id: "card-1", action: {} }), expectedError: "Missing or invalid action.type" },
    { payloadClass: "unsupported-action-type", bodyText: JSON.stringify({ post_id: 1, card_id: "card-1", action: { type: "Action.Fly" } }), expectedError: "Unsupported action type: Action.Fly" },
  ]);
}

function buildAuditCase(caseId: number, seed: number): AuditCase {
  const rand = mulberry32(seed + caseId);
  const routeIndex = caseId % 15;

  if (routeIndex === 0) {
    const spec = agentMessageCases(rand);
    return {
      route: "/agent/default/message",
      payloadClass: spec.payloadClass,
      requestBody: spec.bodyText,
      expectedError: spec.expectedError,
      execute: async () => handleAgentMessage(
        { json: jsonResponse } as any,
        createRequest("/agent/default/message", spec.bodyText),
        "/agent/default/message",
        "web:default",
        "default",
      ),
    };
  }

  if (routeIndex === 1) {
    const spec = thoughtVisibilityCases(rand);
    return {
      route: "/agent/thought/visibility",
      payloadClass: spec.payloadClass,
      requestBody: spec.bodyText,
      expectedError: spec.expectedError,
      execute: async () => handleThoughtVisibilityRequest(
        createRequest("/agent/thought/visibility", spec.bodyText),
        createUiEndpointContext(),
      ),
    };
  }

  if (routeIndex === 2) {
    const spec = agentRespondCases(rand);
    return {
      route: "/agent/respond",
      payloadClass: spec.payloadClass,
      requestBody: spec.bodyText,
      expectedError: spec.expectedError,
      execute: async () => handleAgentRespondRequest(
        createRequest("/agent/respond", spec.bodyText),
        createUiEndpointContext(),
      ),
    };
  }

  if (routeIndex === 3) {
    const spec = queueCases(rand);
    return {
      route: "/agent/queue-remove",
      payloadClass: spec.payloadClass,
      requestBody: spec.bodyText,
      expectedError: spec.expectedError,
      execute: async () => createControlPlaneService().handleAgentQueueRemove(
        createRequest("/agent/queue-remove", spec.bodyText),
      ),
    };
  }

  if (routeIndex === 4) {
    const spec = queueCases(rand);
    return {
      route: "/agent/queue-steer",
      payloadClass: spec.payloadClass,
      requestBody: spec.bodyText,
      expectedError: spec.expectedError,
      execute: async () => createControlPlaneService().handleAgentQueueSteer(
        createRequest("/agent/queue-steer", spec.bodyText),
      ),
    };
  }

  if (routeIndex === 5) {
    const spec = branchForkCases(rand);
    return {
      route: "/agent/branch-fork",
      payloadClass: spec.payloadClass,
      requestBody: spec.bodyText,
      expectedError: spec.expectedError,
      execute: async () => createControlPlaneService().handleAgentBranchFork(
        createRequest("/agent/branch-fork", spec.bodyText),
      ),
    };
  }

  if (routeIndex === 6) {
    const spec = branchRenameCases(rand);
    return {
      route: "/agent/branch-rename",
      payloadClass: spec.payloadClass,
      requestBody: spec.bodyText,
      expectedError: spec.expectedError,
      execute: async () => createControlPlaneService().handleAgentBranchRename(
        createRequest("/agent/branch-rename", spec.bodyText),
      ),
    };
  }

  if (routeIndex === 7) {
    const spec = branchPruneCases(rand);
    return {
      route: "/agent/branch-prune",
      payloadClass: spec.payloadClass,
      requestBody: spec.bodyText,
      expectedError: spec.expectedError,
      execute: async () => createControlPlaneService().handleAgentBranchPrune(
        createRequest("/agent/branch-prune", spec.bodyText),
      ),
    };
  }

  if (routeIndex === 8) {
    const spec = branchRestoreCases(rand);
    return {
      route: "/agent/branch-restore",
      payloadClass: spec.payloadClass,
      requestBody: spec.bodyText,
      expectedError: spec.expectedError,
      execute: async () => createControlPlaneService().handleAgentBranchRestore(
        createRequest("/agent/branch-restore", spec.bodyText),
      ),
    };
  }

  if (routeIndex === 9) {
    const spec = peerMessageCases(rand);
    return {
      route: "/agent/peer-message",
      payloadClass: spec.payloadClass,
      requestBody: spec.bodyText,
      expectedError: spec.expectedError,
      execute: async () => new WebAgentPeerMessageRelayService({ json: jsonResponse } as any)
        .handleAgentPeerMessage(createRequest("/agent/peer-message", spec.bodyText)),
    };
  }

  if (routeIndex === 10) {
    const spec = sidePromptCases(rand);
    return {
      route: "/agent/side-prompt",
      payloadClass: spec.payloadClass,
      requestBody: spec.bodyText,
      expectedError: spec.expectedError,
      execute: async () => new WebAdaptiveCardSidePromptService({ json: jsonResponse } as any)
        .handleAgentSidePrompt(createRequest("/agent/side-prompt", spec.bodyText)),
    };
  }

  if (routeIndex === 11) {
    const spec = sidePromptStreamCases(rand);
    return {
      route: "/agent/side-prompt/stream",
      payloadClass: spec.payloadClass,
      requestBody: spec.bodyText,
      expectedError: spec.expectedError,
      execute: async () => new WebAdaptiveCardSidePromptService({ json: jsonResponse } as any)
        .handleAgentSidePromptStream(createRequest("/agent/side-prompt/stream", spec.bodyText)),
    };
  }

  if (routeIndex === 12) {
    const spec = autoresearchStopCases(rand);
    return {
      route: "/agent/autoresearch/stop",
      payloadClass: spec.payloadClass,
      requestBody: spec.bodyText,
      expectedError: spec.expectedError,
      execute: async () => createControlPlaneService().handleAutoresearchStop(
        createRequest("/agent/autoresearch/stop", spec.bodyText),
      ),
    };
  }

  if (routeIndex === 13) {
    const spec = autoresearchDismissCases(rand);
    return {
      route: "/agent/autoresearch/dismiss",
      payloadClass: spec.payloadClass,
      requestBody: spec.bodyText,
      expectedError: spec.expectedError,
      execute: async () => createControlPlaneService().handleAutoresearchDismiss(
        createRequest("/agent/autoresearch/dismiss", spec.bodyText),
      ),
    };
  }

  const spec = adaptiveCardCases(rand);
  return {
    route: "/agent/card-action",
    payloadClass: spec.payloadClass,
    requestBody: spec.bodyText,
    expectedError: spec.expectedError,
    execute: async () => new WebAdaptiveCardSidePromptService({ json: jsonResponse } as any)
      .handleAdaptiveCardAction(createRequest("/agent/card-action", spec.bodyText)),
  };
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  return parseJsonSafely(text);
}

function isStableTypedFailure(responseStatus: number, responseBody: unknown, expectedError: string): boolean {
  if (responseStatus < 400 || responseStatus >= 500) return false;
  if (!responseBody || typeof responseBody !== "object" || Array.isArray(responseBody)) return false;
  const error = (responseBody as { error?: unknown }).error;
  return typeof error === "string" && error.includes(expectedError);
}

function buildExpectedRouteFamilies(): string[] {
  return [
    "/agent/default/message",
    "/agent/thought/visibility",
    "/agent/respond",
    "/agent/queue-remove",
    "/agent/queue-steer",
    "/agent/branch-fork",
    "/agent/branch-rename",
    "/agent/branch-prune",
    "/agent/branch-restore",
    "/agent/peer-message",
    "/agent/side-prompt",
    "/agent/side-prompt/stream",
    "/agent/autoresearch/stop",
    "/agent/autoresearch/dismiss",
    "/agent/card-action",
  ];
}

function buildCorpusManifest(): CorpusManifestEntry[] {
  return [
    {
      route: "/agent/default/message",
      payloadClasses: [
        "invalid-json-syntax",
        "json-null",
        "content-not-string",
        "invalid-mode",
        "invalid-thread-id",
        "content-blocks-not-array",
        "media-ids-not-array",
        "link-previews-not-array",
        "content-too-large",
      ],
    },
    {
      route: "/agent/thought/visibility",
      payloadClasses: ["invalid-json-syntax", "json-null", "missing-turn-id"],
    },
    {
      route: "/agent/respond",
      payloadClasses: ["invalid-json-syntax", "json-null", "missing-request-id", "request-id-too-long"],
    },
    {
      route: "/agent/queue-remove",
      payloadClasses: ["invalid-json-syntax", "json-array", "missing-row-id", "row-id-string-nan"],
    },
    {
      route: "/agent/queue-steer",
      payloadClasses: ["invalid-json-syntax", "json-array", "missing-row-id", "row-id-string-nan"],
    },
    {
      route: "/agent/branch-fork",
      payloadClasses: ["invalid-json-syntax", "json-null", "json-array"],
    },
    {
      route: "/agent/branch-rename",
      payloadClasses: ["invalid-json-syntax", "json-array", "missing-agent-name"],
    },
    {
      route: "/agent/branch-prune",
      payloadClasses: ["invalid-json-syntax", "json-null", "missing-chat-jid"],
    },
    {
      route: "/agent/branch-restore",
      payloadClasses: ["invalid-json-syntax", "json-array", "missing-chat-jid"],
    },
    {
      route: "/agent/peer-message",
      payloadClasses: ["invalid-json-syntax", "json-null", "missing-source-chat-jid", "missing-target"],
    },
    {
      route: "/agent/side-prompt",
      payloadClasses: ["invalid-json-syntax", "json-null", "missing-prompt"],
    },
    {
      route: "/agent/side-prompt/stream",
      payloadClasses: ["invalid-json-syntax", "json-null", "missing-prompt"],
    },
    {
      route: "/agent/autoresearch/stop",
      payloadClasses: ["invalid-json-syntax", "json-boolean", "json-array"],
    },
    {
      route: "/agent/autoresearch/dismiss",
      payloadClasses: ["invalid-json-syntax", "json-array", "json-null"],
    },
    {
      route: "/agent/card-action",
      payloadClasses: [
        "invalid-json-syntax",
        "json-null",
        "missing-post-id",
        "invalid-post-id",
        "missing-card-id",
        "missing-action-type",
        "unsupported-action-type",
      ],
    },
  ];
}

async function writeArtifacts(
  artifactDir: string,
  summary: WebControlPlaneAuditSummary,
): Promise<WebControlPlaneAuditSummary> {
  mkdirSync(artifactDir, { recursive: true });
  const summaryPath = join(artifactDir, `summary-seed-${summary.seed}-iter-${summary.iterations}.json`);
  const latestPath = join(artifactDir, "latest.json");
  const corpusPath = join(artifactDir, "corpus.json");
  const corpus = {
    seed: summary.seed,
    iterations: summary.iterations,
    replay_template: "PICLAW_DB_IN_MEMORY=1 PICLAW_FUZZ_SEED=<seed> PICLAW_FUZZ_ITERATIONS=<iterations> PICLAW_FUZZ_REPLAY_CASE=<caseId> bun run runtime/scripts/web-control-plane-fuzz-audit.ts",
    route_families: buildCorpusManifest(),
  };

  for (const failure of summary.failures) {
    const failurePath = join(artifactDir, `failure-seed-${failure.seed}-case-${failure.caseId}.json`);
    writeFileSync(failurePath, JSON.stringify(failure, null, 2) + "\n");
    failure.artifactPath = failurePath;
  }

  writeFileSync(corpusPath, JSON.stringify(corpus, null, 2) + "\n");
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
  writeFileSync(latestPath, JSON.stringify({ summaryPath, corpusPath, seed: summary.seed, iterations: summary.iterations }, null, 2) + "\n");

  summary.summaryPath = summaryPath;
  summary.latestPath = latestPath;
  summary.corpusPath = corpusPath;
  summary.replayable_failures = new Set(
    summary.failures
      .filter((failure) => Boolean(failure.replayCommand))
      .map((failure) => failure.seed),
  ).size;
  summary.artifact_outputs_present = Number(
    existsSync(summaryPath)
      && existsSync(latestPath)
      && existsSync(corpusPath)
      && summary.failures.every((failure) => Boolean(failure.artifactPath) && existsSync(failure.artifactPath as string)),
  );
  summary.web_fuzz_gap_count =
    summary.unhandled_exceptions
    + summary.typed_failure_gaps
    + summary.extension_hook_order_failures
    + Math.max(0, summary.failing_seeds - summary.replayable_failures)
    + (summary.artifact_outputs_present ? 0 : 1);

  writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

export async function runWebControlPlaneFuzzAudit(options: AuditRunOptions = {}): Promise<WebControlPlaneAuditSummary> {
  const seed = options.seed ?? DEFAULT_FUZZ_SEED;
  const iterations = options.iterations ?? DEFAULT_FUZZ_ITERATIONS;
  const replayCaseId = options.replayCaseId ?? null;
  const artifactDir = resolve(options.artifactDir ?? DEFAULT_FUZZ_ARTIFACT_DIR);
  const startedAt = Date.now();
  const failures: AuditFailure[] = [];
  const failingSeeds = new Set<number>();
  let typedPayloadFailures = 0;
  let typedFailureGaps = 0;
  let unhandledExceptions = 0;

  const caseIds = replayCaseId === null ? Array.from({ length: iterations }, (_, index) => index) : [replayCaseId];
  const sampledRoutes = new Set<string>();

  for (const caseId of caseIds) {
    const auditCase = buildAuditCase(caseId, seed);
    const caseSeed = seed + caseId;
    const replayCommand = buildReplayCommand(seed, iterations, caseId);
    sampledRoutes.add(auditCase.route);

    try {
      const response = await auditCase.execute();
      const responseBody = await readResponseBody(response.clone());
      if (isStableTypedFailure(response.status, responseBody, auditCase.expectedError)) {
        typedPayloadFailures += 1;
        continue;
      }

      typedFailureGaps += 1;
      failingSeeds.add(caseSeed);
      failures.push({
        category: "typed_failure",
        caseId,
        seed: caseSeed,
        route: auditCase.route,
        payloadClass: auditCase.payloadClass,
        detail: `Expected stable typed failure containing ${JSON.stringify(auditCase.expectedError)} but received status=${response.status} body=${JSON.stringify(responseBody)}`,
        requestBody: auditCase.requestBody,
        responseStatus: response.status,
        responseBody,
        replayCommand,
      });
    } catch (error) {
      unhandledExceptions += 1;
      failingSeeds.add(caseSeed);
      failures.push({
        category: "exception",
        caseId,
        seed: caseSeed,
        route: auditCase.route,
        payloadClass: auditCase.payloadClass,
        detail: error instanceof Error ? error.stack || error.message : String(error),
        requestBody: auditCase.requestBody,
        replayCommand,
      });
    }
  }

  const manifestRoutes = buildCorpusManifest().map((entry) => entry.route);
  const expectedRoutes = buildExpectedRouteFamilies();
  const missingRoutes = expectedRoutes.filter((route) => !manifestRoutes.includes(route));
  const extraRoutes = manifestRoutes.filter((route) => !expectedRoutes.includes(route));
  if (missingRoutes.length > 0 || extraRoutes.length > 0) {
    typedFailureGaps += 1;
    failingSeeds.add(seed);
    failures.push({
      category: "typed_failure",
      caseId: caseIds.length > 0 ? caseIds[0] : 0,
      seed,
      route: "artifacts/web-control-plane-fuzz/corpus.json",
      payloadClass: "manifest-coverage",
      detail: `Corpus manifest drift: missing=${JSON.stringify(missingRoutes)} extra=${JSON.stringify(extraRoutes)}`,
      requestBody: JSON.stringify({ expectedRoutes, manifestRoutes }),
      replayCommand: buildReplayCommand(seed, iterations, caseIds.length > 0 ? caseIds[0] : 0),
    });
  }

  if (replayCaseId === null && iterations >= expectedRoutes.length) {
    const unsampledRoutes = expectedRoutes.filter((route) => !sampledRoutes.has(route));
    const unexpectedSampledRoutes = Array.from(sampledRoutes).filter((route) => !expectedRoutes.includes(route));
    if (unsampledRoutes.length > 0 || unexpectedSampledRoutes.length > 0) {
      typedFailureGaps += 1;
      failingSeeds.add(seed);
      failures.push({
        category: "typed_failure",
        caseId: caseIds.length > 0 ? caseIds[0] : 0,
        seed,
        route: "audit/sample-coverage",
        payloadClass: "route-coverage",
        detail: `Sample coverage drift: unsampled=${JSON.stringify(unsampledRoutes)} unexpected=${JSON.stringify(unexpectedSampledRoutes)}`,
        requestBody: JSON.stringify({ expectedRoutes, sampledRoutes: Array.from(sampledRoutes).sort() }),
        replayCommand: buildReplayCommand(seed, iterations, caseIds.length > 0 ? caseIds[0] : 0),
      });
    }
  }

  const extensionAudit = await runExtensionHookDeterminismAudit();
  let extensionHookOrderFailures = 0;
  if (!extensionAudit.ok) {
    extensionHookOrderFailures = 1;
    const caseId = caseIds.length > 0 ? caseIds[0] : 0;
    failures.push({
      category: "extension_hook_order",
      caseId,
      seed,
      route: "extensions/before_agent_start",
      payloadClass: "determinism",
      detail: extensionAudit.detail || "Extension hook ordering diverged.",
      requestBody: "(determinism-audit)",
      replayCommand: buildReplayCommand(seed, iterations, caseId),
    });
    failingSeeds.add(seed);
  }

  const summary: WebControlPlaneAuditSummary = {
    seed,
    iterations: caseIds.length,
    payload_classes_run: caseIds.length,
    failing_seeds: failingSeeds.size,
    replayable_failures: 0,
    typed_payload_failures: typedPayloadFailures,
    extension_hook_order_failures: extensionHookOrderFailures,
    artifact_outputs_present: 0,
    targeted_runtime_sec: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
    web_fuzz_gap_count: 0,
    unhandled_exceptions: unhandledExceptions,
    typed_failure_gaps: typedFailureGaps,
    summaryPath: "",
    latestPath: "",
    corpusPath: "",
    failures,
  };

  return await writeArtifacts(artifactDir, summary);
}

export function printAuditMetrics(summary: WebControlPlaneAuditSummary): void {
  console.log(`METRIC web_fuzz_gap_count=${summary.web_fuzz_gap_count}`);
  console.log(`METRIC payload_classes_run=${summary.payload_classes_run}`);
  console.log(`METRIC failing_seeds=${summary.failing_seeds}`);
  console.log(`METRIC replayable_failures=${summary.replayable_failures}`);
  console.log(`METRIC typed_payload_failures=${summary.typed_payload_failures}`);
  console.log(`METRIC extension_hook_order_failures=${summary.extension_hook_order_failures}`);
  console.log(`METRIC artifact_outputs_present=${summary.artifact_outputs_present}`);
  console.log(`METRIC targeted_runtime_sec=${summary.targeted_runtime_sec}`);
  console.log(`METRIC unhandled_exceptions=${summary.unhandled_exceptions}`);
  console.log(`METRIC typed_failure_gaps=${summary.typed_failure_gaps}`);
  console.log(`ARTIFACT summary=${summary.summaryPath}`);
  console.log(`ARTIFACT latest=${summary.latestPath}`);
  console.log(`ARTIFACT corpus=${summary.corpusPath}`);
}
