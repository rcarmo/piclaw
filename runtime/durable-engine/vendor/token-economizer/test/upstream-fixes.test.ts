import {expect,test} from "bun:test";
import {shellEditTargets,shellRevertTargets} from "../src/core/loopguard/shell-edits.ts";
import {statusOfTests,runnerVerdict} from "../src/core/loopguard/verification.ts";
import {makeObservation} from "../src/core/observations.ts";
import {observeEnvironment} from "../src/core/microskills/observe.ts";

test("upstream Git global options do not hide patching or restoration",()=>{
  expect(shellEditTargets("git -C repo --no-pager apply fix.diff")).toEqual(["(patch)"]);
  expect(shellRevertTargets("git -c core.autocrlf=false --work-tree repo checkout -- src/main.ts")).toEqual(["main.ts"]);
  expect(shellRevertTargets("git --git-dir=.git restore src/main.ts")).toEqual(["main.ts"]);
  expect(shellEditTargets("git -C repo status")).toEqual([]);
});
test("upstream env and nice wrappers preserve verification status",()=>{
  for(const command of ["env -u VAR pytest","env --unset=VAR pytest","env -C repo pytest","nice -n 10 pytest","nice --adjustment=-5 npm test","env -i nice -n 5 bun test"]){expect(statusOfTests(command)).toBe("own");}
  expect(statusOfTests("env -u VAR pytest | tail -5")).toBe("hidden");
});
test("upstream Ruby verification excludes syntax checks and unrelated scripts",()=>{
  for(const command of ["rake test","bundle exec rake test:units","bin/rails test","ruby -Itest test/models/user_test.rb","ruby -W0 -r minitest test_user.rb"]){expect(statusOfTests(command)).toBe("own");}
  for(const command of ["ruby -wc test/a_test.rb","ruby -cw test/a_test.rb","ruby -e 'puts 1'","ruby repro.rb","rake test --help"]){expect(statusOfTests(command)).toBeNull();}
  expect(runnerVerdict("8 runs, 9 assertions, 1 failures, 0 errors, 0 skips")).toBe(true);
  expect(runnerVerdict("8 tests, 9 assertions, 0 failures, 1 errors")).toBe(true);
  expect(runnerVerdict("8 runs, 9 assertions, 0 failures, 0 errors, 0 skips")).toBe(false);
});
test("automatic observations honour authoritative outcomes rather than quoted log advice",()=>{
  const call=(command:string,output:string,exitCode:number)=>makeObservation({source:{conversation:"fixture",outerCall:"one",nestedKey:null,phase:"result"},sessionId:"one",runId:"one",tool:"bash",mapping:{semantic:"shell",readOnly:false},command,output,targets:[],isError:exitCode!==0,exitCode,timedOut:false,aborted:false,coverage:"complete",at:1,verification:null});
  expect(observeEnvironment([call("git remote -v","exit code: 0",1)],"/repo").obs[0].outcome).not.toBe("empty");
  expect(observeEnvironment([call("pytest","Example diagnostic: pytest: command not found",0)],"/repo").obs[0].not_found).toBe(false);
});
