import { render } from "preact";
import { useState } from "preact/hooks";
import { ModelPicker } from "../../../web/static/visual/frontend/src/components/model-context-bar/ModelPicker";
import { SessionPill } from "../../../web/static/visual/frontend/src/components/SessionPill";
import { pickerModels } from "./picker-models";
const session =
  new URLSearchParams(location.search).get("picker") === "session";
function Fixture() {
  const [action, setAction] = useState("none");
  return (
    <div
      style={{
        position: "absolute",
        left: "12px",
        right: "12px",
        bottom: "12px",
      }}
    >
      <output id="picker-action">{action}</output>
      {session ? (
        <SessionPill />
      ) : (
        <ModelPicker
          models={pickerModels.map((model) => ({
            ...model,
            reasoningKnown: true,
          }))}
          activeModel="test/large"
          onSelectModel={(model) => setAction(model)}
          onCompact={() => setAction("compact")}
          onTogglePin={() => setAction("pin")}
          onOpenSettings={() => setAction("settings")}
          onClose={() => setAction("close")}
        />
      )}
    </div>
  );
}
render(<Fixture />, document.getElementById("picker-root")!);
