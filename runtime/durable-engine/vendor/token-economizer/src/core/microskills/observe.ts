// SPDX-License-Identifier: Apache-2.0
// Modified TypeScript port of Microsoft TokenEconomizer, revision 81e32e56bb3c4c1b4c9756b429be91e3960116ca; see ../../../LICENSE.
// Ported from TokenEconomizer microskills/observe.py (generic vocabulary).
import type { Observation } from "../types.ts";
import { safeEnvironmentName, safeEnvironmentValue } from "../privacy.ts";
import { compareCodePoints } from "../ordering.ts";
import { vocabulary as v } from "./vocabulary.ts";
import type { EnvironmentDigest, EnvironmentObservation } from "./envfacts.ts";
export function unwrapShell(command: string): string {
  const match = /^(?:\S*\/)?(?:ba|z|da|k)?sh\s+-(?:lc|cl|c)\s+([\s\S]*)$/.exec(command.trim());
  if (!match) return command;
  let inner = match[1].trim();
  if (inner.length >= 2 && inner[0] === inner.at(-1) && ["'",'"'].includes(inner[0])) {
    const quote = inner[0];inner = inner.slice(1,-1);if (quote === '"') inner = inner.replaceAll('\\"','"').replaceAll("\\$","$").replaceAll("\\\\","\\");
  }
  return inner;
}
export function withoutHeredocs(command: string, mark = false): string {
  const lines: string[] = [];let tag: string | null = null;
  for (const line of command.split("\n")) {
    if (tag !== null) {if (line.trim() === tag) tag = null;continue;}
    const match = /(?<!<)<<(?!<)-?\s*['"]?([A-Za-z_]\w*)['"]?/.exec(line);
    lines.push(match && mark ? line+" <heredoc>" : line);if (match) tag = match[1];
  }
  return lines.join("\n");
}
export function shellSegments(command: string): string[] {
  command = withoutHeredocs(unwrapShell(command),true);const segments: string[] = [];let quote = "", buffer = "";
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) {buffer += char;if (char === quote) quote = "";else if (char === "\\" && i+1 < command.length) buffer += command[++i];}
    else if (char === '"' || char === "'") {quote = char;buffer += char;}
    else if (["\n",";","|"].includes(char) || char === "&" && command[i+1] === "&") {segments.push(buffer);buffer = "";if (["&&","||"].includes(command.slice(i,i+2))) i++;}
    else buffer += char;
  }
  segments.push(buffer);return segments.map(segment => segment.trim().replace(/^[()]+|[()]+$/g,"").trim()).filter(Boolean);
}
function normalizedPath(path: string): string {
  path = path.replaceAll("\\","/").replace(/^\/([a-z])(?=\/|$)/i,(_,drive: string) => drive.toLowerCase()+":").replace(/^([a-z]):/i,(_,drive: string) => drive.toLowerCase()+":");
  const parts: string[] = [];
  for (const part of path.split("/")) {if (!part || part === ".") continue;if (part === ".." && parts.length && parts.at(-1) !== "..") parts.pop();else parts.push(part);}
  return (path.startsWith("/") ? "/" : "")+parts.join("/");
}
function cdTarget(here: string | null,target: string,root: string,top: string): string | null {
  if (here === null || /^[~$-]/.test(target)) return null;
  const path = normalizedPath(target), absolute = path.startsWith("/") || /^[a-z]:\//.test(path);
  const resolved = absolute ? path : normalizedPath((here ? here+"/" : "")+path), start = normalizedPath(root);
  if (absolute) return resolved === start || resolved === normalizedPath(top) ? "" : resolved.startsWith(start+"/") ? resolved.slice(start.length+1) : null;
  if (resolved === ".." || resolved.startsWith("../")) return normalizedPath(start+"/"+resolved) === normalizedPath(top) ? "" : null;
  return resolved;
}
const buildSubs = new Set(["build","check","compile","lint","vet","typecheck","type-check","clippy","package","verify","fmt","format"]);
const prefixes = new Set(["sudo","env","time","exec","nice","nohup","timeout"]);
const envAssignment = /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"\n]*"|'[^'\n]*'|\S+)\s+)+/;
function classify(head: string,rest: string[],body: string,prefix: string,segment: string,call: number): EnvironmentObservation | null {
  const base = head.replaceAll("\\","/").split("/").at(-1)!, form = (expr: string) => [prefix,expr].filter(Boolean).join(" ");
  let intent = "", expression = head, probe: string | null = null;
  if (v.interpreters.includes(base) || /^(?:python|node)\d(?:\.\d+)?$/.test(base)) {
    if (rest.length && rest.every(t => ["--version","-V","-VV","-v"].includes(t))) intent = "probe_env";
    else {
      const module = rest.indexOf("-m") >= 0 ? rest[rest.indexOf("-m")+1] ?? "" : "";
      const first = rest.find(token => !token.startsWith("-")), script = first && v.runner_scripts.some(script => first === script || first.endsWith("/"+script) || first.endsWith(script)) ? first.replace(/^\.\//,"") : "";
      if (v.runner_modules.includes(module)) {intent = "run_tests";expression = `${head} -m ${module}`;}
      else if (v.build_heads.includes(module)) {intent = "run_build";expression = `${head} -m ${module}`;}
      else if (script && (script !== "manage.py" || rest.includes("test"))) {intent = "run_tests";expression = `${head} ${script}`;}
      else intent = "run_interpreter";
    }
  } else if (v.runner_heads.includes(base)) intent = "run_tests";
  else if (v.runner_scripts.some(script => (head === script || head.endsWith("/"+script) || head === "./"+script) && (script !== "manage.py" || rest.includes("test")))) {intent = "run_tests";expression = `python ${head.replace(/^[./]+/,"")}`;}
  else if (v.task_heads.includes(base) && rest[0] === "test") {intent = "run_tests";expression = `${base} test`;}
  else if (["npm","yarn","pnpm","bun"].includes(base) && rest[0] === "run" && rest[1] && (rest[1].split(":")[0] === "test" || buildSubs.has(rest[1].split(":")[0]))) {intent = rest[1].split(":")[0] === "test" ? "run_tests" : "run_build";expression = `${base} run ${rest[1]}`;}
  else if (v.task_heads.includes(base) && buildSubs.has(rest[0])) {intent = "run_build";expression = `${base} ${rest[0]}`;}
  else if (v.build_heads.includes(base)) {intent = "run_build";expression = base;}
  else if (v.env_probe_heads.includes(base)) {intent = "probe_env";expression = base;}
  else if (v.fetch_heads.includes(base)) {intent = "fetch_remote";expression = base;}
  else if (base === "git" && rest.length) {
    const sub = rest[0];expression = `git ${sub}`;
    if (["fetch","clone","pull","ls-remote"].includes(sub)) intent = "fetch_remote";
    else {
      if (sub === "remote") probe = "remote";
      else if (sub === "branch" && rest.some(t => ["-a","-r","--all","--remotes","-ar","-ra"].includes(t))) probe = "branch";
      else if (sub === "tag" && rest.includes("--contains")) probe = "tag";
      else if (sub === "fsck") probe = "fsck";
      else if (sub === "stash" && rest[1] === "list") probe = "stash";
      else if (["show-ref","for-each-ref"].includes(sub)) probe = "refs";
      if (probe) intent = "probe_vcs_refs";
    }
  } else if (v.package_tools.includes(base)) {
    const fetch = /^(?:pip|npm|yarn|pnpm)/.test(base) && ["install","download","add","ci"].includes(rest[0]);
    intent = fetch ? "fetch_remote" : "package_tool";expression = fetch ? `${base} ${rest[0]}` : base;
  }
  if (!intent) return null;
  return {call,intent,form:form(expression),head,prefix,segment,hosts:intent === "fetch_remote" ? Array.from(body.matchAll(/https?:\/\/([^/\s'"`]+)/g),m => m[1]) : [],probe,outcome:null,labels:[],label_err:false,loaded:false,tests_ran:false,env:false,not_found:false};
}
export function classifyCommand(command: string,call = 0,cwd = "",root = "",top = root): EnvironmentObservation[] {
  const obs: EnvironmentObservation[] = [];let carried = "", here: string | null = cwd, cd = here ? `cd ${here} &&` : "";
  for (const typed of shellSegments(command)) {
    let segment = typed.replace(envAssignment,"").trim(), assigned = segment !== typed;
    const unwrapped = segment.replace(/^(?:(?:\S*\/)?rtk\s+(?:proxy\s+)?)/,"");segment = unwrapped.replace(envAssignment,"").trim();assigned ||= segment !== unwrapped;
    if (!segment) continue;
    const changed = /^cd\s+(['"]?)([^\s;&|'"\n]+)\1\s*$/.exec(segment);
    if (changed) {here = cdTarget(here,changed[2],root,top);cd = here === null ? `cd ${changed[2]} &&` : here ? `cd ${here} &&` : "";continue;}
    const activate = /^(?:source|\.)\s+\S*activate\s+([\w.-]+)\s*$/.exec(segment) ?? /^(?:conda|mamba)\s+activate\s+([\w.-]+)\s*$/.exec(segment);
    if (activate) {carried = `${/^(?:conda|mamba)/.test(segment) ? "conda" : "source"} activate ${activate[1]} &&`;continue;}
    let prefix = [cd,carried].filter(Boolean).join(" "), body = segment;
    const conda = /^(?:conda|mamba)\s+run\s+(?:--no-capture-output\s+|--live-stream\s+)*(?:-n|--name)\s+([\w.-]+)\s+/.exec(body);
    if (conda) {prefix = [prefix,`conda run -n ${conda[1]}`].filter(Boolean).join(" ");body = body.slice(conda[0].length);}
    const launch = /^(poetry|pipenv|uv|npx|bundle|yarn|pnpm)\s+(?:run|exec)\s+/.exec(body), npx = /^npx\s+(?:(?:--yes|-y|--no-install|--no)\s+)*/.exec(body), tool = /^(uvx|uv\s+tool\s+run|pipx\s+run)\s+/.exec(body);
    if (launch || npx || tool) {const match = launch ?? npx ?? tool!;prefix = [prefix,launch ? `${launch[1]} run` : npx ? "npx" : tool![1].startsWith("pipx") ? "pipx run" : "uvx"].filter(Boolean).join(" ");body = body.slice(match[0].length);}
    let tokens = body.trim().split(/\s+/);
    while (tokens.length && (prefixes.has(tokens[0]) || /^\w+=/.test(tokens[0]))) {if (/^\w+=/.test(tokens[0])) assigned = true;tokens = tokens.slice(tokens[0] === "timeout" ? 2 : 1);}
    if (!tokens.length) continue;
    const observation = classify(tokens[0],tokens.slice(1),body,prefix,segment,call);if (observation) {observation.env = assigned;obs.push(observation);}
  }
  return obs;
}
const errorClasses: [string,RegExp][] = [
  ["module_missing",/ModuleNotFoundError|No module named|Cannot find module|ERR_MODULE_NOT_FOUND/i], ["command_missing",/command not found|: not found\b|is not recognized/i],
  ["script_missing",/can't open file .*No such file or directory/i], ["permission_denied",/Permission denied|EACCES/i],
  ["usage_error",/^usage:|unrecognized arguments|no such option|error: argument|unknown option/im], ["connection_refused",/Connection refused|Failed to connect to|couldn't connect to|Could not connect|ECONNREFUSED/i],
  ["name_resolution",/Could not resolve host|Temporary failure in name resolution|Name or service not known|getaddrinfo|nodename nor servname|ENOTFOUND/i],
  ["unreachable",/Network is unreachable|No route to host|Connection timed out|Operation timed out|timed out after|ETIMEDOUT/i],
];
const loaded = /\bRan [1-9]\d* tests?\b|\b[1-9]\d* (?:passed|failed|passing|failing)\b|\bcollected [1-9]\d* items?\b/;
const loadedGeneric = /^ok\s+\S+\s+[\d.]+s\b|^--- (?:PASS|FAIL)\b|\btest result: (?:ok|FAILED)\b|\b[1-9]\d* examples?, \d+ failures?\b|\b(?:Passed|Failed)!\s+-|\bTests run: [1-9]\d*/m;
const probeHits = new Map<string,RegExp>([["remote",/^\S+\s+\S+\s+\((?:fetch|push)\)\s*$/m],["branch",/^\s*remotes\/\S+/m],["tag",/^v?\d+(?:\.\d+)+(?:[a-z]+\d*|\.post\d+|-\S+)?\s*$/m],["fsck",/^(?:unreachable|dangling)\s+(?:commit|tree|blob|tag)\s+[0-9a-f]{7,}/m],["stash",/^stash@\{\d+\}/m],["refs",/^[0-9a-f]{7,}\s+refs\//m]]);
const passThrough = new Set(["cd","echo","head","tail","cat","sort","uniq","tee","true","printf","less","more"]);
function testLabels(observation: EnvironmentObservation): string[] {
  const tokens = observation.segment.split(/\s+/), last = observation.form.split(/\s+/).at(-1)!, index = tokens.findIndex(token => token === last || token.replace(/^[./]+/,"") === last || token.endsWith("/"+last));
  const result: string[] = [];let skip = false, previous = "";
  for (const token of tokens.slice(index < 0 ? tokens.length : index+1)) {
    if (skip) {skip = false;previous = token;continue;}
    if (/^(?:2>|>|<|\|)/.test(token)) {skip = [">",">>","2>","<"].includes(token);previous = token;continue;}
    const structured = [".","::","/"].some(part => token.includes(part)), afterOption = previous.startsWith("-") && !previous.includes("=");
    if (!token.startsWith("-") && /^[A-Za-z_][\w.\-/]*(?:::[\w.\-\[\]]+)*$/.test(token) && (structured || !afterOption)) result.push(token);previous = token;
  }
  return result;
}
export function observeEnvironment(calls: Observation[],root: string,top = root): EnvironmentDigest {
  const result: EnvironmentDigest = {obs:[],edited:[...new Set(calls.filter(call => call.semantic === "edit" || call.semantic === "shell").flatMap(call => call.targets).map(path => path.replaceAll("\\","/").split("/").at(-1)!))].sort(compareCodePoints),n_calls:calls.length,env:[]};
  for (const [index,call] of calls.entries()) {
    if (call.semantic !== "shell" || /\bcd: [^\n]*: (?:No such file or directory|Not a directory)/.test(call.output)) continue;
    const command = call.command, output = call.output, obs = classifyCommand(command,index,"",root,top), hint = /\bexit code[:=\s]+(\d+)/i.exec(output);
    const success = call.exitCode !== null ? call.exitCode === 0 : call.outcome === "unknown" ? hint !== null && Number(hint[1]) === 0 : call.outcome === "success";
    const need = [...new Set(Array.from(output.matchAll(/environment variable\s+['"`]?([A-Z][A-Z0-9_]{2,})/g),match => match[1]))].filter(safeEnvironmentName).sort(compareCodePoints);
    const sets: Record<string,string> = {};
    for (const match of command.matchAll(/(?:^|[\s;&(])(?:export\s+)?([A-Z][A-Z0-9_]{2,})=(['"]?)([\w.\-/:]+)\2/g)) if (safeEnvironmentValue(match[1],match[3])) sets[match[1]] = match[3];
    for (const match of command.matchAll(/os\.environ(?:\.setdefault\(\s*|\[\s*)['"]([A-Z][A-Z0-9_]{2,})['"]\s*(?:,|\]\s*=)\s*['"]([\w.\-/:]+)['"]/g)) if (safeEnvironmentValue(match[1],match[2])) sets[match[1]] = match[2];
    if (need.length || Object.keys(sets).length) result.env.push({need,sets,ok:success && !/Traceback \(most recent call last\)|^\w*Error\b|\b[Ee]xit [Cc]ode[:=\s]+[1-9]/m.test(output),call:index});
    for (const o of obs) if (o.intent === "run_tests") {
      o.labels = testLabels(o);const heads = new Set(o.labels.map(label => label.split(/[./:]/)[0]));
      o.label_err = o.labels.length > 0 && (/Failed to import test module|unittest\.loader\._FailedTest|ERROR: (?:file or directory )?not found|no tests ran|module '[\w.]+' has no attribute/i.test(output) || Array.from(output.matchAll(/No module named ['"]?([\w.]+)/g)).some(match => heads.has(match[1].split(".")[0])));
      o.tests_ran = loaded.test(output) || loadedGeneric.test(output);o.loaded = o.labels.length > 0 && !o.label_err && o.tests_ran;
    }
    const homogeneous = shellSegments(command).filter(segment => !passThrough.has(segment.split(/\s+/)[0].split("/").at(-1)!)).length === obs.length && new Set(obs.map(o => o.intent)).size === 1;
    const error = !success ? errorClasses.find(([,pattern]) => pattern.test(output)) : undefined, network = error && ["connection_refused","name_resolution","unreachable"].includes(error[0]);
    if (error) {
      const targets = obs.filter(o => ["run_interpreter","run_tests","run_build","package_tool","fetch_remote"].includes(o.intent)), line = output.split("\n").find(line => error[1].test(line)) ?? "";
      let named = targets.filter(o => o.head && (output.includes(o.head) || line.includes(o.head.split("/").at(-1)!)));
      if (network) {named = targets.filter(o => o.intent === "fetch_remote" && (!o.hosts.length || o.hosts.some(host => output.includes(host))));if (!named.length) named = targets.filter(o => o.intent === "fetch_remote");}
      const chosen = named.length ? named : !success ? targets.slice(-1) : [], missingMatch = /([^\s:'"]+):\s+(?:command\s+)?not found\b(?!:)|command not found:\s+(\S+)|'([^']+)' is not recognized/i.exec(line), missing = missingMatch?.slice(1).find(Boolean)?.replaceAll("\\","/").split("/").at(-1);
      for (const o of chosen) {o.outcome = error[0];o.not_found = Boolean(missing) && o.head.replaceAll("\\","/").split("/").at(-1) === missing;}
      if (success) for (const o of obs) if (o.outcome === null) o.outcome = "ran";
    } else if (success) for (const o of obs) o.outcome = "ran";
    else {
      let first = true;for (const o of obs) if (["run_interpreter","run_tests","run_build","package_tool","fetch_remote"].includes(o.intent)) {o.outcome = first ? "ran" : null;first = false;} else o.outcome = o.intent === "probe_vcs_refs" ? null : "ran";
    }
    for (const o of obs) {
      if (o.intent === "probe_vcs_refs") o.outcome = !homogeneous ? null : probeHits.get(o.probe!)!.test(output) ? "hit" : success ? "empty" : null;
      if (o.intent === "fetch_remote" && o.outcome === "ran" && (!homogeneous || !success || !output.trim() || network)) o.outcome = null;
    }
    result.obs.push(...obs);
  }
  return result;
}
