import "./test-guard.js";
import { acceptedSteerFixture, sdkRecoverySnapshot } from "./accepted-steer-recovery-fixture.js";
import { assertPathWithinTestFilesystemIsolation } from "../../../runtime/scripts/test-filesystem-isolation.js";
if (![5, 6].includes(process.argv.length) || process.argv[2] !== "--accepted-steer-crash" || (process.argv[5] !== undefined && process.argv[5] !== "shared")) throw Error("fixture arguments required");
const dir = process.argv[3]!, boundary = process.argv[4]!;
assertPathWithinTestFilesystemIsolation(dir, process.env, { allowRoot: false });
if (boundary !== "before-submit" && boundary !== "committed-ack-lost") throw Error("invalid boundary");
const sharedDatabase = process.argv[5] === "shared";
const f = await acceptedSteerFixture(dir,boundary, undefined, false, { sharedDatabase, loseIntentBindingAck: sharedDatabase && boundary === "committed-ack-lost" });
const { primary, primaryId, b } = await f.prepare();
const intent = JSON.parse((f.db.query("SELECT input FROM recovery_fixture_identity WHERE id=?").get(f.incarnation) as {input:string}).input);
const candidate = await f.candidateStorage!.submissionByRequest(f.base.root.id,intent.requestId, (await import("./fixture.js")).context);
if (boundary === "committed-ack-lost" ? !candidate || candidate.id !== f.committedIntentId : candidate !== undefined) throw Error("checkpoint not committed");
if (sharedDatabase && (await f.ports.bindings.intents!.list(primary)).find(b => b.requestId === intent.requestId)?.submissionId != null) throw Error("host binding written before crash boundary");
// Capture after the checked committed boundary, while this child still owns the file.
const sdkSnapshot = sharedDatabase ? await sdkRecoverySnapshot(f.candidateDatabase) : undefined;
f.owner.assert();
console.log(JSON.stringify({ sdkSnapshot, event: "accepted-steer-committed", generation: f.generation, intentSourceId: f.intentSourceId, primary, primaryId, b, committedIntentId: f.committedIntentId, intent, candidate, modelCalls: f.base.host.modelCalls, effects: f.base.host.effects }));
// Deliberately retain root DB, candidate DB and live lease until the parent SIGKILLs us.
await new Promise(() => { setInterval(() => {},1000); });
