/**
 * Windows PowerShell extension.
 *
 * Registers a PowerShell-native shell tool on Windows and ensures it is the
 * active shell tool instead of the generic bash label.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createBashToolDefinition } from "@mariozechner/pi-coding-agent";
import { registerToolStatusHintProvider } from "../../../../src/tool-status-hints.js";
import { getSshStatusHintTarget } from "../../../../src/extensions/ssh.js";
import { createTrackedPowerShellOperations } from "../../../../src/tools/tracked-bash.js";
import { buildSubprocessExecutionHint } from "../../../../src/utils/process-spawn.js";

const POWERSHELL_STATUS_ICON_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7.4 5.5H18.8c.9 0 1.5.9 1.3 1.8l-2.3 10.2c-.2.9-1 1.5-1.9 1.5H4.8c-.9 0-1.5-.9-1.3-1.8L5.8 7c.2-.9 1-1.5 1.6-1.5Z"></path><path d="M8.1 10.1l3 2.3-4.1 2.9"></path><path d="M12.8 15.6h3.6"></path></svg>`;

function readTrimmedString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function resolvePowerShellExecutionPath(args: unknown): string {
  const record = args && typeof args === "object" ? args as Record<string, unknown> : null;
  return readTrimmedString(record?.cwd, record?.working_directory, record?.workingDirectory) || process.cwd();
}

registerToolStatusHintProvider({
  id: "powershell",
  buildHints: ({ chatJid, toolName, args, payload }) => {
    if (toolName !== "powershell") return null;
    if (getSshStatusHintTarget(chatJid, payload)) return null;
    const label = resolvePowerShellExecutionPath(args);
    return {
      key: "powershell",
      icon_svg: POWERSHELL_STATUS_ICON_SVG,
      label,
      title: `PowerShell • ${label}`,
      kind: "service",
    };
  },
});

function replaceBashWithPowerShell(activeToolNames: string[]): string[] {
  const next = new Set<string>();
  let hadShellTool = false;

  for (const toolName of activeToolNames) {
    if (toolName === "bash") {
      next.add("powershell");
      hadShellTool = true;
      continue;
    }
    if (toolName === "powershell") {
      hadShellTool = true;
    }
    next.add(toolName);
  }

  if (!hadShellTool) {
    next.add("powershell");
  }

  next.delete("bash");
  return [...next];
}

export function buildPowerShellToolDescription(platform: NodeJS.Platform = process.platform): string {
  return `Execute a PowerShell command in the current working directory. Returns stdout and stderr. Output is truncated to the same limits as bash. Optionally provide a timeout in seconds. ${buildSubprocessExecutionHint(platform)}`;
}

export function buildPowerShellPromptSnippet(platform: NodeJS.Platform = process.platform): string {
  return `Execute PowerShell commands on Windows (pwsh.exe / powershell.exe) in the current working directory. ${buildSubprocessExecutionHint(platform)}`;
}

export function buildPowerShellHint(platform: NodeJS.Platform = process.platform): string {
  return [
    "## Windows shell execution",
    "On Windows, prefer the powershell tool over bash.",
    buildSubprocessExecutionHint(platform),
  ].join("\n");
}

export default function register(pi: ExtensionAPI) {
  if (process.platform !== "win32") return;

  const baseDefinition = createBashToolDefinition(process.cwd(), {
    operations: createTrackedPowerShellOperations(),
  });

  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${buildPowerShellHint()}`,
  }));

  pi.registerTool({
    ...baseDefinition,
    name: "powershell",
    label: "powershell",
    description: buildPowerShellToolDescription(),
    promptSnippet: buildPowerShellPromptSnippet(),
  });

  pi.on("session_start", async () => {
    pi.setActiveTools(replaceBashWithPowerShell(pi.getActiveTools()));
  });
}

export { replaceBashWithPowerShell };
