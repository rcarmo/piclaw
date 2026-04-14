#!/usr/bin/env bun

import { appendFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type RootGate = {
  id: string;
  label: string;
  command: string;
};

type GroupDefinition = {
  id: string;
  label: string;
  notes: string;
  match: (relativePath: string) => boolean;
};

type AttemptResult = {
  attempt: number;
  startedAt: string;
  finishedAt: string;
  durationSec: number;
  exitCode: number;
  signalCode: string | null;
  timedOut: boolean;
  passed: boolean;
  command: string;
  logPath: string;
};

type GateResult = {
  kind: "root_gate";
  id: string;
  label: string;
  command: string;
  status: "pass" | "fail";
  durationSec: number;
  logPath: string;
  attempt: AttemptResult;
};

type GroupResult = {
  kind: "deterministic_group";
  id: string;
  label: string;
  notes: string;
  command: string;
  files: string[];
  status: "pass" | "consistent_fail" | "flake" | "infra_fail";
  durationSec: number;
  logPaths: string[];
  attempts: AttemptResult[];
  failureExcerpt: string[];
};

type FollowupDraft = {
  id: string;
  title: string;
  slug: string;
  category: "flake" | "consistent_fail" | "infra_fail";
  groupId: string;
  groupLabel: string;
  command: string;
  logPaths: string[];
  artifactPath: string;
  artifactTicketPath: string;
  boardTicketPath: string | null;
  excerpt: string[];
  fileCount: number;
  files: string[];
};

const repoRoot = path.resolve(import.meta.dir, "..");
const runtimeDir = path.join(repoRoot, "runtime");
const runtimeTestDir = path.join(runtimeDir, "test");
const timestamp = formatTimestamp(new Date());
const artifactBaseDir = process.env.PICLAW_AUDIT_ARTIFACT_BASE
  ? path.resolve(repoRoot, process.env.PICLAW_AUDIT_ARTIFACT_BASE)
  : path.join(repoRoot, "artifacts", "baseline-quality-deterministic");
const artifactDir = process.env.PICLAW_AUDIT_RUN_DIR
  ? path.resolve(repoRoot, process.env.PICLAW_AUDIT_RUN_DIR)
  : path.join(artifactBaseDir, timestamp);
const logDir = path.join(artifactDir, "logs");
const followupDir = path.join(artifactDir, "followups");
const isolatedStateDir = path.join(artifactDir, "isolated-state");
const isolatedWorkspaceDir = path.join(isolatedStateDir, "workspace");
const isolatedStoreDir = path.join(isolatedStateDir, "store");
const isolatedDataDir = path.join(isolatedStateDir, "data");
const boardFollowupDir = process.env.PICLAW_AUDIT_KANBAN_FOLLOWUP_DIR
  ? path.resolve(repoRoot, process.env.PICLAW_AUDIT_KANBAN_FOLLOWUP_DIR)
  : null;
const runLogPath = path.join(artifactDir, "run.log");
const manifestPath = path.join(artifactDir, "manifest.json");
const summaryJsonPath = path.join(artifactDir, "summary.json");
const summaryMarkdownPath = path.join(artifactDir, "summary.md");
const followupsMarkdownPath = path.join(artifactDir, "followups.md");
const requiredArtifactPaths = [
  runLogPath,
  manifestPath,
  summaryJsonPath,
  summaryMarkdownPath,
  followupsMarkdownPath,
];
const groupRetryLimit = 3;
const groupRepeatCount = Math.max(1, Number.parseInt(process.env.PICLAW_AUDIT_REPEAT_COUNT ?? "1", 10) || 1);
const groupAttemptCeiling = Math.max(groupRetryLimit, groupRepeatCount);
const gateTimeoutMs = 5 * 60 * 1000;
const groupTimeoutMs = 10 * 60 * 1000;

const rootGates: RootGate[] = [
  { id: "lint", label: "lint", command: "bun run lint" },
  { id: "typecheck", label: "typecheck", command: "bun run typecheck" },
  { id: "pack-hygiene", label: "check:pack-hygiene", command: "bun run check:pack-hygiene" },
  { id: "stale-dist", label: "check:stale-dist", command: "bun run check:stale-dist" },
  { id: "import-boundaries", label: "check:import-boundaries", command: "bun run check:import-boundaries" },
  { id: "unused-exports", label: "check:unused-exports", command: "bun run check:unused-exports" },
  { id: "hook-tdz", label: "check:hook-tdz", command: "bun run check:hook-tdz" },
];

function basenameIsOneOf(relativePath: string, names: string[]): boolean {
  return names.includes(path.posix.basename(relativePath));
}

function isAppShellTest(relativePath: string): boolean {
  return path.posix.basename(relativePath).startsWith("app-");
}

function isAppRemoteWorkspaceTest(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath);
  return isAppShellTest(relativePath) && /(workspace|remote|vnc)/.test(basename);
}

function isAppRenderingPaneTest(relativePath: string): boolean {
  const basename = path.posix.basename(relativePath);
  return isAppShellTest(relativePath)
    && /(pane|render|widget|preview)/.test(basename)
    && !isAppRemoteWorkspaceTest(relativePath);
}

