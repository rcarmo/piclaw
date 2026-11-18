import { expect, test } from "bun:test";
import { failureIdentity, makeObservation, normalizeCommand, observationId, observationWindow, redact, relativeTarget, resultOutcome, type ObservationInput } from "../src/core/observations.ts";
const input: ObservationInput = {
  source: { conversation: "origin", outerCall: "outer", nestedKey: "nested", phase: "result" }, sessionId: "session", runId: "run",
  tool: "bash", mapping: { semantic: "shell", readOnly: false }, command: "bun test", targets: ["/repo/a.ts"], output: "Error 42 at a.ts:9",
  isError: false, exitCode: 1, timedOut: false, aborted: false, coverage: "complete", at: 100, verification: "failed",
};
test("outcomes do not invent success from missing exits or isError=false", () => {
  expect(resultOutcome({ ...input, exitCode: null })).toBe("unknown");
  expect(resultOutcome(input)).toBe("failure");
  expect(resultOutcome({ ...input, exitCode: 0 })).toBe("success");
  expect(resultOutcome({ ...input, exitCode: 0, isError: true })).toBe("failure");
  expect(resultOutcome({ ...input, timedOut: true })).toBe("timedOut");
  expect(resultOutcome({ ...input, aborted: true })).toBe("aborted");
});
test("source identities cannot collide at separators, forks or nested phases", () => {
  const a = observationId(input.source);
  expect(a).not.toBe(observationId({ ...input.source, conversation: "fork" }));
  expect(a).not.toBe(observationId({ ...input.source, nestedKey: null }));
  expect(observationId({ ...input.source, outerCall: "a/b", nestedKey: "c" })).not.toBe(observationId({ ...input.source, outerCall: "a", nestedKey: "b/c" }));
});
test("redaction happens before constructing durable observations", () => {
  const secrets = ["ultrasecret", "secondsecret", "thirdsecret", "fourthsecret", "fifthsecret", "sixthsecret", "seventhsecret", "eighthsecret"];
  const raw = '\u001b[31mError\u001b[0m\nAPI_KEY=ultrasecret\nhttps://name:secondsecret@host/path?%61ccess_token=thirdsecret&ordinary=fourthsecret\n{"password":"fifthsecret"}\napiToken=sixthsecret\nAuthorization: Bearer seventhsecret\nCUSTOM_SETTING="eighthsecret"';
  const observation = makeObservation({ ...input, output: raw, command: "CUSTOM_SETTING=ultrasecret bun test", targets: ["a.ts", "a.ts"] });
  for (const secret of secrets) expect(JSON.stringify(observation)).not.toContain(secret);
  for (const label of ["token", "aws_secret_access_key", "privateKey", "clientSecret", "credentials", "refreshToken"]) expect(redact(JSON.stringify({ [label]: "must-not-persist" }))).not.toContain("must-not-persist");
  expect(observation.output).toContain("Error");
  expect(observation.output).not.toContain("\u001b");
  expect(observation.targets).toEqual(["a.ts"]);
  expect(observation.nested).toBe(true);
  expect(observation.parentId).toBe("outer");
  expect(redact("-----BEGIN PRIVATE KEY-----\nmaterial\n-----END PRIVATE KEY-----")).toBe("[REDACTED KEY]");
});
test("exact failure identity keeps meaningful numbers, paths, commands and quoted whitespace", () => {
  const observation = makeObservation(input), identity = failureIdentity(observation, "/repo");
  for (const change of [{ output: "Error 43 at a.ts:9" }, { output: "Error 42 at b.ts:9" }, { targets: ["/repo/b.ts"] }, { command: "bun test a" }, { exitCode: 2 }]) expect(failureIdentity({ ...observation, ...change }, "/repo")).not.toBe(identity);
  expect(failureIdentity({ ...observation, coverage: "partial" }, "/repo")).toBeNull();
  expect(failureIdentity({ ...observation, outcome: "unknown" }, "/repo")).toBeNull();
  expect(normalizeCommand("  bun\t  test  'a  b'  \n echo ok ")).toBe("bun test 'a  b'\necho ok");
  expect(normalizeCommand("echo 'a  b'")).not.toBe(normalizeCommand("echo 'a b'"));
  expect(relativeTarget("C:\\repo\\src\\a.ts", "C:\\repo")).toBe("src/a.ts");
  expect(relativeTarget("/repo-other/a.ts", "/repo")).toBe("/repo-other/a.ts");
});
test("bounded windows can be complete but missing results cannot", () => {
  const observation = makeObservation(input);
  const window = observationWindow([{ ...observation, coverage: "partial" }, ...Array.from({ length: 32 }, () => observation)]);
  expect(window.observations).toHaveLength(32);
  expect(window.coverage).toBe("complete");
  expect(observationWindow([observation, { ...observation, coverage: "partial" }]).coverage).toBe("partial");
});
