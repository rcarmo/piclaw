import { afterEach, describe, expect, test } from "bun:test";

import {
  getRegisteredSettingsPanes,
  registerSettingsPane as registerClassicPane,
  unregisterSettingsPane as unregisterClassicPane,
} from "../../web/src/components/settings/pane-registry.js";

const ids = [
  "settings-order-alpha-a",
  "settings-order-alpha-b",
  "settings-order-zulu",
  "settings-order-core-a",
  "settings-order-core-b",
];

function definition(id: string, label: string, order?: number) {
  return { id, label, icon: null, component: null, ...(order === undefined ? {} : { order }) };
}

function listedIds(panes: Array<{ id: string }>): string[] {
  return panes.filter((pane) => ids.includes(pane.id)).map((pane) => pane.id);
}

function clearRegistries(): void {
  for (const id of ids) {
    unregisterClassicPane(id);

  }
}

afterEach(clearRegistries);

describe("settings pane order parity", () => {
  test("Classic sort add-on panes by label then id and ignore legacy order", () => {
    clearRegistries();
    const panes = [
      definition(ids[2], "Zulu", 1),
      definition(ids[1], "alpha", 10),
      definition(ids[0], "Alpha", 999),
    ];

    for (const pane of panes) {
      registerClassicPane(pane);

    }

    const expected = [ids[0], ids[1], ids[2]];
    expect(listedIds(getRegisteredSettingsPanes())).toEqual(expected);

  });

  test("replacement preserves add-on ownership and re-sorts Classic", () => {
    clearRegistries();
    registerClassicPane(definition(ids[2], "Zulu"));
    registerClassicPane(definition(ids[0], "Alpha"));

    registerClassicPane(definition(ids[2], "Aardvark", 999));

    expect(listedIds(getRegisteredSettingsPanes())).toEqual([ids[2], ids[0]]);

  });

  test("unregister removes panes without disturbing the remaining order", () => {
    clearRegistries();
    for (const pane of [definition(ids[2], "Zulu"), definition(ids[0], "Alpha")]) {
      registerClassicPane(pane);

    }

    unregisterClassicPane(ids[0]);

    expect(listedIds(getRegisteredSettingsPanes())).toEqual([ids[2]]);

  });
});