const groupDefinitions: GroupDefinition[] = [
  {
    id: "root-misc",
    label: "root misc and shell integration",
    notes: "Repo-root deterministic tests that are not nested under a subsystem directory.",
    match: (relativePath) => !relativePath.includes("/"),
  },
  {
    id: "agent-control",
    label: "agent control",
    notes: "Slash-command parsing, handlers, search helpers, rotation, and auth control flows.",
    match: (relativePath) => relativePath.startsWith("agent-control/"),
  },
  {
    id: "agent-pool",
    label: "agent pool",
    notes: "Session lifecycle, branch lifecycle, usage accounting, and tool orchestration.",
    match: (relativePath) => relativePath.startsWith("agent-pool/"),
  },
  {
    id: "agent-memory",
    label: "agent memory and daily-note refresh",
    notes: "Dream memory refresh, daily-note summarisation, and sparse memory sidecar coverage.",
    match: (relativePath) => relativePath.startsWith("agent-memory/"),
  },
  {
    id: "channels-web-agent-flow",
    label: "channels web agent flow",
    notes: "Agent dispatch, queueing, streaming, recovery, timeline, and chat-flow behavior in the web channel.",
    match: (relativePath) =>
      relativePath.startsWith("channels/web/") &&
      basenameIsOneOf(relativePath, [
        "agent-buffers.test.ts",
        "agent-debug.test.ts",
        "agent-message-handler.test.ts",
        "agent-message-store.test.ts",
        "agent-pool-binder.test.ts",
        "agents-service.test.ts",
        "message-processing-storage-service.test.ts",
        "adaptive-card-side-prompt-service.test.ts",
        "agent-control-plane-service.test.ts",
        "agent-message-entry-service.test.ts",
        "agent-peer-message-relay-service.test.ts",
        "agent-status-store.test.ts",
        "agent-status.test.ts",
        "chat-isolation.test.ts",
        "chat-run-control.test.ts",
        "followup-placeholders.test.ts",
        "interaction-broadcaster.test.ts",
        "message-write-flows.test.ts",
        "message-write-service.test.ts",
        "pending-steering.test.ts",
        "post-mutations.test.ts",
        "queued-followup-lifecycle-service.test.ts",
        "recovery.test.ts",
        "runtime-followup-facade-service.test.ts",
        "runtime-state-service.test.ts",
        "session-broadcast-service.test.ts",
        "timeline-service.test.ts",
        "ui-meters-commands.test.ts",
        "web-agent-streaming.test.ts",
        "web-channel-adaptive-card-side-prompt-delegation.test.ts",
        "web-channel-agent-control-plane-delegation.test.ts",
        "web-channel-agent-message-entry-delegation.test.ts",
        "web-channel-message-processing-storage-delegation.test.ts",
        "web-channel-peer-message-relay-delegation.test.ts",
        "web-channel-message-write-delegation.test.ts",
        "web-channel-recovery-state.test.ts",
        "web-channel-runtime-followup-delegation.test.ts",
        "web-channel-runtime-public-surface-delegation.test.ts",
        "web-channel-runtime-public-surface-service.test.ts",
        "web-channel.test.ts",
        "web-response-service.test.ts",
        "web-sse-client.test.ts",
        "tool-status-hints.test.ts",
        "agent-command-status-title.test.ts",
      ]),
  },
  {
    id: "channels-web-auth-security",
    label: "channels web auth and security",
    notes: "Authentication, session protection, TOTP/WebAuthn, proxy sensitivity, and security hardening coverage.",
    match: (relativePath) =>
      relativePath.startsWith("channels/web/") &&
      basenameIsOneOf(relativePath, [
        "auth-endpoints.test.ts",
        "auth-gateway.test.ts",
        "auth-runtime.test.ts",
        "auth.test.ts",
        "identity-endpoints.test.ts",
        "internal-secret.test.ts",
        "proxy-sensitive-flows.test.ts",
        "security-hardening.test.ts",
        "security.test.ts",
        "session-auth.test.ts",
        "totp-auth.test.ts",
        "totp-card.test.ts",
        "request-origin.test.ts",
        "totp-failure-tracker.test.ts",
        "webauthn-auth.test.ts",
        "webauthn-challenges.test.ts",
        "webauthn-enrol-page.test.ts",
      ]),
  },
  {
    id: "channels-web-http-routes",
    label: "channels web http and route surfaces",
    notes: "Endpoint context creation, HTTP dispatch surfaces, route classification, and UI/content endpoints.",
    match: (relativePath) =>
      relativePath.startsWith("channels/web/") &&
      basenameIsOneOf(relativePath, [
        "channel-endpoint-context-factory.test.ts",
        "content-endpoints.test.ts",
        "endpoint-contexts.test.ts",
        "http-dispatch-agent.test.ts",
        "http-dispatch-auth.test.ts",
        "http-dispatch-content.test.ts",
        "http-dispatch-media.test.ts",
        "http-dispatch-shell.test.ts",
        "system-metrics.test.ts",
        "web-channel-constructor-wiring-factory.test.ts",
        "http-dispatch-workspace.test.ts",
        "http-rate-limit.test.ts",
        "http-route-classification.test.ts",
        "request-guards.test.ts",
        "channel-endpoint-facade-service.test.ts",
        "extension-routes.test.ts",
        "manifest.test.ts",
        "server-lifecycle-gateway-service.test.ts",
        "sse-hub.test.ts",
        "ui-context.test.ts",
        "ui-endpoints.test.ts",
        "ui-theme-commands.test.ts",
        "web-build.test.ts",
        "web-channel-endpoint-facade-delegation.test.ts",
        "web-channel-http-surface-delegation.test.ts",
        "web-channel-http-surface-service.test.ts",
        "web-channel-lifecycle-special-surface-delegation.test.ts",
        "web-channel-lifecycle-special-surface-service.test.ts",
        "web-control-plane-payloads.test.ts",
        "web-session-broadcast-routing.test.ts",
        "web-session-broadcast-surface.test.ts",
        "web-utils.test.ts",
      ]),
  },
  {
    id: "channels-web-media-workspace-remote",
    label: "channels web media, workspace, and remote surfaces",
    notes: "Media handling, previews, workspace services, adaptive cards/widgets, and remote terminal/VNC services.",
    match: (relativePath) =>
      relativePath.startsWith("channels/web/") &&
      basenameIsOneOf(relativePath, [
        "adaptive-card-actions.test.ts",
        "avatar-service.test.ts",
        "dashboard-widget.test.ts",
        "link-previews.test.ts",
        "media-service.test.ts",
        "post-link-preview-content.test.ts",
        "remote-display-websocket-tcp-bridge.test.ts",
        "terminal-session-service.test.ts",
        "terminal-vnc-http-service.test.ts",
        "vnc-session-service.test.ts",
        "web-channel-terminal-vnc-http-delegation.test.ts",
        "workspace-file-service.test.ts",
        "workspace-git-branch.test.ts",
        "workspace-handlers.test.ts",
        "workspace-service.test.ts",
      ]),
  },
  {
    id: "config-core-db-system",
    label: "config, core, db, and system helpers",
    notes: "Config/env handling plus persistence, IPC, queue, remote, router, tools, and utility helpers.",
    match: (relativePath) => [
      "config/",
      "core/",
      "db/",
      "ipc/",
      "portainer/",
      "proxmox/",
      "queue/",
      "remote/",
      "router/",
      "secure/",
      "tools/",
      "utils/",
    ].some((prefix) => relativePath.startsWith(prefix))
      || (relativePath.startsWith("channels/") && basenameIsOneOf(relativePath, ["formatting.test.ts", "whatsapp-presence.test.ts"])),
  },
  {
    id: "extensions",
    label: "extensions",
    notes: "Built-in tools, skills, adaptive cards, workspace search, and compaction helpers.",
    match: (relativePath) => relativePath.startsWith("extensions/"),
  },
  {
    id: "runtime",
    label: "runtime bootstrap and scheduler",
    notes: "Startup wiring, provider bootstrap, scheduler, composition, and process tracking.",
    match: (relativePath) => relativePath.startsWith("runtime/"),
  },
  {
    id: "scripts",
    label: "scripts and vendoring",
    notes: "Repo maintenance scripts, vendor builds, and audit helper checks.",
    match: (relativePath) => relativePath.startsWith("scripts/") || relativePath.startsWith("vendor/"),
  },
  {
    id: "web-ui-interaction-and-state",
    label: "web ui interaction and state",
    notes: "Compose, queue state, session switching, tabs, app resume, routing, and interaction-heavy UI flows.",
    match: (relativePath) =>
      relativePath.startsWith("web/") && (
        basenameIsOneOf(relativePath, [
          "agent-mentions.test.ts",
          "api-routing.test.ts",
          "app-resume.test.ts",
          "branch-lifecycle.test.ts",
          "btw.test.ts",
          "compose-model-refresh.test.ts",
          "chat-window.test.ts",
          "compose-box.test.ts",
          "compose-layout.test.ts",
          "compose-session-switcher.test.ts",
          "mobile-viewport.test.ts",
          "meters.test.ts",
          "notification-focus.test.ts",
          "oobe-state.test.ts",
          "optional-api.test.ts",
          "popup-typeahead.test.ts",
          "queue-state.test.ts",
          "status-dot.test.ts",
          "status-panel-shortcuts.test.ts",
          "tool-git-context.test.ts",
          "status-duration.test.ts",
          "status-git-label.test.ts",
          "status-meta-order.test.ts",
          "tab-source-editor.test.ts",
          "tab-store.test.ts",
          "storage.test.ts",
          "tab-strip.test.ts",
        ])
        || (isAppShellTest(relativePath)
          && !isAppRenderingPaneTest(relativePath)
          && !isAppRemoteWorkspaceTest(relativePath))
      ),
  },
  {
    id: "web-ui-rendering-and-panes",
    label: "web ui rendering and panes",
    notes: "Adaptive cards, markdown/rendering, widgets, pane registration, editor integration, and file/media pane behavior.",
    match: (relativePath) =>
      relativePath.startsWith("web/") && (
        basenameIsOneOf(relativePath, [
          "adaptive-card-input-lock.test.ts",
          "adaptive-card-renderer.test.ts",
          "adaptive-card-submission.test.ts",
          "attachment-preview.test.ts",
          "csv-viewer-pane.test.ts",
          "drawio-pane.test.ts",
          "editor-extension.test.ts",
          "editor-popout-transfer.test.ts",
          "editor-safety.test.ts",
          "extension-ui-events.test.ts",
          "file-pill-open.test.ts",
          "floating-widget-styles.test.ts",
          "generated-widget-host-bridge.test.ts",
          "generated-widget.test.ts",
          "kanban-board-ops.test.ts",
          "kanban-editor-source.test.ts",
          "markdown-live-preview-gating.test.ts",
          "markdown-preview-storage.test.ts",
          "markdown-rendering.test.ts",
          "oobe-panel.test.ts",
          "post-copy-markdown.test.ts",
          "post-runtime-safety.test.ts",
          "mindmap-history.test.ts",
          "mindmap-layout-utils.test.ts",
          "mindmap-pane-source.test.ts",
          "pane-detach-state.test.ts",
          "pane-detach-transfer.test.ts",
          "pane-runtime-safety.test.ts",
          "pane-host-transfer.test.ts",
          "pane-live-transfer.test.ts",
          "pane-popout-contracts.test.ts",
          "pane-registry.test.ts",
          "tab-compare-saved.test.ts",
          "terminal-lifecycle-runtime.test.ts",
          "terminal-pane.test.ts",
          "terminal-theme-runtime.test.ts",
          "theme.test.ts",
          "input-focus-safety.test.ts",
          "video-viewer-pane.test.ts",
          "zip-preview.test.ts",
          "status-hints.test.ts",
        ])
        || isAppRenderingPaneTest(relativePath)
      ),
  },
  {
    id: "web-ui-remote-and-workspace",
    label: "web ui remote and workspace",
    notes: "Workspace preview/scale flows plus client-side remote display and VNC behavior.",
    match: (relativePath) =>
      relativePath.startsWith("web/") && (
        basenameIsOneOf(relativePath, [
          "remote-display-vnc.test.ts",
          "remote-display-wasm-pipeline.test.ts",
          "vnc-auth.test.ts",
          "vnc-input.test.ts",
          "vnc-pane.test.ts",
          "workspace-auto-open.test.ts",
          "workspace-preview-pane.test.ts",
          "workspace-scale.test.ts",
          "workspace-visibility.test.ts",
          "remote-display-gc.test.ts",
          "remote-display-socket.test.ts",
          "window-bridge-safety.test.ts",
          "login-safety.test.ts",
        ])
        || isAppRemoteWorkspaceTest(relativePath)
      ),
  },
];

