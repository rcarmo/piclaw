import { expect, test } from "bun:test";
import { instructionHash, shouldManageInstructions } from "../../runtime/durable-engine/src/host-managed-instructions.js";

test("only last host-managed instructions may refresh; explicit SDK values are preserved exactly", () => {
  const prior = instructionHash("previous host base");
  expect(shouldManageInstructions("previous host base", prior)).toBe(true);
  for (const value of ["custom", "", undefined]) expect(shouldManageInstructions(value, prior)).toBe(false);
  expect(shouldManageInstructions("", instructionHash(""))).toBe(true);
  for (const value of [undefined, ""]) expect(shouldManageInstructions(value, undefined)).toBe(true);
  expect(shouldManageInstructions("unmanaged custom", undefined)).toBe(false);
  expect(shouldManageInstructions("unmanaged custom", null)).toBe(false);
  expect(instructionHash("host base")).toMatch(/^[0-9a-f]{64}$/);
});
