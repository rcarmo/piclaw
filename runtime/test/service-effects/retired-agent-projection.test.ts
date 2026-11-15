import "../helpers.js";
import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { extractModuleSpecifiers } from "../../scripts/check-import-boundaries.js";
import { EFFECTOR_CASE_CATALOGUE, EFFECTOR_CONTRACT_IDS } from "../../src/service-effects/testing/effector-case-catalogue.js";

const root = resolve(import.meta.dir, "../../..");
const retired = [
  "runtime/durable-engine/src/host-projection.ts",
  "runtime/src/service-effects/current-piclaw/agent-projection-sink.ts",
  "runtime/src/service-effects/contracts/agent-projection-sink.ts",
  "runtime/src/service-effects/testing/contract-suites/agent-projection-sink-contract.ts",
  "runtime/src/service-effects/testing/fakes/fake-agent-projection-sink.ts",
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}

test("inactive EF-S08 bridge, cursor owner and exclusive support are absent", () => {
  expect(retired.filter(path => existsSync(join(root, path)))).toEqual([]);
  const barrel = readFileSync(join(root, "runtime/durable-engine/src/index.ts"), "utf8");
  expect(barrel).not.toContain("observeProjection");
  expect(barrel).not.toContain("ProjectionBinding");
  expect(barrel).not.toContain("ProjectionPorts");
});

test("no source layer imports the retired bridge or sink", () => {
  const references = ["runtime/src", "runtime/durable-engine/src"].flatMap(directory => sourceFiles(join(root, directory)))
    .flatMap(file => extractModuleSpecifiers(readFileSync(file, "utf8"))
      .filter(specifier => /(?:host-projection|agent-projection-sink)(?:\.|\/|$)/.test(specifier))
      .map(specifier => `${relative(root, file)}: ${specifier}`));
  expect(references).toEqual([]);
});

test("remaining effect catalogue is exact and does not reactivate EF-S08", () => {
  expect(EFFECTOR_CONTRACT_IDS).toEqual(["EF-S01", "EF-S02", "EF-S03", "EF-S04", "EF-S05", "EF-S06", "EF-S07", "EF-H01"]);
  expect(EFFECTOR_CASE_CATALOGUE.map(entry => entry.contractId)).toEqual([...EFFECTOR_CONTRACT_IDS]);
  const delivery = EFFECTOR_CASE_CATALOGUE.find(entry => entry.contractId === "EF-S06")!;
  expect([...delivery.requiredCases.map(entry => entry.caseId), delivery.crashOracle.oracleId]).toHaveLength(18);
  expect(delivery.crashOracle.oracleId).toBe("EF-S06-R01");
});

test("current native observation, settlement and browser qualification remain", () => {
  const runtime = readFileSync(join(root, "runtime/durable-engine/src/host-runtime.ts"), "utf8");
  expect(runtime).toContain("watchSession(");
  expect(runtime).toContain("conversation.watch(this.context)");
  expect(runtime).toContain("private async settleInput(");
  for (const path of [
    "qualification/native/native-ui-projection.test.ts",
    "qualification/native/native-delegate-progress.test.ts",
    "runtime/test/web/native-ui-projection.browser.optional.test.ts",
  ]) expect(existsSync(join(root, path))).toBe(true);
  const gate = JSON.parse(readFileSync(join(root, "scripts/native-gate-contract.json"), "utf8")) as { tests: string[] };
  expect(gate.tests).toContain("native-ui-projection.test.ts");
  expect(gate.tests).toContain("native-delegate-progress.test.ts");
  expect(gate.tests).not.toContain("projection.test.ts");
  const typeProject = JSON.parse(readFileSync(join(root, "qualification/native/tsconfig.json"), "utf8")) as { include: string[] };
  expect(typeProject.include).not.toContain("projection.test.ts");
});
