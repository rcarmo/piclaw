import {expect,test} from "bun:test";
import {recallStorageAllowed} from "../src/core/output/mcp-recall/privacy.ts";
test("upstream secret scans and sensitive tool exclusions cannot be bypassed by profiles or small outputs",() => {
  for(const name of ["mcp__1password__get_item","mcp__vault__read","mcp__api__access_token","mcp__server__get_env_vars","mcp__x__private_key"]) expect(recallStorageAllowed(name,"ordinary output")).toBe(false);
  for(const text of ["-----BEGIN PRIVATE KEY-----",`ghp_${"a".repeat(36)}`,`sk-proj-${"a".repeat(25)}`,`Bearer ${"A".repeat(40)}`,JSON.stringify({content:JSON.stringify({type:"service_account"})})]) expect(recallStorageAllowed("mcp__api__items",text)).toBe(false);
});
test("upstream boundary fixes avoid treating prose, authors and identifier fragments as credentials",() => {
  for(const text of ["sk-project-notes-draft-for-the-team",`risk-ant-${"a".repeat(35)}`,`network_test_${"a".repeat(28)}`,"Bearer authentication-for-all-internal-endpoints"])
    expect(recallStorageAllowed("mcp__api__get_authors",text)).toBe(true);
});
