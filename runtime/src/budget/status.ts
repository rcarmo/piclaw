import type Database from "bun:sqlite";

import { listBudgetCaps } from "../db/budget-limits.js";
import type { BudgetProviderEvidence } from "./types.js";

export function latestProviderEvidence(database: Database, now = new Date()): BudgetProviderEvidence[] {
  const caps = listBudgetCaps({ enabledOnly: true }, database).filter((cap) => cap.scope === "provider_window");
  return caps.map((cap) => {
    const row = database.prepare(`SELECT * FROM budget_provider_evidence
      WHERE provider_id=? AND quota_dimension=? AND account_ref=? ORDER BY fetched_at DESC,evidence_id DESC LIMIT 1`)
      .get(cap.provider_id, cap.quota_dimension, cap.account_ref) as Record<string, unknown> | undefined;
    return {
      capId: cap.id,
      providerId: cap.provider_id || "unknown",
      accountRef: String(row?.account_ref ?? "unavailable"),
      quotaDimension: cap.quota_dimension || "unknown",
      windowId: String(row?.window_id ?? "provider:unknown"),
      fetchedAt: String(row?.fetched_at ?? new Date(0).toISOString()),
      resetsAt: typeof row?.resets_at === "string" ? row.resets_at : null,
      stale: row?.stale !== 0
        || !Number.isFinite(Date.parse(String(row?.fetched_at ?? "")))
        || now.getTime() - Date.parse(String(row?.fetched_at ?? "")) > 120_000,
      availability: String(row?.availability ?? "temporary_failure"),
      valueMicros: typeof row?.used_micros === "number"
        ? row.used_micros
        : typeof row?.remaining_micros === "number"
          ? row.remaining_micros
          : null,
      source: String(row?.source ?? "unavailable"),
    };
  });
}
