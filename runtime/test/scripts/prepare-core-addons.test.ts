import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace } from "../helpers.js";
import { coreCatalogEntries, prepareCoreAddons, readCoreAddonLock } from "../../../scripts/release/prepare-core-addons.js";

const repo = join(import.meta.dir, "../../..");

describe("core add-on release preparation", () => {
  test("pins precisely the catalog-tagged core entries", () => {
    const catalog = JSON.parse(readFileSync(join(repo, "release/core-addons/catalog.json"), "utf8"));
    const pins = readCoreAddonLock().addons;
    expect(coreCatalogEntries(catalog).map((item) => item.slug)).toEqual(pins.map((pin) => pin.slug));
    expect(pins.length).toBeGreaterThan(0);
  });

  test("builds the vendored seed offline and checks each installed package", async () => {
    const ws = createTempWorkspace("piclaw-core-pack-");
    try {
      const target = join(ws.base, "seed");
      await prepareCoreAddons({ outputDir: target });
      const pins = readCoreAddonLock().addons;
      for (const pin of pins) {
        expect(JSON.parse(readFileSync(join(target, "node_modules", pin.name, "package.json"), "utf8")).version).toBe(pin.version);
      }
      expect(JSON.parse(readFileSync(join(target, "package.json"), "utf8")).dependencies[pins[0].name]).toBe(pins[0].url);
    } finally { ws.cleanup(); }
  }, 90_000);

  test("fails closed when catalog snapshot or tarball bytes change", async () => {
    const ws = createTempWorkspace("piclaw-core-tamper-");
    try {
      const archives = join(ws.base, "tarballs");
      mkdirSync(archives);
      for (const pin of readCoreAddonLock().addons) {
        copyFileSync(join(repo, "release/core-addons/tarballs", `${pin.slug}.tgz`), join(archives, `${pin.slug}.tgz`));
      }
      writeFileSync(join(archives, `${readCoreAddonLock().addons[0].slug}.tgz`), new Uint8Array([1, 2, 3]));
      const target = join(ws.base, "seed");
      await expect(prepareCoreAddons({ outputDir: target, tarballsDir: archives })).rejects.toThrow("Checksum mismatch");
      expect(existsSync(target)).toBe(false);
    } finally { ws.cleanup(); }
  });
});
