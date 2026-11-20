import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  bootstrapEnvAllowlist,
  buildObservations,
  buildObservationsFromFileTexts,
  buildSupportCatalog,
  isCatalogTextCurrent,
  isObservationTextCurrent,
  issueBaseline,
  semanticHelperMatches,
  stableJson,
  validateScanContract,
  validateSupportCatalog,
} from "../../../scripts/audit-piclaw-env-surface.ts";

const repoRoot = resolve(import.meta.dir, "../../..");
const observationsPath = resolve(repoRoot, "docs/config/piclaw-env-observations.json");
const catalogPath = resolve(repoRoot, "docs/config/piclaw-env-support-catalog.json");

// Hold one read-only view of the candidate. Counterexamples use separate fixtures or clones.
const observations = buildObservations();
const currentCatalog = buildSupportCatalog();

describe("Piclaw env surface audit", () => {
  test("detects direct and helper env reads as semantic reads", () => {
    const matches = semanticHelperMatches([
      'readEnvValue("PICLAW_WORKSPACE")',
      'readMergedEnvValue("PICLAW_DATA", envConfig)',
      'writeEnvValue("PICLAW_WEB_WIDGET_TOKEN", next)',
      'clearEnvValue("PICLAW_WEB_WIDGET_TOKEN")',
    ].join("\n"));
    expect(matches).toEqual([
      "PICLAW_WORKSPACE",
      "PICLAW_DATA",
      "PICLAW_WEB_WIDGET_TOKEN",
      "PICLAW_WEB_WIDGET_TOKEN",
    ]);
  });

  test("committed observations and support catalog are current", () => {
    expect(isObservationTextCurrent(readFileSync(observationsPath, "utf8"), observations)).toBe(true);
    expect(isCatalogTextCurrent(readFileSync(catalogPath, "utf8"), currentCatalog)).toBe(true);
  });

  test("scope accounting does not leak reads across referenced-only scopes", () => {
    const observations = buildObservationsFromFileTexts({
      "runtime/src/ref.ts": 'const name = "PICLAW_SCOPE_LEAK_FIXTURE";',
      "runtime/extensions/read.ts": 'const value = process.env.PICLAW_SCOPE_LEAK_FIXTURE;',
    }, undefined, []);
    const entry = observations.entries.find((item) => item.name === "PICLAW_SCOPE_LEAK_FIXTURE")!;
    expect(entry.scopes.runtimeSrc?.referenced).toBe(true);
    expect(entry.scopes.runtimeSrc?.directReaders).toBe(0);
    expect(entry.scopes.extensions?.directReaders).toBe(1);
    expect(observations.current.runtimeSrc.directReaderNames).toBe(0);
    expect(observations.current.extensions.directReaderNames).toBe(1);
  });

  test("observations reconcile the #724 baseline and restored scan roots", () => {
    expect(observations.issueBaseline).toEqual({ distinctNames: 235, literalProductionReaders: 151 });
    expect(observations.scanScopes.production).toEqual(["runtime/src", "runtime/extensions"]);
    expect(observations.current.runtimeSrc.directReaderNames).toBe(observations.runtimeSrcDirectBaseline.names.length);
    expect(observations.runtimeSrcDirectBaseline.names.length).toBe(7);
    expect(observations.extensionDelta.directReaderNamesOnlyInExtensions).toEqual([]);
    expect(observations.runtimeSrcDirectBaseline.added).toEqual([]);
    expect(observations.runtimeSrcDirectBaseline.removed).toEqual([]);
    expect(observations.current.runtimeSrc.directReaderNames).toBeLessThan(issueBaseline.literalProductionReaders);
    expect(observations.current.production.directReaderNames).toBeGreaterThanOrEqual(observations.current.runtimeSrc.directReaderNames);
    expect(observations.current.production.semanticReaderOccurrences).toBe(
      observations.current.production.directReaderOccurrences + observations.current.production.helperReaderOccurrences,
    );
  });

  test("support catalog has no unresolved dispositions or stale config monolith provenance", () => {
    expect(currentCatalog.entries.filter((entry) => entry.migrationDisposition === "investigate")).toEqual([]);
    expect(currentCatalog.entries.filter((entry) => entry.source.includes("runtime/src/core/config.ts"))).toEqual([]);
  });

  test("support catalog covers all production observations with complete metadata", () => {
    validateSupportCatalog(currentCatalog, observations);
    const catalogNames = new Set(currentCatalog.entries.map((entry) => entry.name));
    for (const entry of observations.entries.filter((item) => item.scopes.production?.referenced)) {
      expect(catalogNames.has(entry.name), entry.name).toBe(true);
    }
    expect(currentCatalog.entries.filter((entry) => entry.status === "undocumented-runtime")).toEqual([]);
    expect(currentCatalog.entries.filter((entry) => entry.migrationDisposition === "move-to-domain-config")).toEqual([]);
    for (const entry of currentCatalog.entries) {
      expect(entry.owner, entry.name).toBeTruthy();
      expect(entry.source, entry.name).toBeTruthy();
      expect(entry.migrationDisposition, entry.name).toBeTruthy();
      expect(Object.prototype.hasOwnProperty.call(entry, "secret"), entry.name).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(entry, "compatibilityAliasFor"), entry.name).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(entry, "deprecation"), entry.name).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(entry, "removalVersion"), entry.name).toBe(true);
      if (["supported", "bootstrap", "compatibility"].includes(entry.status)) {
        expect(entry.type, entry.name).toBeTruthy();
        expect(entry.persistence.length, entry.name).toBeGreaterThan(0);
        expect(entry.precedence.length, entry.name).toBeGreaterThan(0);
        expect(Object.prototype.hasOwnProperty.call(entry, "default"), entry.name).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(entry, "bounds"), entry.name).toBe(true);
      } else {
        expect(entry.persistence.includes("json-config"), entry.name).toBe(false);
      }
    }
  });

  test("C2b compaction guardrails are fixed internal constants without env persistence", () => {
    const names = [
      "PICLAW_COMPACTION_MAX_WORK_UNITS",
      "PICLAW_COMPACTION_SETTLEMENT_GRACE_MS",
      "PICLAW_DISABLE_PRIVATE_UPSTREAM_AUTO_COMPACTION_SUPPRESSOR",
      "PICLAW_MANUAL_COMPACTION_EXTERNAL_FAILSAFE",
      "PICLAW_MANUAL_COMPACTION_FAILSAFE_GRACE_MS",
      "PICLAW_STALE_ACTIVE_COMPACTION_BACKOFF_MS",
      "PICLAW_STALE_ACTIVE_COMPACTION_RECOVERY_MS",
    ];
    for (const name of names) {
      const entry = currentCatalog.entries.find((item) => item.name === name);
      expect(entry, name).toBeDefined();
      expect(entry?.status, name).toBe("internal");
      expect(entry?.migrationDisposition, name).toBe("constant");
      expect(entry?.persistence, name).toEqual([]);
      expect(entry?.precedence, name).toEqual([]);
    }
  });

  test("bootstrap entries must be allowlisted", () => {
    const allowlist = new Set(bootstrapEnvAllowlist);
    for (const entry of currentCatalog.entries.filter((item) => item.status === "bootstrap" || item.bootstrapAllowed)) {
      expect(allowlist.has(entry.name), entry.name).toBe(true);
      expect(entry.bootstrapAllowed, entry.name).toBe(true);
    }
  });

  test("secret entries do not claim JSON config persistence", () => {
    for (const entry of currentCatalog.entries.filter((item) => item.secret)) {
      expect(entry.persistence.includes("json-config"), entry.name).toBe(false);
    }
  });

  test("missing production disposition entries fail validation", () => {
    const catalog = structuredClone(currentCatalog);
    const productionName = observations.entries.find((entry) => entry.scopes.production?.referenced)!.name;
    catalog.entries = catalog.entries.filter((entry) => entry.name !== productionName);
    expect(() => validateSupportCatalog(catalog, observations)).toThrow(/Missing production env disposition catalog entry/);
  });

  test("placeholder disposition and public contract metadata fail validation", () => {
    const catalog = structuredClone(currentCatalog);
    const entry = catalog.entries.find((item) => item.status === "bootstrap")!;
    entry.owner = "unknown";
    expect(() => validateSupportCatalog(catalog, observations)).toThrow(/Placeholder disposition metadata/);

    const publicCatalog = structuredClone(currentCatalog);
    const publicEntry = publicCatalog.entries.find((item) => item.status === "bootstrap")!;
    publicEntry.type = "unknown" as any;
    expect(() => validateSupportCatalog(publicCatalog, observations)).toThrow(/Placeholder supported-config contract/);
  });

  test("secret JSON persistence fails validation", () => {
    const catalog = structuredClone(currentCatalog);
    const secret = catalog.entries.find((item) => item.secret)!;
    secret.persistence.push("json-config");
    expect(() => validateSupportCatalog(catalog, observations)).toThrow(/must not declare json-config persistence/);
  });

  test("bootstrap mismatch and allowlist drift fail validation", () => {
    const catalog = structuredClone(currentCatalog);
    const nonBootstrap = catalog.entries.find((item) => !bootstrapEnvAllowlist.includes(item.name as any))!;
    nonBootstrap.bootstrapAllowed = true;
    expect(() => validateSupportCatalog(catalog, observations)).toThrow(/bootstrapAllowed not in allowlist/);

    const drifted = structuredClone(currentCatalog);
    drifted.bootstrapEnvAllowlist = drifted.bootstrapEnvAllowlist.slice(1);
    expect(() => validateSupportCatalog(drifted, observations)).toThrow(/Bootstrap env allowlist drift/);
  });

  test("web compatibility aliases cannot move to another runtime reader", () => {
    for (const name of ["PICLAW_TERMINAL_IMAGE_PROTOCOL", "PICLAW_WEB_PUSH_SUBSCRIPTION_CAP", "PICLAW_WEB_PUSH_VAPID_SUBJECT"]) {
      const reader = `process.env.${name}`;
      expect(() => validateScanContract(buildObservationsFromFileTexts({
        "runtime/src/core/config.ts": reader,
        "runtime/src/channels/web/terminal.ts": `const childEnv = { ${name}: 'configured' };`,
      }, undefined, [name]))).not.toThrow();
      expect(() => validateScanContract(buildObservationsFromFileTexts({
        "runtime/src/channels/web/terminal.ts": reader,
      }, undefined, [name]))).toThrow(`Web compatibility env reader outside core config: ${name}`);
    }
  });

  test("scan-root and runtime-src baseline drift fail validation", () => {
    const scanRootDrift = structuredClone(observations);
    scanRootDrift.scanRootVersion += 1;
    expect(() => validateScanContract(scanRootDrift)).toThrow(/Scan root version drift/);

    const scopeDrift = structuredClone(observations);
    scopeDrift.scanScopes.production = ["runtime/src"];
    expect(() => validateScanContract(scopeDrift)).toThrow(/Scan root scope drift/);

    const baselineDrift = buildObservationsFromFileTexts({
      "runtime/src/base.ts": "process.env.PICLAW_BASELINE_A; process.env.PICLAW_BASELINE_B;",
    }, undefined, ["PICLAW_BASELINE_A", "PICLAW_REMOVED"]);
    expect(baselineDrift.runtimeSrcDirectBaseline.added).toEqual(["PICLAW_BASELINE_B"]);
    expect(baselineDrift.runtimeSrcDirectBaseline.removed).toEqual(["PICLAW_REMOVED"]);
    expect(() => validateScanContract(baselineDrift)).toThrow(/Runtime src direct-reader name drift/);
  });

  test("stale observation and catalog text are rejected", () => {
    expect(isObservationTextCurrent(stableJson({ ...observations, current: { production: { referencedNames: 0 } } }), observations)).toBe(false);
    expect(isCatalogTextCurrent(stableJson({ ...currentCatalog, entries: [] }), currentCatalog)).toBe(false);
  });
});
