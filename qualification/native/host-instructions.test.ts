import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHostInstructions } from "../../runtime/durable-engine/src/host-instructions.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "host-instructions-"));
  roots.push(root);
  const cwd = join(root, "workspace", "child");
  const agentDir = join(root, "profile");
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  mkdirSync(agentDir);
  const put = (path: string, text: string) => writeFileSync(path, text);
  put(join(root, "AGENTS.md"), "ancestor-contract");
  put(join(root, "workspace", "AGENTS.md"), "workspace-contract");
  put(join(cwd, "AGENTS.md"), "child-contract");
  put(join(agentDir, "AGENTS.md"), "profile-contract");
  return { cwd, agentDir, put };
}

test("current profile and workspace ancestry, prompt precedence and real appendices are stable", () => {
  const f = fixture();
  f.put(join(f.agentDir, "SYSTEM.md"), "profile-system");
  f.put(join(f.agentDir, "APPEND_SYSTEM.md"), "profile-append");
  f.put(join(f.cwd, ".pi", "SYSTEM.md"), "project-system");
  f.put(join(f.cwd, ".pi", "APPEND_SYSTEM.md"), "project-append");
  const options = { ...f, projectTrusted: true, channelAppendix: "actual-channel-appendix" };
  const text = loadHostInstructions(options);
  expect(loadHostInstructions(options)).toBe(text);
  for (const s of ["project-system", "project-append", "actual-channel-appendix", "workspace-contract", "child-contract"]) expect(text).toContain(s);
  expect(text).not.toContain("profile-system");
  expect(text).not.toContain("profile-append");
  expect(text.indexOf("profile-contract")).toBeLessThan(text.indexOf("ancestor-contract"));
  expect(text.indexOf("ancestor-contract")).toBeLessThan(text.indexOf("workspace-contract"));
  f.put(join(f.cwd, "AGENTS.md"), "updated-current-contract");
  expect(loadHostInstructions(options)).toContain("updated-current-contract");
});

test("untrusted project prompts fall back to profile; skill discovery is inert and optional", () => {
  const f = fixture();
  f.put(join(f.agentDir, "SYSTEM.md"), "profile-system");
  f.put(join(f.agentDir, "APPEND_SYSTEM.md"), "profile-append");
  f.put(join(f.cwd, ".pi", "SYSTEM.md"), "untrusted-system");
  const skill = join(f.agentDir, "skills", "sample");
  mkdirSync(skill, { recursive: true });
  f.put(join(skill, "SKILL.md"), "---\nname: sample\ndescription: fixture skill description\n---\nDO NOT EXECUTE BODY");
  const text = loadHostInstructions({ ...f, projectTrusted: false });
  expect(text).toContain("profile-system");
  expect(text).toContain("profile-append");
  expect(text).not.toContain("untrusted-system");
  expect(text).toContain("profile-contract");
  for (const contract of ["ancestor-contract", "workspace-contract", "child-contract"])
    expect(text).not.toContain(contract);
  expect(text).toContain("fixture skill description");
  expect(text).not.toContain("DO NOT EXECUTE BODY");
  expect(loadHostInstructions({ ...f, projectTrusted: false, noSkills: true })).not.toContain("fixture skill description");
});

test("rejects implicit process-relative roots", () => {
  expect(() => loadHostInstructions({ cwd: ".", agentDir: ".", projectTrusted: false })).toThrow("absolute");
});
