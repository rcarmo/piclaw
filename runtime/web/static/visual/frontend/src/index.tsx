import { render } from "preact";
import { App } from "./App";
import { initAddonBoot } from "./app/addon-boot";
import { loadSavedTheme } from "./utils/theme-importer";

// Install addon globals and start loading addon web entries before render.
initAddonBoot();

// Restore persisted VS Code theme (if any) before first render.
loadSavedTheme();

const root = document.getElementById("app");

if (!root) {
  throw new Error("Missing #app root element");
}

render(<App />, root);