const excludedPatterns = [
  { reason: "optional browser suite", regex: /\.optional\.test\.ts$/ },
  { reason: "manual-only suite", regex: /\.manual\.test\.ts$/ },
  { reason: "fuzz suite", regex: /\.fuzz\.test\.ts$/ },
];

export function buildAuditCommandEnv(baseEnv: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined) env[key] = value;
  }

  env.TZ = env.TZ ?? "UTC";
  env.LANG = env.LANG ?? "C.UTF-8";
  env.LC_ALL = env.LC_ALL ?? "C.UTF-8";
  env.CI = env.CI ?? "1";
  env.FORCE_COLOR = env.FORCE_COLOR ?? "0";
  env.PICLAW_WORKSPACE = isolatedWorkspaceDir;
  env.PICLAW_STORE = isolatedStoreDir;
  env.PICLAW_DATA = isolatedDataDir;
  env.PICLAW_DB_IN_MEMORY = env.PICLAW_DB_IN_MEMORY ?? "1";

  return env;
}

export async function main(): Promise<void> {
  await mkdir(logDir, { recursive: true });
  await mkdir(followupDir, { recursive: true });
  await mkdir(isolatedWorkspaceDir, { recursive: true });
  await mkdir(isolatedStoreDir, { recursive: true });
  await mkdir(isolatedDataDir, { recursive: true });
  if (boardFollowupDir) {
    await mkdir(boardFollowupDir, { recursive: true });
  }
  await writeFile(runLogPath, "", "utf8");

  const allTestFiles = (await discoverTests(runtimeTestDir)).sort();
  const deterministicFiles: string[] = [];
  const excludedFiles: Array<{ file: string; reason: string }> = [];

  for (const file of allTestFiles) {
    const exclusion = excludedPatterns.find(({ regex }) => regex.test(file));
    if (exclusion) {
      excludedFiles.push({ file, reason: exclusion.reason });
      continue;
    }
    deterministicFiles.push(file);
  }

  const groups = groupDefinitions.map((definition) => ({
    ...definition,
    files: deterministicFiles.filter((file) => definition.match(file)).sort(),
  }));

  const assignedFiles = new Set(groups.flatMap((group) => group.files));
  const unassignedFiles = deterministicFiles.filter((file) => !assignedFiles.has(file));
  const duplicatedFiles = deterministicFiles.filter((file, index, array) => array.indexOf(file) !== index);
  const duplicateAssignments = deterministicFiles.filter((file) => groups.filter((group) => group.files.includes(file)).length > 1);

  if (unassignedFiles.length > 0) {
    throw new Error(`Unassigned deterministic tests: ${unassignedFiles.join(", ")}`);
  }
  if (duplicatedFiles.length > 0) {
    throw new Error(`Duplicate deterministic test entries discovered: ${duplicatedFiles.join(", ")}`);
  }
  if (duplicateAssignments.length > 0) {
    throw new Error(`Deterministic tests assigned to multiple groups: ${Array.from(new Set(duplicateAssignments)).join(", ")}`);
  }

  const listGroupsOnly = process.argv.includes("--list-groups");
  if (listGroupsOnly) {
    for (const group of groups) {
      console.log(`${group.id}\t${group.files.length}\t${group.label}`);
    }
    process.exit(0);
  }

  await appendRunLog(`# baseline quality + deterministic sweep\n`);
  await appendRunLog(`# timestamp: ${timestamp}\n`);
  await appendRunLog(`# repo: ${repoRoot}\n`);
  await appendRunLog(`# artifact_dir: ${artifactDir}\n`);
  await appendRunLog(`# deterministic_files: ${deterministicFiles.length}\n`);
  await appendRunLog(`# excluded_files: ${excludedFiles.length}\n`);
  await appendRunLog(`# group_repeat_count: ${groupRepeatCount}\n`);

  console.log(`AUDIT baseline-quality-deterministic`);
  console.log(`ARTIFACT_DIR ${artifactDir}`);
  console.log(`DETERMINISTIC_FILES ${deterministicFiles.length}`);
  console.log(`EXCLUDED_FILES ${excludedFiles.length}`);
  console.log(`GROUP_REPEAT_COUNT ${groupRepeatCount}`);

  const manifest = {
    createdAt: new Date().toISOString(),
    artifactDir,
    boardFollowupDir,
    groupRepeatCount,
    rootGates,
    deterministicGroups: groups.map((group) => ({
      id: group.id,
      label: group.label,
      notes: group.notes,
      fileCount: group.files.length,
      files: group.files,
    })),
    excludedFiles,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const sweepStarted = Date.now();
  const gateResults: GateResult[] = [];
  for (const gate of rootGates) {
    gateResults.push(await runRootGate(gate));
  }

  const groupResults: GroupResult[] = [];
  for (const group of groups) {
    groupResults.push(await runGroup(group));
  }

  const followupDrafts = await writeFollowups(groupResults);
  const failedRootGates = gateResults.filter((result) => result.status !== "pass").length;
  const failedDeterministicGroups = groupResults.filter((result) => result.status === "consistent_fail" || result.status === "infra_fail").length;
  const flakyGroupsAfter3xRerun = groupResults.filter((result) => result.status === "flake").length;
  const followupTicketsNeeded = followupDrafts.length;
  const deterministicSweepRuntimeSec = secondsSince(sweepStarted);

  const summary = {
    createdAt: new Date().toISOString(),
    artifactDir,
    groupRepeatCount,
    metrics: {
      stability_gap_count: 0,
      deterministic_sweep_runtime_sec: deterministicSweepRuntimeSec,
      failed_root_gates: failedRootGates,
      failed_deterministic_groups: failedDeterministicGroups,
      flaky_groups_after_3x_rerun: flakyGroupsAfter3xRerun,
      missing_artifact_outputs: 0,
      artifact_outputs_present: 0,
      followup_tickets_needed: followupTicketsNeeded,
      unresolved_failures_without_followup_ticket: 0,
    },
    rootGates: gateResults,
    deterministicGroups: groupResults,
    coverage: {
      deterministicFileCount: deterministicFiles.length,
      excludedFileCount: excludedFiles.length,
      excludedFiles,
    },
    followupDrafts,
    followupDestinations: {
      artifactDir: followupDir,
      boardDir: boardFollowupDir,
    },
    requiredArtifacts: requiredArtifactPaths,
    requiredArtifactsPresent: [] as string[],
  };

  await writeFile(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(summaryMarkdownPath, buildSummaryMarkdown(summary), "utf8");

  const requiredArtifactsPresent = requiredArtifactPaths.filter((filePath) => existsSync(filePath));
  const missingArtifactOutputs = requiredArtifactPaths.length - requiredArtifactsPresent.length;
  const unresolvedFailuresWithoutFollowupTicket =
    failedRootGates + failedDeterministicGroups + flakyGroupsAfter3xRerun - followupDrafts.length;
  const stabilityGapCount =
    failedRootGates +
    failedDeterministicGroups +
    flakyGroupsAfter3xRerun +
    missingArtifactOutputs +
    Math.max(unresolvedFailuresWithoutFollowupTicket, 0);

  summary.metrics = {
    stability_gap_count: stabilityGapCount,
    deterministic_sweep_runtime_sec: deterministicSweepRuntimeSec,
    failed_root_gates: failedRootGates,
    failed_deterministic_groups: failedDeterministicGroups,
    flaky_groups_after_3x_rerun: flakyGroupsAfter3xRerun,
    missing_artifact_outputs: missingArtifactOutputs,
    artifact_outputs_present: requiredArtifactsPresent.length,
    followup_tickets_needed: followupTicketsNeeded,
    unresolved_failures_without_followup_ticket: Math.max(unresolvedFailuresWithoutFollowupTicket, 0),
  };
  summary.requiredArtifactsPresent = requiredArtifactsPresent;

  await writeFile(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(summaryMarkdownPath, buildSummaryMarkdown(summary), "utf8");

  console.log(`ROOT_GATES_FAILED ${failedRootGates}`);
  console.log(`DETERMINISTIC_GROUPS_FAILED ${failedDeterministicGroups}`);
  console.log(`DETERMINISTIC_GROUPS_FLAKY ${flakyGroupsAfter3xRerun}`);
  console.log(`FOLLOWUP_TICKETS_NEEDED ${followupTicketsNeeded}`);
  console.log(`SUMMARY_JSON ${summaryJsonPath}`);
  console.log(`SUMMARY_MD ${summaryMarkdownPath}`);
  console.log(`FOLLOWUPS_MD ${followupsMarkdownPath}`);
  if (boardFollowupDir) {
    console.log(`BOARD_FOLLOWUP_DIR ${boardFollowupDir}`);
  }
  console.log(`RUN_LOG ${runLogPath}`);
  console.log(`METRIC stability_gap_count=${stabilityGapCount}`);
  console.log(`METRIC deterministic_sweep_runtime_sec=${deterministicSweepRuntimeSec}`);
  console.log(`METRIC failed_root_gates=${failedRootGates}`);
  console.log(`METRIC failed_deterministic_groups=${failedDeterministicGroups}`);
  console.log(`METRIC flaky_groups_after_3x_rerun=${flakyGroupsAfter3xRerun}`);
  console.log(`METRIC missing_artifact_outputs=${missingArtifactOutputs}`);
  console.log(`METRIC artifact_outputs_present=${requiredArtifactsPresent.length}`);
  console.log(`METRIC followup_tickets_needed=${followupTicketsNeeded}`);

  if (stabilityGapCount > 0) {
    process.exit(1);
  }

  process.exit(0);
}

async function runRootGate(gate: RootGate): Promise<GateResult> {
  const logPath = path.join(logDir, `root-gate-${gate.id}.log`);
  console.log(`RUN root_gate ${gate.id} :: ${gate.command}`);
  const attempt = await runCommand({
    command: gate.command,
    cwd: repoRoot,
    timeoutMs: gateTimeoutMs,
    logPath,
  });
  attempt.attempt = 1;
  const status = attempt.passed ? "pass" : "fail";
  console.log(`${status.toUpperCase()} root_gate ${gate.id} (${attempt.durationSec}s) -> ${logPath}`);
  await appendRunLog(`[root_gate] ${gate.id} ${status} ${attempt.durationSec}s ${logPath}\n`);
  return {
    kind: "root_gate",
    id: gate.id,
    label: gate.label,
    command: gate.command,
    status,
    durationSec: attempt.durationSec,
    logPath,
    attempt,
  };
}

async function runGroup(group: (typeof groups)[number]): Promise<GroupResult> {
  if (group.files.length === 0) {
    throw new Error(`Deterministic group ${group.id} resolved to zero files.`);
  }
  const command = `cd ${shellQuote(runtimeDir)} && PICLAW_DB_IN_MEMORY=1 bun test --max-concurrency=1 --timeout=30000 ${group.files
    .map((file) => shellQuote(path.posix.join("test", file)))
    .join(" ")}`;
  const attempts: AttemptResult[] = [];
  console.log(`RUN deterministic_group ${group.id} (${group.files.length} files, repeat_target=${groupRepeatCount})`);
  for (let attemptIndex = 1; attemptIndex <= groupAttemptCeiling; attemptIndex += 1) {
    const logPath = path.join(logDir, `group-${group.id}-attempt-${attemptIndex}.log`);
    const attempt = await runCommand({
      command,
      cwd: repoRoot,
      timeoutMs: groupTimeoutMs,
      logPath,
    });
    attempt.attempt = attemptIndex;
    attempts.push(attempt);
    const interimStatus = attempt.passed ? "PASS" : attempt.timedOut ? "TIMEOUT" : "FAIL";
    console.log(`${interimStatus} deterministic_group ${group.id} attempt ${attemptIndex}/${groupAttemptCeiling} (${attempt.durationSec}s) -> ${logPath}`);
    await appendRunLog(`[group] ${group.id} attempt=${attemptIndex} passed=${attempt.passed} timeout=${attempt.timedOut} duration=${attempt.durationSec}s log=${logPath}\n`);

    const shouldContinueForSoak = attempt.passed && attemptIndex < groupRepeatCount && attempts.every((entry) => entry.passed);
    if (shouldContinueForSoak) {
      continue;
    }
    if (attemptIndex >= groupAttemptCeiling) {
      break;
    }
    if (attempt.passed) {
      break;
    }
  }

  const passedAttempts = attempts.filter((attempt) => attempt.passed).length;
  const failedAttempts = attempts.length - passedAttempts;
  const timedOutAttempts = attempts.filter((attempt) => attempt.timedOut).length;
  let status: GroupResult["status"];
  if (passedAttempts === attempts.length) {
    status = "pass";
  } else if (passedAttempts > 0 && failedAttempts > 0) {
    status = "flake";
  } else if (timedOutAttempts === attempts.length) {
    status = "infra_fail";
  } else {
    const infraPattern = attempts.some((attempt) => detectInfraFailure(readLogTailSync(attempt.logPath)));
    status = infraPattern ? "infra_fail" : "consistent_fail";
  }

  const durationSec = Number(attempts.reduce((sum, attempt) => sum + attempt.durationSec, 0).toFixed(3));
  const failureExcerpt = status === "pass" ? [] : collectFailureExcerpt(attempts.map((attempt) => attempt.logPath));
  console.log(`${status.toUpperCase()} deterministic_group ${group.id} total=${durationSec}s`);
  return {
    kind: "deterministic_group",
    id: group.id,
    label: group.label,
    notes: group.notes,
    command,
    files: group.files,
    status,
    durationSec,
    logPaths: attempts.map((attempt) => attempt.logPath),
    attempts,
    failureExcerpt,
  };
}

async function runCommand(options: {
  command: string;
  cwd: string;
  timeoutMs: number;
  logPath: string;
}): Promise<AttemptResult> {
  const startedAt = new Date();
  const proc = Bun.spawn(["bash", "-lc", options.command], {
    cwd: options.cwd,
    env: buildAuditCommandEnv(process.env),
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        // ignore kill races
      }
    }, 5000).unref?.();
  }, options.timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timeoutHandle);

  const finishedAt = new Date();
  const durationSec = Number(((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(3));
  const combined = buildAttemptLog({
    command: options.command,
    cwd: options.cwd,
    startedAt,
    finishedAt,
    durationSec,
    exitCode,
    timedOut,
    stdout,
    stderr,
  });
  await writeFile(options.logPath, combined, "utf8");

  return {
    attempt: 0,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationSec,
    exitCode,
    signalCode: timedOut ? "SIGTERM" : null,
    timedOut,
    passed: exitCode === 0 && !timedOut,
    command: options.command,
    logPath: options.logPath,
  };
}

async function writeFollowups(groupResults: GroupResult[]): Promise<FollowupDraft[]> {
  const drafts: FollowupDraft[] = [];
  let ordinal = 1;
  for (const result of groupResults) {
    if (result.status === "pass") {
      continue;
    }
    const slug = `${String(ordinal).padStart(2, "0")}-${slugify(result.id)}`;
    const title =
      result.status === "flake"
        ? `Stabilize deterministic ${result.label} sweep group`
        : result.status === "infra_fail"
          ? `Repair deterministic ${result.label} audit infrastructure`
          : `Fix deterministic ${result.label} sweep failures`;
    const artifactTicketPath = path.join(followupDir, `${slug}.md`);
    const boardTicketPath = boardFollowupDir ? path.join(boardFollowupDir, `${slug}.md`) : null;
    const draft: FollowupDraft = {
      id: slug,
      title,
      slug,
      category: result.status,
      groupId: result.id,
      groupLabel: result.label,
      command: result.command,
      logPaths: result.logPaths,
      artifactPath: artifactDir,
      artifactTicketPath,
      boardTicketPath,
      excerpt: result.failureExcerpt,
      fileCount: result.files.length,
      files: result.files,
    };
    drafts.push(draft);
    const markdown = buildFollowupTicketMarkdown(draft);
    await writeFile(artifactTicketPath, markdown, "utf8");
    if (boardTicketPath) {
      await writeFile(boardTicketPath, markdown, "utf8");
    }
    ordinal += 1;
  }

  await writeFile(followupsMarkdownPath, buildFollowupsMarkdown(drafts), "utf8");
  return drafts;
}

export function buildSummaryMarkdown(summary: any): string {
  const lines: string[] = [];
  lines.push(`# Baseline quality + deterministic sweep`);
  lines.push("");
  lines.push(`- Timestamp: ${summary.createdAt}`);
  lines.push(`- Artifact dir: \`${summary.artifactDir}\``);
  lines.push(`- Follow-up draft dir: \`${summary.followupDestinations.artifactDir}\``);
  if (summary.followupDestinations.boardDir) {
    lines.push(`- Board follow-up dir: \`${summary.followupDestinations.boardDir}\``);
  }
  lines.push(`- Group repeat count: ${summary.groupRepeatCount}`);
  lines.push(`- Deterministic files covered: ${summary.coverage.deterministicFileCount}`);
  lines.push(`- Explicitly excluded files: ${summary.coverage.excludedFileCount}`);
  lines.push("");
  lines.push(`## Metrics`);
  lines.push("");
  for (const [name, value] of Object.entries(summary.metrics)) {
    lines.push(`- \`${name}\`: ${value}`);
  }
  lines.push("");
  lines.push(`## Root gates`);
  lines.push("");
  for (const gate of summary.rootGates as GateResult[]) {
    lines.push(`- ${gate.status === "pass" ? "PASS" : "FAIL"} \`${gate.id}\` — ${gate.durationSec}s — \`${gate.logPath}\``);
  }
  lines.push("");
  lines.push(`## Deterministic groups`);
  lines.push("");
  for (const group of summary.deterministicGroups as GroupResult[]) {
    lines.push(`- ${group.status.toUpperCase()} \`${group.id}\` (${group.files.length} files, ${group.durationSec}s)`);
    lines.push(`  - Notes: ${group.notes}`);
    lines.push(`  - Command: \`${group.command}\``);
    lines.push(`  - Logs: ${group.logPaths.map((logPath) => `\`${logPath}\``).join(", ")}`);
    if (group.failureExcerpt.length > 0) {
      lines.push(`  - Excerpt:`);
      for (const excerptLine of group.failureExcerpt) {
        lines.push(`    - ${excerptLine}`);
      }
    }
  }
  if (summary.coverage.excludedFiles.length > 0) {
    lines.push("");
    lines.push(`## Explicit exclusions`);
    lines.push("");
    for (const entry of summary.coverage.excludedFiles as Array<{ file: string; reason: string }>) {
      lines.push(`- \`${entry.file}\` — ${entry.reason}`);
    }
  }
  lines.push("");
  lines.push(`## Follow-ups`);
  lines.push("");
  if ((summary.followupDrafts as FollowupDraft[]).length === 0) {
    lines.push(`- None required; all deterministic groups stabilized within the default sweep.`);
  } else {
    for (const draft of summary.followupDrafts as FollowupDraft[]) {
      lines.push(`- ${draft.title} — artifact draft: \`${draft.artifactTicketPath}\``);
      if (draft.boardTicketPath) {
        lines.push(`  - board draft: \`${draft.boardTicketPath}\``);
      }
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function buildFollowupsMarkdown(drafts: FollowupDraft[]): string {
  const lines: string[] = [];
  lines.push(`# Deterministic sweep follow-ups`);
  lines.push("");
  lines.push(`- Artifact dir: \`${artifactDir}\``);
  lines.push(`- Artifact follow-up dir: \`${followupDir}\``);
  if (boardFollowupDir) {
    lines.push(`- Board follow-up dir: \`${boardFollowupDir}\``);
  }
  lines.push(`- Generated at: ${new Date().toISOString()}`);
  lines.push("");
  if (drafts.length === 0) {
    lines.push(`- No follow-up tickets required; every deterministic group finished cleanly.`);
    lines.push("");
    return `${lines.join("\n")}\n`;
  }
  for (const draft of drafts) {
    lines.push(`## ${draft.title}`);
    lines.push("");
    lines.push(`- Category: ${draft.category}`);
    lines.push(`- Group: \`${draft.groupId}\` — ${draft.groupLabel}`);
    lines.push(`- Repro: \`${draft.command}\``);
    lines.push(`- Logs: ${draft.logPaths.map((logPath) => `\`${logPath}\``).join(", ")}`);
    if (draft.excerpt.length > 0) {
      lines.push(`- Failure excerpt:`);
      for (const excerptLine of draft.excerpt) {
        lines.push(`  - ${excerptLine}`);
      }
    }
    lines.push(`- Artifact draft ticket: \`${draft.artifactTicketPath}\``);
    if (draft.boardTicketPath) {
      lines.push(`- Board draft ticket: \`${draft.boardTicketPath}\``);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function buildFollowupTicketMarkdown(draft: FollowupDraft): string {
  const lines: string[] = [];
  lines.push(`---`);
  lines.push(`id: deterministic-sweep-${draft.slug}`);
  lines.push(`title: ${draft.title}`);
  lines.push(`status: next`);
  lines.push(`priority: medium`);
  lines.push(`created: ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`tags:`);
  lines.push(`  - testing`);
  lines.push(`  - deterministic`);
  lines.push(`  - follow-up`);
  lines.push(`---`);
  lines.push("");
  lines.push(`# ${draft.title}`);
  lines.push("");
  lines.push(`## Why`);
  lines.push("");
  lines.push(`The deterministic sweep left the \`${draft.groupId}\` group in a \`${draft.category}\` state after the default 3-attempt rerun policy.`);
  lines.push("");
  lines.push(`## Reproduction`);
  lines.push("");
  lines.push(`- Artifact dir: \`${draft.artifactPath}\``);
  lines.push(`- Artifact ticket path: \`${draft.artifactTicketPath}\``);
  if (draft.boardTicketPath) {
    lines.push(`- Board ticket path: \`${draft.boardTicketPath}\``);
  }
  lines.push(`- Logs: ${draft.logPaths.map((logPath) => `\`${logPath}\``).join(", ")}`);
  lines.push(`- Command: \`${draft.command}\``);
  lines.push(`- Files in scope (${draft.fileCount}):`);
  for (const file of draft.files) {
    lines.push(`  - \`${file}\``);
  }
  if (draft.excerpt.length > 0) {
    lines.push("");
    lines.push(`## Failure excerpt`);
    lines.push("");
    for (const excerptLine of draft.excerpt) {
      lines.push(`- ${excerptLine}`);
    }
  }
  lines.push("");
  lines.push(`## Done when`);
  lines.push("");
  lines.push(`- [ ] The group reruns cleanly under \`bun run audit:baseline-quality-deterministic\`.`);
  lines.push(`- [ ] The corresponding follow-up log snippet is superseded by a clean timestamped artifact run.`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function collectFailureExcerpt(logPaths: string[]): string[] {
  const combined = logPaths
    .flatMap((logPath) => readLogTailSync(logPath))
    .filter((line) => line.trim().length > 0);
  const interesting = combined.filter((line) => /(error|fail|expected|timeout|timed out|exception)/i.test(line));
  const source = interesting.length > 0 ? interesting : combined;
  return source.slice(-8);
}

function readLogTailSync(logPath: string): string[] {
  if (!existsSync(logPath)) {
    return [];
  }
  const text = readFileSync(logPath, "utf8");
  return text.split(/\r?\n/).slice(-80);
}

export async function discoverTests(directory: string, relativePrefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = relativePrefix ? path.posix.join(relativePrefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await discoverTests(absolutePath, relativePath)));
      continue;
    }
    if (entry.isFile() && relativePath.endsWith(".test.ts")) {
      files.push(relativePath);
    }
  }
  return files;
}

function buildAttemptLog(input: {
  command: string;
  cwd: string;
  startedAt: Date;
  finishedAt: Date;
  durationSec: number;
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}): string {
  return [
    `# command: ${input.command}`,
    `# cwd: ${input.cwd}`,
    `# started_at: ${input.startedAt.toISOString()}`,
    `# finished_at: ${input.finishedAt.toISOString()}`,
    `# duration_sec: ${input.durationSec}`,
    `# exit_code: ${input.exitCode}`,
    `# timed_out: ${input.timedOut}`,
    "",
    "## stdout",
    input.stdout.trimEnd(),
    "",
    "## stderr",
    input.stderr.trimEnd(),
    "",
  ].join("\n");
}

function detectInfraFailure(lines: string[]): boolean {
  return lines.some((line) =>
    /(command not found|no such file or directory|permission denied|timed out|eaddrinuse|address already in use|failed to spawn)/i.test(line),
  );
}

function formatTimestamp(value: Date): string {
  return value.toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/, "Z");
}

function secondsSince(startedMs: number): number {
  return Number(((Date.now() - startedMs) / 1000).toFixed(3));
}

function slugify(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function appendRunLog(line: string): Promise<void> {
  await appendFile(runLogPath, line, "utf8");
}

if (import.meta.main) {
  await main();
}
