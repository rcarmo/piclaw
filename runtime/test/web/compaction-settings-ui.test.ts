import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const runtimeRoot = join(import.meta.dir, "../..");

function source(path: string): string {
  return readFileSync(join(runtimeRoot, path), "utf8");
}

test("classic compaction settings expose and persist both canonical processing methods", () => {
  const component = source("web/src/components/settings/compaction.ts");
  const i18n = source("web/src/utils/i18n.ts");
  const bundle = source("web/static/classic/dist/app.bundle.js");

  expect(component).toContain("smartCompactionMethod: normalizeSmartCompactionMethod(data.smartCompactionMethod)");
  expect(component).toContain("smartCompactionMethod,\n        compactionModel,\n        remoteCompactionEnabled,\n        remoteCompactionTimeoutSec,\n        compactionTimeoutSec");
  expect(component).toContain('normaliseModelCatalogue(modelPayload || {})');
  expect(component).toContain('<select id="compactionModel"');
  expect(component).toContain('<option value="">Use active model');
  expect(component).toContain('Unavailable: ${compactionModel}');
  expect(component).toContain("'/agent/settings/compaction/probe'");
  expect(component).toContain("'Test compaction model'");
  expect(component).toContain('compactionLatencyEstimate');
  expect(component).toContain('compaction-latency-estimate');
  expect(component).toContain('p90DurationMs');
  expect(component).toContain("body: currentSnapshot");
  expect(component).toContain("replace(/[\\s-]+/g, '_')");
  expect(component).toContain("normalized === 'pipelined' || normalized === 'traditional_pipelined' ? 'pipelined' : 'selective'");
  expect(component).toContain('<option value="selective">');
  expect(component).toContain('<option value="pipelined">');
  expect(component).toContain("remoteCompactionEnabled: Boolean(data.remoteCompactionEnabled ?? false)");
  expect(component).toContain("remoteCompactionTimeoutSec: data.remoteCompactionTimeoutSec ?? 300");
  expect(component).toContain("t('settings.compaction.remoteNative'");
  expect(component).toContain("mergeSettingsData?.(payload.settings)");
  expect(component).toContain("applyIncoming({ ...(settingsData || {}), ...(payload.settings || {}) })");
  expect(i18n).toContain("'settings.compaction.methodSelective': 'Selective'");
  expect(i18n).toContain("'settings.compaction.methodPipelined': 'Pipelined'");
  expect(i18n).toContain("'settings.compaction.remoteNative': 'Provider-native compaction'");
  expect(bundle).toContain('value="pipelined"');
  expect(bundle).toContain('remoteCompactionEnabled');
});

test("visual compaction settings use the same canonical processing-method contract", () => {
  const component = source("web/static/visual/frontend/src/panels/settings/CompactionSection.tsx");
  const types = source("web/static/visual/frontend/src/panels/settings/types.ts");
  const bundle = source("web/static/visual/dist/app.bundle.js");

  expect(types).toContain('smartCompactionMethod?: "selective" | "pipelined"');
  expect(types).toContain('compactionModel?: string');
  expect(types).toContain('remoteCompactionEnabled?: boolean');
  expect(types).toContain('remoteCompactionTimeoutSec?: number');
  expect(component).toContain('replace(/[\\s-]+/g, "_")');
  expect(component).toContain('normalized === "pipelined" || normalized === "traditional_pipelined" ? "pipelined" : "selective"');
  expect(component).toContain('<option value="selective">Selective</option>');
  expect(component).toContain('<option value="pipelined">Pipelined</option>');
  expect(component).toContain('onSaveCompaction("smartCompactionMethod", value)');
  expect(component).toContain('normaliseModelCatalogue(modelPayload ?? {})');
  expect(component).toContain('<select');
  expect(component).toContain('<option value="">Use active model');
  expect(component).toContain('Unavailable: {compactionModel.value}');
  expect(component).toContain('fetch("/agent/settings/compaction/probe"');
  expect(component).toContain('Test compaction model');
  expect(component).toContain('data.compactionLatencyEstimate');
  expect(component).toContain('compaction-latency-estimate');
  expect(component).toContain('p90DurationMs');
  expect(component).toContain('onSaveCompaction("compactionModel", value)');
  expect(component).toContain('onSaveCompaction("remoteCompactionEnabled", value)');
  expect(component).toContain('onSaveCompaction("remoteCompactionTimeoutSec", v)');
  expect(component).toContain('saveSetting("compaction", field, value)');
  expect(bundle).toContain("pipelined");
  expect(bundle).toContain("Pipelined");
  expect(bundle).toContain("remoteCompactionEnabled");
});
