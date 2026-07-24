/**
 * utils/pi-session-env.ts – Upstream-compatible PI_* metadata for subprocesses.
 */

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";

export interface PiSessionEnvInput {
  sessionId?: string | null;
  sessionFile?: string | null;
  model?: Pick<Model<Api>, "provider" | "id"> | null;
  modelLabel?: string | null;
  thinkingLevel?: ThinkingLevel | string | null;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseModelLabel(label: string | null | undefined): Pick<Model<Api>, "provider" | "id"> | null {
  const value = nonEmpty(label);
  if (!value) return null;
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return null;
  return { provider: value.slice(0, slash), id: value.slice(slash + 1) } as Pick<Model<Api>, "provider" | "id">;
}

/** Build the upstream bash-tool session environment variables for non-core subprocesses. */
export function buildPiSessionEnv(input: PiSessionEnvInput = {}): Record<string, string> {
  const env: Record<string, string> = {};
  const sessionId = nonEmpty(input.sessionId);
  const sessionFile = nonEmpty(input.sessionFile);
  const model = input.model ?? parseModelLabel(input.modelLabel);
  const thinkingLevel = nonEmpty(input.thinkingLevel);

  if (sessionId) env.PI_SESSION_ID = sessionId;
  if (sessionFile) env.PI_SESSION_FILE = sessionFile;
  if (model?.provider) env.PI_PROVIDER = model.provider;
  if (model?.id) env.PI_MODEL = model.id;
  if (thinkingLevel) env.PI_REASONING_LEVEL = thinkingLevel;
  return env;
}

/** Merge PI_* metadata after a base environment so stale values are replaced or removed. */
export function mergePiSessionEnv(base: NodeJS.ProcessEnv, input: PiSessionEnvInput = {}): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...base };
  for (const key of ["PI_SESSION_ID", "PI_SESSION_FILE", "PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL"] as const) {
    delete next[key];
  }
  return { ...next, ...buildPiSessionEnv(input) };
}
