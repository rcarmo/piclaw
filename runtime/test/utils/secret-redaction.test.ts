import { expect, test } from "bun:test";
import { redactSecrets } from "../../src/utils/secret-redaction.js";

test("redacts credential values, secret-named keys and long strings recursively", () => {
  const input = {
    message: "push failed ghp_123456789012345678901234567890123456 with Bearer abcdefghijklmnopqrstuvwxyz",
    nested: [{ api_key: "plain-value", note: "sk-abcdefghijklmnopqrstuv" }],
    count: 3,
    ok: true,
    long: "word ".repeat(60),
  };
  const output = redactSecrets(input, { maxStringLength: 256 }) as typeof input;
  const text = JSON.stringify(output);
  expect(text).not.toContain("ghp_123456789012345678901234567890123456");
  expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz");
  expect(text).not.toContain("plain-value");
  expect(text).not.toContain("sk-abcdefghijklmnopqrstuv");
  expect(output.message).toContain("[redacted-github-token]");
  expect(output.nested[0].api_key).toBe("[redacted]");
  expect(output.count).toBe(3);
  expect(output.ok).toBe(true);
  expect(output.long).toStartWith("word ".repeat(51));
  expect(output.long).toContain("[truncated 44 chars]");
});
