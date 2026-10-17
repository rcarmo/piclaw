import "./test-guard.js";
import { SqliteStorage } from "../../../runtime/durable-engine/qualification/sqlite.ts";
import { TestOwner, OwnedSqlite } from "./ownership.js";
import { openFixture, barrier } from "./fixture.js";
import { assertPathWithinTestFilesystemIsolation } from "../../../runtime/scripts/test-filesystem-isolation.js";
if (process.argv.length !== 4 || process.argv[2] !== "--qualification-owner-child") throw new Error("fixture arguments required");
assertPathWithinTestFilesystemIsolation(process.argv[3]!, process.env, { allowRoot: false });
let constructions = 0, leaseAcquired = false;
try {
  const owner = TestOwner.acquire(process.argv[3]!);
  leaseAcquired = true;
  // Admission is not storage readiness. Let both real acquisition attempts
  // finish (including the loser's rollback/close) before candidate migrations.
  console.log(JSON.stringify({ phase: "acquired", leaseAcquired, admitted: false, constructions }));
  const command = await Bun.stdin.stream().getReader().read();
  if (command.done || new TextDecoder().decode(command.value) !== "open\n") throw new Error("open barrier command required");
  const current = await openFixture(owner, () => { constructions++; }, () => SqliteStorage.open(new OwnedSqlite(owner)));
  current.host.modelHold = barrier();
  const submission = await current.submit("crash-pending", "hello");
  console.log(JSON.stringify({ admitted: true, leaseAcquired, constructions, id: submission.id, modelCalls: current.host.modelCalls }));
  await new Promise(() => { setInterval(() => {}, 1000); });
} catch (error) {
  console.log(JSON.stringify({ admitted: false, leaseAcquired, constructions, error: String(error), stack: error instanceof Error ? error.stack : undefined }));
  process.exit(0);
}
