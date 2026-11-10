/** Persisted copied-history documents. No preparation, import or storage execution. */
import type { JsonValue } from "@earendil-works/chord/json";
import { defineDoc } from "@earendil-works/pi-durable";

export const IMPORTER_VERSION = 2;
export const DEFAULT_IMPORT_LIMITS = { maxEntries: 1000, maxBytes: 8 * 1024 * 1024 } as const;
type Mapping = { sourceEntryId: string; durableEntryId: number };
export type LegacyImportBinding = {
  schemaVersion: number; importerVersion: number; sourceHash: string;
  chatJid: string; chatIncarnation: string; branchId: string; sourceSessionId: string;
  sourceLeafId: string; engineConversationId: number;
  originalEntries: JsonValue[]; entries: Mapping[];
};
export const LegacyImportManifest = defineDoc<{ binding: LegacyImportBinding | null }>({
  kind: "app.copied-legacy-import", version: 1, scope: "conversation", history: "latest",
  fork: "initial", checkpointWhen: () => false, initial: () => ({ binding: null }),
});
export const DEFAULT_TREE_IMPORT_LIMITS = { ...DEFAULT_IMPORT_LIMITS, maxBranches: 16 } as const;
export type LegacyTreeHostBinding = Readonly<{
  chatJid: string; chatIncarnation: string; branchId: string; hostBaseline: string;
}>;
export type LegacyTreeImportBinding = {
  importerVersion: number; sourceHash: string; sourceSessionId: string;
  originalEntries: JsonValue[];
  plannedBranches: { sourceLeafId: string; chatJid: string; chatIncarnation: string; branchId: string; hostBaseline: string }[];
  branches: LegacyImportBinding[]; entries: Mapping[];
};
export const LegacyTreeImportManifest = defineDoc<{ binding: LegacyTreeImportBinding | null }>({
  kind: "app.copied-legacy-tree-import", version: 1, scope: "conversation", history: "latest",
  fork: "initial", checkpointWhen: () => false, initial: () => ({ binding: null }),
});
