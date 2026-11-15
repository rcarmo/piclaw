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
// Grandfathered already-native historical data only; no v3 conversion entrypoint.
export { IMPORTER_VERSION, DEFAULT_IMPORT_LIMITS, DEFAULT_TREE_IMPORT_LIMITS, LegacyImportManifest, LegacyTreeImportManifest } from "./legacy-import-schema.js";
export type { LegacyImportBinding, LegacyTreeHostBinding, LegacyTreeImportBinding } from "./legacy-import-schema.js";
export { captureInterruptedScheduledHarness } from "./host-scheduled-terminal.js";
export { initializeHostSchema, UnsupportedHostSchemaError } from "./host-schema.js";

// Explicit history-only import into a fresh separate destination; never startup migration.
export { importSessionHistory, SessionHistoryImportDoc } from "./session-history-import.js";
export type { SessionHistoryImport } from "./session-history-import.js";
