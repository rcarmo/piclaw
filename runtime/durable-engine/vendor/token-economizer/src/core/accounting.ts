// SPDX-License-Identifier: Apache-2.0
import type { Policy } from "./config.ts";
import type { Price, Spend, Usage } from "./types.ts";
export type BudgetState = { calls: Record<string, number>; dailyCalls: Record<string, number>; reserved: Record<string, { session: string; day: string; cost: number | null }>; ledger: Spend[]; unknown: string[] };
export function emptyBudget(): BudgetState { return { calls: {}, dailyCalls: {}, reserved: {}, ledger: [], unknown: [] }; }
export function priceUsage(usage: Usage, price: Price | null): number | null {
  if (!price) return null;
  let cost = usage.input * price.input + usage.output * price.output + usage.cacheRead * price.cacheRead;
  for (const [tier, count] of Object.entries(usage.cacheWrite)) {
    if (!Object.hasOwn(price.cacheWrite,tier)) return null;
    cost += count * price.cacheWrite[tier];
  }
  return cost;
}
/** Provider totals and TTL subsets become disjoint buckets at the host boundary. */
export type CacheWriteBuckets = { default: number } & Record<string, number>;
export function cacheBuckets(total: number, longer: Record<string, number>): CacheWriteBuckets {
  if (total < 0 || !Number.isFinite(total) || Object.hasOwn(longer, "default") || Object.values(longer).some(n => !Number.isFinite(n) || n < 0)) throw new Error("Invalid cache-write counts");
  const rest = total - Object.values(longer).reduce((a, b) => a + b, 0);
  if (rest < 0) throw new Error("Cache-write subsets exceed the total");
  return { default: rest, ...longer };
}
export type BudgetAdmission = { accepted: boolean; reason: "duplicate" | "call_budget" | "unknown_cost" | "cost_budget" | "reserved" };
export function reserve(state: BudgetState, id: string, session: string, day: string, cost: number | null, policy: Policy): BudgetAdmission {
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw new Error("Invalid optimisation cost reservation");
  if (state.reserved[id] || state.ledger.some(row => row.id === id)) return { accepted: false, reason: "duplicate" };
  if ((state.calls[session] ?? 0) >= policy.budget.callsPerSession || (state.dailyCalls[day] ?? 0) >= policy.budget.callsPerDay) return { accepted: false, reason: "call_budget" };
  const cap = policy.budget.maxCostPerSession;
  if (cap !== null) {
    const rows = state.ledger.filter(row => row.sessionId === session);
    const reservations = Object.values(state.reserved).filter(row => row.session === session);
    if (cost === null || rows.some(row => row.cost === null) || reservations.some(row => row.cost === null)) return { accepted: false, reason: "unknown_cost" };
    const incurred = rows.reduce((sum, row) => sum + row.cost!, 0) + reservations.reduce((sum, row) => sum + row.cost!, 0);
    if (incurred + cost > cap) return { accepted: false, reason: "cost_budget" };
  }
  state.calls[session] = (state.calls[session] ?? 0) + 1;
  state.dailyCalls[day] = (state.dailyCalls[day] ?? 0) + 1;
  state.reserved[id] = { session, day, cost };
  return { accepted: true, reason: "reserved" };
}
export function settle(state: BudgetState, spend: Spend): void {
  if (spend.cost !== null && (!Number.isFinite(spend.cost) || spend.cost < 0)) throw new Error("Invalid optimisation charge");
  if (state.ledger.some(row => row.id === spend.id)) return;
  const reservation = state.reserved[spend.id];
  if (!reservation) throw new Error("Optimisation usage has no reservation");
  if (reservation.session !== spend.sessionId) throw new Error("Optimisation usage session does not match its reservation");
  state.ledger.push(spend);
  delete state.reserved[spend.id];
  if (spend.status === "unknown") state.unknown.push(spend.id);
}
