import { beforeEach, describe, expect, test } from "bun:test";
import "../helpers.js";
import { isolateBudgetTestDatabase } from "./fixture.js";
isolateBudgetTestDatabase();
import { getDb, initDatabase, saveBudgetCap } from "../../src/db.js";

// The management projection has retired. Keep the independent historical-row
// immutability assertion until its schema owner retires under #1878.
describe("budget cap revision history", () => {
  beforeEach(() => initDatabase());
  test("persists immutable cap revision history across updates and disablement", () => {
    const now = new Date("2026-09-09T12:00:00Z");
    saveBudgetCap({ id: "cap:history", scope: "instance_daily", metric: "api_usd_micros", amount: 1_000_000, timezone: "UTC" }, getDb(), now);
    saveBudgetCap({ id: "cap:history", scope: "instance_daily", metric: "api_usd_micros", amount: 2_000_000, timezone: "UTC", enabled: false }, getDb(), new Date("2026-09-09T12:01:00Z"));
    expect(getDb().prepare("SELECT revision,amount,enabled FROM budget_cap_revisions WHERE cap_id=? ORDER BY revision").all("cap:history"))
      .toEqual([{ revision: 1, amount: 1_000_000, enabled: 1 }, { revision: 2, amount: 2_000_000, enabled: 0 }]);
    expect(() => getDb().prepare("DELETE FROM budget_cap_revisions WHERE cap_id=?").run("cap:history")).toThrow("immutable");
  });
});
