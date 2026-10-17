// Read-only projection of PUBLIC durable entries to the existing root UI snapshot input.
import { isDeepStrictEqual } from "node:util";
import type { EntryRecord } from "@earendil-works/pi-durable";
import type { RootSessionTreeNode } from "../../src/agent-control/session-tree-snapshot.js";
import type { LegacyImportBinding } from "./legacy-import.js";

export function projectPublicHistory(rows: readonly EntryRecord[], binding: LegacyImportBinding | null): RootSessionTreeNode[] {
  const originals = new Map(binding?.originalEntries.map(e => {
    const record = e as Record<string, unknown>; return [record.id, record] as const;
  }));
  const mapped = new Map(binding?.entries.map(e => [e.durableEntryId, originals.get(e.sourceEntryId)]));
  const nodes: RootSessionTreeNode[] = [];
  let parentId: string | null = null;
  for (const [index, row] of rows.entries()) {
    const original = mapped.get(row.id);
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
    let entry: RootSessionTreeNode["entry"];
    const base = { id: String(row.id), parentId };
    if (original && original.type !== "message") {
      const supported = ["compaction", "branch_summary", "thinking_level_change", "model_change", "label", "session_info", "custom", "custom_message", "usage", "context_edit"];
      if (!supported.includes(String(original.type))) throw new Error(`Unsupported durable imported entry: ${original.type}`);
      // Metadata comes from immutable provenance; public ID remains navigation/position identity.
      entry = { ...original, ...base, type: String(original.type) };
    } else if (["pi.user", "pi.assistant", "pi.tool-result", "app.legacy-message", "host.accepted"].includes(row.kind)) {
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
    } else if (row.kind === "pi.compaction") {
      entry = { ...base, type: "compaction" }; // no invented token count/timestamp
    } else if (row.kind === "pi.system" && original?.type === "message") {
      continue; // imported system baseline
    } else throw new Error(`Unsupported durable entry: ${row.kind}`);
    nodes.push({ entry, children: [] }); parentId = entry.id;
  }
  return nodes;
}
