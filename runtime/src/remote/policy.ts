/**
 * remote/policy.ts – Deterministic tool-scope ceiling for remote execution.
 *
 * Profiles are enforced by the runtime BEFORE handing off to the agent session.
 * The LLM is a policy advisor; it must not be able to exceed the ceiling
 * encoded here regardless of what the decision envelope contains.
 */

import { getToolCapability } from "../extensions/tool-capabilities.js";
import type { RemotePeerProfile } from "../db/remote-interop.js";

/**
 * Hard-blocked tools for the `restricted` (and `custom`, deferred) profile.
 *
 * Covers the spec's deny baseline:
 *  - shell/script execution
 *  - file write / edit / delete
 *  - keychain access
 *  - SQL introspection
 *  - model / provider switching
 *  - scheduler / task creation
 *  - privileged lifecycle operations
 *  - tool self-escalation (activate_tools / reset_active_tools)
 *  - heavy background automation
 */
function isEditorOpenTool(toolName: string): boolean {
  return /^open_[a-z0-9_]+_editor$/i.test(String(toolName || ""));
}

export const RESTRICTED_TOOL_DENYLIST: ReadonlySet<string> = new Set([
  // shell / script execution
  "bash",
  "powershell",
  "bun_run",
  "exec_batch",
  // file mutation
  "edit",
  "write",
  "export_attachment",
  "office_write",
  "refresh_workspace_index",
  // privileged data access
  "keychain",
  "introspect_sql",
  // model switching
  "switch_model",
  "switch_thinking",
  // scheduler
  "schedule_task",
  // lifecycle
  "exit_process",
  // self-escalation – must never be reachable under restricted/read-only
  "activate_tools",
  "reset_active_tools",
  // heavy background automation
  "start_autoresearch",
  "stop_autoresearch",
]);

/**
 * Returns a filter predicate that constrains the allowed tool set for
 * a given peer profile, or `null` if there is no restriction (`full`).
 *
 * The caller is responsible for applying this to both:
 *  1. The initial active tool set before prompting.
 *  2. Any subsequent `setActiveToolsByName` calls during the run.
 */
export function getToolCeilingFilter(profile: RemotePeerProfile): ((toolName: string) => boolean) | null {
  if (profile === "full") return null;

  // read-only: ping/status only — no tool execution permitted.
  if (profile === "read-only") {
    return () => false;
  }

  // non-mutating: all tools whose capability kind is "read-only" (no side-effects).
  if (profile === "non-mutating") {
    return (name: string) => getToolCapability(name).kind === "read-only";
  }

  // restricted + custom (custom deferred: falls back to restricted ceiling)
  return (name: string) => !RESTRICTED_TOOL_DENYLIST.has(name) && !isEditorOpenTool(name);
}
