/**
 * exit-process – agent-callable tool that gracefully terminates the piclaw process.
 *
 * When the agent needs to restart (e.g. after deploying a new build), it calls
 * this tool as the **last tool call in its turn**. The tool invokes the same
 * graceful shutdown path used by SIGINT/SIGTERM: drain the task queue, dispose
 * all agent sessions (persisting session files), stop the web server and
 * terminal/VNC bridges, then process.exit(0). Supervisor then restarts piclaw
 * with the new code.
 *
 * This replaces the old pattern of scheduling an external `supervisorctl
 * restart` from the deploy script, which could kill the process mid-turn and
 * lose the agent's response.
 */

import { Type } from "typebox";
import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { markPendingShutdown } from "../runtime/shutdown-registry.js";
import { createLogger } from "../utils/logger.js";
import { killTrackedProcesses } from "../utils/process-tracker.js";
import { getActiveSessionCount } from "./session-status.js";

const log = createLogger("extensions.exit-process");

const IS_SUPERVISED = Boolean(process.env.SUPERVISOR_ENABLED);
const RESTART_HINT = IS_SUPERVISED
  ? "Supervisor will restart it automatically."
  : "The process will exit; restart it manually or via your service manager.";

const ExitProcessSchema = Type.Object({
  reason: Type.Optional(Type.String({ description: "Human-readable reason for the exit (logged, not required)." })),
});

type ExitProcessParams = {
  reason?: string;
};

const HINT = [
  "## Process exit",
  "Use exit_process to gracefully terminate the running piclaw process after your current turn completes.",
  `${RESTART_HINT} Call this as the LAST tool in a turn after deploying new code.`,
  "Do NOT call exit_process in the middle of a multi-step turn — only when you are done and ready to restart.",
].join("\n");

export const exitProcess: ExtensionFactory = (pi: ExtensionAPI) => {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${HINT}`,
  }));

  pi.registerTool({
    name: "exit_process",
    label: "exit_process",
    description: `Gracefully terminate piclaw (drain queue, persist sessions, stop services). ${RESTART_HINT} Call as the LAST tool in a turn after deploying new code.`,
    promptSnippet: `exit_process: gracefully terminate piclaw. ${RESTART_HINT} Call LAST in a turn.`,
    parameters: ExitProcessSchema,
    async execute(_toolCallId, params: ExitProcessParams) {
      const reason = params.reason?.trim() || "Agent-initiated restart";

      // Warn if other sessions are actively working
      const otherActive = getActiveSessionCount();
      const activeWarning = otherActive > 0
        ? ` \u26a0\ufe0f ${otherActive} other session(s) currently active — their work will be interrupted.`
        : "";

      log.info("Killing tracked subprocesses and marking pending shutdown", { reason, otherActiveSessions: otherActive });
      const killed = killTrackedProcesses();

      // Mark the shutdown as pending. The actual exit happens after
      // finalizeSuccessfulRun persists the agent's response to the DB
      // and broadcasts it to connected clients.
      markPendingShutdown(reason);

      return {
        content: [{ type: "text", text: `Graceful shutdown scheduled.${activeWarning} ${killed} subprocess${killed === 1 ? "" : 'es'} killed. ${RESTART_HINT} Reason: ${reason}` }],
        details: {
          tool: "exit_process",
          scheduled: true,
          killed_subprocesses: killed,
          other_active_sessions: otherActive,
          reason,
        },
        terminate: true,
      } satisfies AgentToolResult<Record<string, unknown>>;
    },
  });
};
