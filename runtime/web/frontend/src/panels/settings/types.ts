/* ── Shared types for SettingsPanel section modules ── */

export interface Theme {
  name: string;
  label: string;
  mode: string;
}

export interface Provider {
  id: string;
  name: string;
  hasOAuth?: boolean;
  hasApiKey?: boolean;
  configured?: boolean;
  authType?: string | null;
  apiKeyHint?: string;
  isCustom?: boolean;
}

export interface WatchdogPhase {
  chat?: string;
  phase?: string;
  started?: string;
  lastHeartbeat?: string;
}

export interface CompactionBackoff {
  chatJid: string;
  failureCount: number;
  lastFailedAt: string;
  backoffUntil: string;
  lastErrorMessage: string | null;
}

export interface WorkspaceSettings {
  webTerminalEnabled?: boolean;
  vncAllowDirect?: boolean;
  treeMaxDepth?: number;
  treeMaxEntries?: number;
}

export interface Toolset {
  name: string;
  description?: string;
  tools?: Tool[];
}

export interface Tool {
  name: string;
  kind?: string;
  weight?: string;
  description?: string;
  summary?: string;
}

export interface SettingsData {
  /* general */
  assistantName?: string;
  userName?: string;
  sessionAutoRotate?: boolean;
  sessionMaxSizeMb?: number;
  toolUseBudget?: number;
  webTerminalEnabled?: boolean;
  sessionIsolation?: "none" | "summary" | "full";
  searchMatchMode?: "or" | "and";
  composeUploadLimitMb?: number;
  workspaceUploadLimitMb?: number;
  instanceTotp?: {
    configured?: boolean;
    issuer?: string;
    label?: string;
    secret?: string;
    otpauth?: string;
    qrSvg?: string;
  };
  /* appearance */
  uiTheme?: string;
  uiTint?: string | null;
  themes?: Theme[];
  /* compaction */
  compactionTimeoutSec?: number;
  compactionBackoffBaseMin?: number;
  compactionBackoffMaxMin?: number;
  progressWatchdogEnabled?: boolean;
  progressWatchdogTimeoutSec?: number;
  compactionBackoffs?: CompactionBackoff[];
  progressWatchdogPhases?: WatchdogPhase[];
  toolResultCompactionEnabled?: boolean;
  toolResultCompactionTools?: string[];
  toolResultSemanticSummaryEnabled?: boolean;
  toolResultSemanticSummaryMaxInputChars?: number;
  toolResultSemanticSummaryMaxTokens?: number;
  toolResultSemanticSummaryTimeoutSec?: number;
  /* models */
  scopedModelsOnly?: boolean;
  /* workspace */
  workspaceSettings?: WorkspaceSettings;
  /* providers */
  providers?: Provider[];
  /* toolsets */
  toolsets?: Toolset[];
}

export type Category = "general" | "sessions" | "recordings" | "workspace" | "environment" | "models" | "keychain" | "tools" | "appearance" | "compaction" | "providers";

/**
 * Props passed to every built-in settings section component when rendered
 * through the unified pane registry.
 */
export interface SettingsSectionProps {
  data: SettingsData;
  saveSetting: (endpoint: string, field: string, value: unknown) => Promise<void>;
  filter?: string;
}
