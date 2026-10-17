/**
 * agent-pool/tool-factory.ts – Creates the default built-in tool set for agent sessions.
 *
 * Keeps tool construction separate from AgentPool orchestration so the pool can
 * compose a focused factory instead of owning direct SDK tool wiring.
 */

import { createBashTool, createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

import { createSshAwareBashOperations } from "../extensions/ssh-core.js";
import { getDefaultActiveToolNames } from "../extensions/tool-activation.js";
import { createHostGrepDefinition } from "./host-grep.js";

/** The tracked bash operations injected into the built-in bash tool. */
export type AgentBashOperations = NonNullable<Parameters<typeof createBashTool>[1]>["operations"];

/** Options for constructing the default agent tool factory. */
export interface AgentToolFactoryOptions {
  workspaceDir: string;
  bashOperations?: AgentBashOperations;
  platform?: NodeJS.Platform;
}

/**
 * Creates the default built-in tool set for agent sessions.
 *
 * This must match the intended default active-tool baseline closely enough that
 * a fresh session still has discovery/recovery primitives even if extension
 * session_start activation is delayed or skipped. Otherwise the agent can get
 * stranded on the raw read/bash/edit/write fallback while the prompt assumes
 * list_tools / activate_tools / attach_file and related baseline tools exist.
 */
export class AgentToolFactory {
  constructor(private readonly options: AgentToolFactoryOptions) {}

  createDefaultTools(): string[] {
    const { platform = process.platform } = this.options;
    return getDefaultActiveToolNames(platform);
  }

  /**
   * Returns custom ToolDefinitions that override the built-in tools.
   * The bash tool definition uses tracked operations for keychain env injection.
   */
  createCustomToolOverrides(chatJid?: string): ToolDefinition[] {
    const { workspaceDir, bashOperations, platform = process.platform } = this.options;
    const grep = createHostGrepDefinition(workspaceDir) as unknown as ToolDefinition;
    if (platform === "win32" || !bashOperations) return [grep];
    const operations = chatJid ? createSshAwareBashOperations(chatJid, bashOperations) : bashOperations;
    return [grep, createBashToolDefinition(workspaceDir, { operations }) as unknown as ToolDefinition];
  }
}
