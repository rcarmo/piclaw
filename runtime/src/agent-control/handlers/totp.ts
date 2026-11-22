/**
 * agent-control/handlers/totp.ts – Build TOTP enrolment/setup confirmation flows.
 *
 * Commands:
 *   /totp                  – show private TOTP setup/secondary-device flow
 *   /totp enrol / enroll   – alias for the same flow
 *   /totp reset <code>     – verify current code, then show private reset confirmation flow
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { isSingleUserAccess } from "../../core/config-access.js";
import type { AgentControlCommand, AgentControlResult } from "../agent-control-types.js";
import { getIdentityConfig, getWebRuntimeConfig } from "../../core/config.js";
import { getChatChannel, getChatJid } from "../../core/chat-context.js";
import { verifyTotp } from "../../channels/web/auth/auth.js";
import { stageTotpSurface, type TotpFlow } from "../../channels/web/a2ui/totp.js";
import { generateTotpQr } from "../../utils/totp-qr.js";

type TotpCommand = Extract<AgentControlCommand, { type: "totp" }>;

function createCandidateSecret(issuer: string, label: string): string {
  return generateTotpQr({ issuer, label }).secret;
}

function describeFlow(flow: TotpFlow): string {
  switch (flow) {
    case "setup":
      return "TOTP setup";
    case "secondary":
      return "TOTP device validation";
    case "reset":
      return "TOTP reset";
    default:
      return "TOTP";
  }
}

/** Handle `/totp` control commands for private setup/reset flows. */
export async function handleTotp(_session: AgentSession | undefined, command: TotpCommand): Promise<AgentControlResult> {
  if (!isSingleUserAccess()) return { status: "error", message: "Single-user authentication is required." };
  const action = (command.action || "").toLowerCase();
  if (action && action !== "enrol" && action !== "enroll" && action !== "reset") {
    return { status: "error", message: "Usage: /totp enrol|enroll|reset" };
  }

  const channel = getChatChannel();
  if (channel !== "web") {
    return { status: "error", message: "TOTP setup is only available in the web UI." };
  }

  const webRuntimeConfig = getWebRuntimeConfig();
  const currentSecret = (webRuntimeConfig.totpSecret || "").trim();
  const hasSecret = Boolean(currentSecret);
  const isReset = action === "reset";

  if (isReset && !hasSecret) {
    return { status: "error", message: "TOTP is not configured (PICLAW_WEB_TOTP_SECRET is empty)." };
  }

  if (isReset) {
    const code = (command.code || "").trim();
    if (!code) {
      return {
        status: "error",
        message: "Usage: /totp reset <6-digit code> (current TOTP code required for confirmation).",
      };
    }

    if (!verifyTotp(currentSecret, code, webRuntimeConfig.totpWindow)) {
      return { status: "error", message: "Invalid confirmation code." };
    }
  }

  const identity = getIdentityConfig();
  const issuer = identity.assistantName || "Piclaw";
  const label = identity.userName ? `${issuer}:${identity.userName}` : issuer;
  const flow: TotpFlow = isReset ? "reset" : hasSecret ? "secondary" : "setup";
  const candidateSecret = flow === "secondary" ? currentSecret : createCandidateSecret(issuer, label);
  const surface = stageTotpSurface({ chatJid: getChatJid(), flow, candidate: candidateSecret, activeSecret: currentSecret, issuer, label });

  const message = flow === "setup"
    ? "Open the private form below to set up TOTP, then confirm it with a live 6-digit code from your authenticator. Nothing is saved until confirmation succeeds."
    : flow === "secondary"
      ? "Open the private form below to add another TOTP device, then confirm it with a live 6-digit code. The active secret will not change."
      : "Current TOTP code accepted. Open the private form below to confirm the new secret with a live 6-digit code. Nothing changes until confirmation succeeds.";

  return {
    status: "success",
    message: `${describeFlow(flow)} — ${message}`,
    contentBlocks: [surface],
  };
}
