import { expect, test } from "bun:test";
import { Type } from "../../runtime/durable-engine/qualification/ai.ts";
import { createHostTool, assertHostToolBinding } from "../../runtime/durable-engine/src/host-tools.ts";

function fixture() {
  let active = true;
  const definition = { name: "identity_probe", label: "Probe", description: "Probe", parameters: Type.Object({}),
    async execute() { return { content: [{ type: "text" as const, text: "ok" }], details: {} }; } };
  const registration = createHostTool(definition, {
    authority: { check() { if (!active) throw Error("revoked"); } }, effectFence: "host-effect-port",
    invoke(args, call) { call.assertAllowed(); return call.execute(call.toolCallId, args, call.signal, call.onUpdate, undefined as never); },
  });
  return { definition, registration, revoke() { active = false; } };
}
test("binding proof requires exact constructed bridge and exact definition", () => {
  const a = fixture(), b = fixture();
  expect(() => assertHostToolBinding(a.registration, a.definition)).not.toThrow();
  for (const registration of [{ ...a.registration }, {}, b.registration])
    expect(() => assertHostToolBinding(registration, a.definition)).toThrow("identity");
  expect(() => assertHostToolBinding(a.registration, { ...a.definition })).toThrow("identity");
});
test("binding proof rejects source definition mutation and revoked host authority", () => {
  const a = fixture(); a.definition.description = "changed";
  expect(() => assertHostToolBinding(a.registration, a.definition)).toThrow("identity");
  const b = fixture(); b.definition.execute = async () => ({ content: [], details: {} });
  expect(() => assertHostToolBinding(b.registration, b.definition)).toThrow("identity");
  const c = fixture(); c.revoke();
  expect(() => assertHostToolBinding(c.registration, c.definition)).toThrow("authority unavailable");
});
