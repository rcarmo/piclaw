/**
 * agent-control/agent-control-handlers.ts – Dispatch parsed commands to handlers.
 *
 * The applyControlCommand() function is the main dispatcher: it receives the
 * active AgentSessionRuntime plus a parsed AgentControlCommand and routes it to
 * the appropriate handler function from handlers/*.ts based on the command type.
 *
 * Consumers:
 *   - agent-pool.ts calls applyControlCommand() to execute control commands.
 *   - runtime/message-loop.ts calls it for WhatsApp control commands.
 *   - channels/web/request-router-service.ts calls it for web commands.
 */

import type { AgentSessionRuntime, ModelRegistry } from "@mariozechner/pi-coding-agent";
import type { AgentControlCommand, AgentControlResult } from "./agent-control-types.js";
import {
  handleAbort,
  handleAbortBash,
  handleAbortRetry,
  handleAutoCompact,
  handleAutoRetry,
  handleCompact,
  handleExit,
  handleRestart,
} from "./handlers/control.js";
import { handleAgentAvatar, handleAgentName } from "./handlers/agent.js";
import { handleUserAvatar, handleUserGithub, handleUserName } from "./handlers/user.js";
import {
  handleCommands,
  handleContext,
  handleLast,
  handleSearchWorkspace,
  handleState,
  handleStats,
} from "./handlers/info.js";
import {
  handleCycleModel,
  handleCycleThinking,
  handleModel,
  handleThinking,
} from "./handlers/model.js";
import { handleBash, handleShell } from "./handlers/operations.js";
import { handleFollowupMode, handleQueue, handleSteeringMode, handleSteer } from "./handlers/queue.js";
import {
  handleClone,
  handleExportHtml,
  handleFork,
  handleForks,
  handleNewSession,
  handleSessionName,
  handleSessionRotate,
  handleSwitchSession,
} from "./handlers/session.js";
import { handlePasskey } from "./handlers/passkey.js";
import { handleLogin, handleLogout } from "./handlers/login.js";
import { handleTotp } from "./handlers/totp.js";
import { handleQr } from "./handlers/qr.js";
import { handleLabel, handleLabels, handleTree } from "./handlers/tree.js";
import { handleAsk } from "./handlers/remote.js";

/** Dispatch a parsed control command to the appropriate handler and return the result. */
export async function applyControlCommand(
  runtime: AgentSessionRuntime,
  modelRegistry: ModelRegistry,
  command: AgentControlCommand
): Promise<AgentControlResult> {
  const session = runtime.session;
  switch (command.type) {
    case "restart":
      return handleRestart(session, command);
    case "exit":
      return handleExit(session, command);
    case "shell":
      return handleShell(session, command);
    case "bash":
      return handleBash(session, command);
    case "queue":
    case "queue_all":
      return handleQueue(session, command);
    case "state":
      return handleState(session, command);
    case "stats":
      return handleStats(session, command);
    case "context":
      return handleContext(session, command);
    case "last":
      return handleLast(session, command);
    case "compact":
      return handleCompact(session, command);
    case "auto_compact":
      return handleAutoCompact(session, command);
    case "auto_retry":
      return handleAutoRetry(session, command);
    case "abort":
      return handleAbort(session, command);
    case "abort_retry":
      return handleAbortRetry(session, command);
    case "abort_bash":
      return handleAbortBash(session, command);
    case "cycle_model":
      return handleCycleModel(session, modelRegistry, command);
    case "cycle_thinking":
      return handleCycleThinking(session, modelRegistry, command);
    case "steering_mode":
      return handleSteeringMode(session, command);
    case "followup_mode":
      return handleFollowupMode(session, command);
    case "steer":
      return handleSteer(session, command);
    case "session_name":
      return handleSessionName(session, command);
    case "new_session":
      return handleNewSession(session, runtime, command);
    case "switch_session":
      return handleSwitchSession(session, runtime, command);
    case "session_rotate":
      return handleSessionRotate(session, runtime, command);
    case "fork":
      return handleFork(session, runtime, command);
    case "clone":
      return handleClone(session, runtime, command);
    case "forks":
      return handleForks(session, command);
    case "export_html":
      return handleExportHtml(session, command);
    case "passkey":
      return handlePasskey(session, command);
    case "login":
      return handleLogin(session, modelRegistry, command);
    case "logout":
      return handleLogout(session, modelRegistry, command);
    case "totp":
      return handleTotp(session, command);
    case "qr":
      return handleQr(session, command);
    case "search_workspace":
      return handleSearchWorkspace(session, command);
    case "tree":
      return handleTree(session, command);
    case "label":
      return handleLabel(session, command);
    case "labels":
      return handleLabels(session, command);
    case "agent_name":
      return handleAgentName(session, command);
    case "agent_avatar":
      return handleAgentAvatar(session, command);
    case "user_name":
      return handleUserName(session, command);
    case "user_avatar":
      return handleUserAvatar(session, command);
    case "user_github":
      return handleUserGithub(session, command);
    case "model":
      return handleModel(session, modelRegistry, command);
    case "commands":
      return handleCommands(session, command);
    case "thinking":
      return handleThinking(session, modelRegistry, command);
    case "ask":
      return handleAsk(session, command);
    default:
      return {
        status: "error",
        message: "Unsupported command.",
      };
  }
}
