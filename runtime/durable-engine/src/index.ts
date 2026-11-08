// INACTIVE application module: importing this API never opens storage or registers an engine.
export { HostConversationRuntime } from "./host-runtime.js";
export { reconstituteAcceptedWork } from "./host-recovery.js";
export type { AcceptedInput, RuntimeOptions, SettledAnswer, MaterializedAnswer, HostDurableBindings, HostInputBinding } from "./host-runtime.js";
export { createHostDurableBindings, initializeHostDurableBindings } from "./host-bindings.js";
export type { HostBindingOptions } from "./host-bindings.js";
export { createHostModels } from "./host-models.js";
export type { ModelRef, HostModelPolicy } from "./host-models.js";
export { createHostTool } from "./host-tools.js";
export type { HostToolEffectPort } from "./host-tools.js";
export { createHostBashTool } from "./host-bash.js";
export { BunSqliteDatabase } from "./bun-sqlite.js";
// Offline migration API compatibility; live history readers use the schema submodule.
export { prepareLegacyImport, prepareLegacyTreeImport, importCopiedLegacy, importCopiedLegacyTree } from "./legacy-import.js";
export type { CopiedLegacyInput, GetLegacyContext, CopiedLegacyTreeInput } from "./legacy-import.js";
export { IMPORTER_VERSION, DEFAULT_IMPORT_LIMITS, DEFAULT_TREE_IMPORT_LIMITS, LegacyImportManifest, LegacyTreeImportManifest } from "./legacy-import-schema.js";
export type { LegacyImportBinding, LegacyTreeHostBinding, LegacyTreeImportBinding } from "./legacy-import-schema.js";
export { createScheduledRunDispatch } from "./host-scheduled-run.js";
export { captureInterruptedScheduledHarness } from "./host-scheduled-terminal.js";
export type { ScheduledAgentInput, CurrentScheduledTask, ReadCurrentTask } from "./host-scheduled-run.js";
export { prepareCopiedUpgrade, prepareCopiedApplicationUpgrade } from "./copied-upgrade.js";
export { HostCutoverController, initializeCutoverManifest } from "./host-cutover.js";
export type {
  Phase, CutoverIdentity, CutoverRequest, Receipt, Manifest, CutoverPorts, Preparation, RollbackPlan,
} from "./host-cutover.js";

export { initializeHostSchema, UnsupportedHostSchemaError } from "./host-schema.js";
