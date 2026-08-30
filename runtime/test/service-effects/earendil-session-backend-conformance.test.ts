import { describe, expect, test } from "bun:test";

import { createSessionBackendConformance } from "@earendil-works/pi-agent-core/session/testing";

import { EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST } from "../../src/service-effects/earendil-harness-v3-compatibility/manifest.js";
import {
  createEarendilJsonlSessionFixture,
  createEarendilMemorySessionFixture,
} from "./fixtures/earendil-session-backend-fixtures.js";

const BACKENDS = [
  ["Memory", createEarendilMemorySessionFixture],
  ["JSONL", createEarendilJsonlSessionFixture],
] as const;

for (const [backend, factory] of BACKENDS) {
  const cases = createSessionBackendConformance(factory);
  describe(`Earendil 0.84.4 ${backend} unchanged public conformance`, () => {
    test("retains the exact accepted 30-case current catalogue and runtime boundary", () => {
      const catalogue = cases.map(({ group, name }) => ({ group, name }));
      const catalogueJson = `${JSON.stringify(catalogue, null, 2)}\n`;
      const digest = new Bun.CryptoHasher("sha256").update(catalogueJson).digest("hex");
      const current = EARENDIL_HARNESS_V3_COMPATIBILITY_MANIFEST.releases[1];
      expect(cases).toHaveLength(30);
      expect(current.conformance.caseCount).toBe(30);
      expect(digest).toBe("46636aec941f7bbd5fcec6b3aec2b8e43518a0482a1b7f4fd4c1d5197e69f387");
      expect(digest).toBe(current.conformance.catalogueSha256);
      expect(current.conformance.auditedResultSha256).toBe(
        "f2c7e067e69daf3e730da4dcab2a0ca14bba31be462c81aa70af0ac10b43e504",
      );
      expect(current.conformance[backend === "Memory" ? "memory" : "jsonl"]).toBe("pass");
      expect(current.conformance.sqlite).toBe("unsupported");
      expect(current.conformance.sqliteReason).toBe("bun_node_sqlite_unavailable");
    });

    for (const testCase of cases) {
      test(`${testCase.group} / ${testCase.name}`, () => testCase.run());
    }
  });
}
