import { expect,test } from "bun:test";
import { reduceToolOutput,outputFamily } from "../src/core/output/reduce.ts";
import { summarizeTestRun } from "../src/core/output/mcp-recall/tests.ts";
import { compilerDiagnosticsHandler } from "../src/core/output/mcp-recall/compilers.ts";
const passes = Array.from({length:120},(_,i) => `(pass) module > behaviour ${i} [0.10ms]`).join("\n");
const base = {command:"bun test",exitCode:0,output:`${passes}\n120 pass\n0 fail\nRan 120 tests across 8 files.`,fullOutputPath:"/tmp/full.log"};
test("mcp-recall test adapter compacts passing output, retains totals and a recovery path",() => {
  const result = reduceToolOutput(base)!;
  expect(result).not.toBeNull();expect(result.text).toContain("120 passed");expect(result.text).toContain("Ran 120 tests across 8 files.");expect(result.text).toContain("/tmp/full.log");expect(result.reducedBytes).toBeLessThan(result.originalBytes*.8);expect(base.output).toContain("behaviour 119");
});
test("failure assertions, locations and long values survive upstream clipping verbatim",() => {
  const diagnostic = `error: expected ${"exact-long-value-".repeat(30)}\nExpected: 4\nReceived: 7\n at /work/src/parser.test.ts:123:9\n(fail) parser > keeps boundaries [3ms]`;
  const result = reduceToolOutput({...base,exitCode:1,output:`${passes}\n${diagnostic}\n120 pass\n1 fail\nRan 121 tests across 8 files.`})!;
  expect(result.text).toContain(diagnostic);expect(result.text).toContain("Exit code: 1");expect(result.text).toContain("FAIL");
});
test("compiler summaries keep original diagnostic codes and columns",() => {
  const diagnostics = "src/app.ts(42,10): error TS2345: Argument is incompatible\nFound 1 error.";
  const output = `${Array.from({length:120},(_,i) => `Checking dependency-${i} v1.2.3`).join("\n")}\n${diagnostics}`;
  const result = reduceToolOutput({...base,command:"tsc --noEmit",exitCode:2,output})!;
  expect(result.text).toContain(diagnostics);expect(result.text).toContain("Exit code: 2");
});
for(const command of ["cat tests.txt","bun test | tail -10","bun test; echo done","bun test && npm test","echo $(bun test)","bun test --reporter=json","go test -json ./...","python app.py","bun test\ncat secrets"]) test(`do not rewrite or summarise shell/structured/unknown output: ${command}`,() => expect(reduceToolOutput({...base,command})).toBeNull());
for(const flags of [{aborted:true},{timedOut:true},{truncated:true},{exitCode:null},{fullOutputPath:""}]) test(`uncertain results pass through: ${JSON.stringify(flags)}`,() => expect(reduceToolOutput({...base,...flags})).toBeNull());
test("unknown logs, small savings and false passing summaries pass through",() => {
  expect(reduceToolOutput({...base,output:"The test runner was not installed.\n".repeat(80),exitCode:127})).toBeNull();
  expect(reduceToolOutput({...base,exitCode:1})).toBeNull();
  expect(reduceToolOutput({...base,output:"2 pass\n0 fail"})).toBeNull();
});
// Regression fixtures cover mcp-recall's independently parsed counts and failure shapes.
test("upstream handlers recognise pytest, Jest, Vitest and Go without executing a process",() => {
  for(const stdout of ["FAILED tests/test_a.py::test_a\nE   assert 1 == 2\n1 failed, 5 passed, 1 skipped in 1.23s","● wrong answer\nExpected: 2\nReceived: 3\nTests: 1 failed, 5 passed, 6 total","--- FAIL: TestOne (0.00s)\nFAIL\texample/pkg\t0.002s"]) expect(summarizeTestRun({stdout,stderr:"",exit_code:1})?.summary).toContain("FAIL");
  expect(summarizeTestRun({stdout:"ordinary log",stderr:"",exit_code:0})).toBeNull();
  expect(compilerDiagnosticsHandler("bash",{stdout:"unknown build failure",stderr:"",exit_code:1}).summary).toBe("unknown build failure");
  expect(outputFamily("bunx tsc --noEmit")).toBe("compiler");
});
