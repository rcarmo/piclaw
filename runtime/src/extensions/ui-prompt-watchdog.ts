import type { ExtensionFactory, UIPromptKind } from "@earendil-works/pi-coding-agent";

import { resumeTrackedPhase, suspendTrackedPhase } from "../runtime/progress-watchdog.js";

const SUSPENSION_REASON = "ui_prompt" as const;

/** Suspend stale-progress supervision while an Earendil UI prompt blocks the agent turn. */
export function createUiPromptWatchdogExtension(chatJid?: string): ExtensionFactory {
  return (pi) => {
    if (!chatJid) return;

    let promptDepth = 0;

    const clearSuspension = () => {
      promptDepth = 0;
      resumeTrackedPhase(chatJid, SUSPENSION_REASON);
    };

    pi.on("ui_prompt_start", (event) => {
      promptDepth += 1;
      if (promptDepth !== 1) return;
      suspendTrackedPhase(chatJid, SUSPENSION_REASON, {
        kind: event.kind satisfies UIPromptKind,
        ...(event.title ? { title: event.title } : {}),
      });
    });

    pi.on("ui_prompt_end", () => {
      if (promptDepth === 0) return;
      promptDepth -= 1;
      if (promptDepth === 0) resumeTrackedPhase(chatJid, SUSPENSION_REASON);
    });

    pi.on("agent_settled", clearSuspension);
    pi.on("session_shutdown", clearSuspension);
  };
}
