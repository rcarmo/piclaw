import { test, expect } from "bun:test";
import { createHostCodexProviderTools } from "../../runtime/durable-engine/src/host-codex-provider-tools.js";
test("host provider factory is importable without provider side effects", () => { expect(typeof createHostCodexProviderTools).toBe("function"); });
