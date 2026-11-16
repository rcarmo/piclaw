// Read-only projection of PUBLIC durable entries to the existing root UI snapshot input.
import { isDeepStrictEqual } from "node:util";
import { assertHostPlanContext, hostPlanContextKind, assertHostGoalContext, hostGoalContextKind } from "./host-plan-context.js";
import type { EntryRecord } from "@earendil-works/pi-durable";
import type { RootSessionTreeNode } from "../../src/agent-control/session-tree-snapshot.js";
import type { LegacyImportBinding } from "./legacy-import-schema.js";

export function projectPublicHistory(rows: readonly EntryRecord[], binding: LegacyImportBinding | null): RootSessionTreeNode[] {
  const originals = new Map(binding?.originalEntries.map(e => {
    const record = e as Record<string, unknown>; return [record.id, record] as const;
  }));
  const mapped = new Map(binding?.entries.map(e => [e.durableEntryId, originals.get(e.sourceEntryId)]));
  const nodes: RootSessionTreeNode[] = [];
  let parentId: string | null = null;
  for (const [index, row] of rows.entries()) {
    let original = mapped.get(row.id);
    if (row.kind === 'app.imported-history') {
      const source = (row.data as { sourceEntry?: Record<string, unknown> } | undefined)?.sourceEntry;
      if (!source || typeof source.id !== 'string' || typeof source.type !== 'string') throw Error('Invalid native imported history');
      original = source;
      if (source.type === 'message') {
        const message = source.message as { role?: unknown } | undefined;
        if (message?.role === 'system') { if (row.model?.length) throw Error('Historical system state must remain inert'); continue; }
        if (row.model?.length !== 1 || !isDeepStrictEqual(row.model[0], source.message)) throw Error('Native imported history projection conflict');
      } else if (row.model?.length) throw Error('Historical metadata must remain inert');
    }
    const next = rows[index + 1];
    const audit = rows[index - 1];
    const nextOriginal = next && mapped.get(next.id);
    // The importer maps a compaction to its trailing baseline when present.
    // Only this exact audited pair is one source entry; native compactions remain visible.
    if (row.kind === "pi.compaction" && !original && next?.kind === "pi.system" &&
      nextOriginal?.type === "compaction" && audit?.kind === "app.legacy-source" &&
      isDeepStrictEqual(audit.data, nextOriginal)) continue;
    // Raw import audit is provenance only, except a mapped metadata-only entry.
    if (row.kind === "app.legacy-source" && !original) continue;
    if (row.kind === "pi.system" && !original) continue; // private baseline, never a UI message
    if (row.kind === hostPlanContextKind) { assertHostPlanContext(row); continue; }
    if (row.kind === hostGoalContextKind) { assertHostGoalContext(row); continue; }
    // Historical bookkeeping is inert; never traverse its anchors or expose it.
    if (row.kind === "host.goal-system-authority") continue;
    if (original?.type === "message" && (original.message as { role?: unknown } | undefined)?.role === "system" &&
      ["pi.system", "app.legacy-message"].includes(row.kind)) {
      if (row.model?.length !== 1 || !isDeepStrictEqual(row.model[0], original.message))
        throw new Error("Imported system projection conflict");
      continue; // preserved historical instructions are still private
    }
    const recentCopy = row.kind === "app.recent-history-copy";
    if (recentCopy) {
      const data = row.data as Record<string, unknown> | undefined;
      if (!data || data.owner !== "operator:recent-context-copy" || data.copied !== true ||
        typeof data.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(data.sourceHash) ||
        !["sourceSessionId", "sourceLeafId", "chatJid", "branchId"].every(key => typeof data[key] === "string" && (data[key] as string).length > 0) ||
        !Number.isSafeInteger(data.messageIndex) || Number(data.messageIndex) < 0) throw Error("Invalid recovery history copy");
    }
    let entry: RootSessionTreeNode["entry"];
    const base = { id: String(row.id), parentId };
    if (original && original.type !== "message") {
      const supported = ["compaction", "branch_summary", "thinking_level_change", "model_change", "label", "session_info", "custom", "custom_message", "usage", "context_edit"];
      if (!supported.includes(String(original.type))) throw new Error(`Unsupported durable imported entry: ${original.type}`);
      // Metadata comes from immutable provenance; public ID remains navigation/position identity.
      entry = { ...original, ...base, type: String(original.type) };
    } else if (["pi.user", "pi.assistant", "pi.tool-result", "app.legacy-message", "app.imported-history", "host.accepted", "host.bash"].includes(row.kind) || recentCopy) {
      if (row.model?.length !== 1) throw new Error(`Unsupported durable message count: ${row.kind}`);
      const message = row.model[0]!;
      if (!["user", "assistant", "toolResult"].includes(message.role)) throw new Error(`Unsupported durable message role: ${message.role}`);
      const content = typeof message.content === "string" ? message.content : message.content.filter(block => {
        if (block.type === "thinking") return false;
        if (!["text", "image", "toolCall"].includes(block.type)) throw new Error(`Unsupported durable content: ${block.type}`);
        return true;
      });
      entry = { ...base, type: "message", timestamp: new Date(message.timestamp).toISOString(),
        message: { role: message.role, content, ...(message.role === "toolResult" ? { toolName: message.toolName } : {}) } };
    } else if (row.kind === "pi.reset") {
      // A native reset is a real navigation boundary, not an unsupported legacy
      // entry. Keep only its public identity/kind; no private baseline or data.
      entry = { ...base, type: "custom", customType: "pi.reset" };
    } else if (row.kind === "pi.compaction") {
      entry = { ...base, type: "compaction" }; // no invented token count/timestamp
    } else throw new Error(`Unsupported durable entry: ${row.kind}`);
    nodes.push({ entry, children: [] }); parentId = entry.id;
  }
  return nodes;
}
