import {expect,test} from "bun:test";
import {summarizeMcpOutput} from "../src/core/output/mcp.ts";
const items=Array.from({length:100},(_,id)=>({id,title:`Issue ${id}`,state:"open",body:"Detailed report ".repeat(40),ignored:"unused".repeat(100)}));
test("MCP JSON list summaries keep identifiers/counts and explicitly label omissions",()=>{
  const result=summarizeMcpOutput({tool:"mcp__github__list_issues",text:JSON.stringify({items})})!;expect(result.text).toContain("100 items");expect(result.text).toContain("Issue 0");expect(result.text).not.toContain("Issue 99");expect(result.text).toContain("incomplete overview");expect(result.reducedBytes).toBeLessThan(result.originalBytes*.8);
});
test("declarative MCP profiles use safe property paths, literal globs and selected fields",()=>{
  const text=JSON.stringify({data:{nodes:items}}),profiles=[{name:"issues",tool:"mcp__github__*",kind:"json-list" as const,path:"data.nodes",fields:["id","title","constructor.prototype","__proto__.polluted"],maxItems:2}];
  const result=summarizeMcpOutput({tool:"mcp__github__issues",text,profiles})!;expect(result.handler).toBe("profile:issues");expect(result.text).toContain("Issue 1");expect(result.text).not.toContain("Issue 2");expect(result.text).not.toContain("constructor");
});
test("browser and generic text overviews stay bounded; failures and small results pass through",()=>{
  const snapshot=Array.from({length:200},(_,n)=>`- button \"Button ${n}\" [ref=e${n}]`).join("\n");const reduced=summarizeMcpOutput({tool:"mcp__browser__snapshot",text:snapshot})!;expect(reduced.handler).toBe("builtin:browser-snapshot");expect(reduced.text).toContain("ref=e0");expect(reduced.text).toContain("200 lines");
  expect(summarizeMcpOutput({tool:"anything",text:"some output"})).toBeNull();expect(summarizeMcpOutput({tool:"anything",text:snapshot,isError:true})).toBeNull();expect(summarizeMcpOutput({tool:"api",text:JSON.stringify({data:{items},errors:[{message:"Access denied"}]})})).toBeNull();expect(summarizeMcpOutput({tool:"anything",text:"Error: important failure\n"+snapshot})).toBeNull();
  const plain=summarizeMcpOutput({tool:"unknown",text:"Plain long description ".repeat(500)})!;expect(plain.handler).toBe("builtin:text");expect(plain.text).toContain("abbreviated");
});
