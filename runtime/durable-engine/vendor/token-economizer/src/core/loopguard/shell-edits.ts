// SPDX-License-Identifier: Apache-2.0
// Selected fixes backported from microsoft/TokenEconomizer@7042ea89dd5e5ecbc67ad865ad6e256e61be8bf0 (#212, #213, #209).
// Modified TypeScript port of Microsoft TokenEconomizer, revision 81e32e56bb3c4c1b4c9756b429be91e3960116ca; see ../../../LICENSE.
// Ported from TokenEconomizer loopguard/shell_edits.py.
import { basename } from "./state.ts";
export function splitHeredocs(command: string) {
  const shell: string[] = [], bodies: string[] = [];let tag: string | null = null, body: string[] = [];
  for (const line of command.split("\n")) {
    if (tag !== null) {if (line.trim() === tag) {bodies.push(body.join("\n"));tag = null;body = [];} else body.push(line);continue;}
    shell.push(line);const match = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(line);if (match) tag = match[2];
  }
  if (tag !== null) bodies.push(body.join("\n"));return {shell:shell.join("\n"),bodies};
}
export function shellTokens(text: string): string[] {
  const tokens: string[] = [];let buffer = "", quote = "";
  const push = () => {if (buffer) tokens.push(buffer);buffer = "";};
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {buffer += char;if (char === quote) quote = "";else if (char === "\\" && quote === '"' && i+1 < text.length) buffer += text[++i];continue;}
    if (char === "'" || char === '"') {quote = char;buffer += char;continue;}
    if (char === "#" && !buffer) {while (i < text.length && text[i] !== "\n") i++;push();if (i < text.length) tokens.push("\n");continue;}
    if (/[ \t\r]/.test(char)) {push();continue;}
    if (/[();<>|&\n]/.test(char)) {
      push();let operator = char;while (i+1 < text.length && /[();<>|&\n]/.test(text[i+1])) operator += text[++i];tokens.push(operator);continue;
    }
    buffer += char;
  }
  if (quote) throw new Error("Unbalanced shell quoting");push();return tokens;
}
const operations = new Set(["&&","||",";",";;","|","|&","&","\n","(",")"]), outputOperators = new Set([">",">>",">|","&>","&>>"]), skipOperators = new Set(["<","<<","<<<","<&",">&","<>"]);
function unquote(token: string): string {return token.length >= 2 && token[0] === token.at(-1) && ["'",'"'].includes(token[0]) ? token.slice(1,-1) : token;}
function commands(shell: string) {
  let streams: string[][];
  try {streams = [shellTokens(shell)];} catch {streams = [];for (const line of shell.split("\n")) {try {streams.push([...shellTokens(line),"\n"]);} catch { /* A malformed external line must not hide the others. */ }}}
  const commands: string[][] = [], writes: string[] = [];
  for (const tokens of streams) {
    let current: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (operations.has(token)) {if (current.length) commands.push(current);current = [];}
      else if (outputOperators.has(token) || skipOperators.has(token)) {
        if (/^\d+$/.test(current.at(-1) ?? "")) current.pop();
        if (outputOperators.has(token) && i+1 < tokens.length && !operations.has(tokens[i+1])) writes.push(unquote(tokens[i+1]));i++;
      } else current.push(unquote(token));
    }
    if (current.length) commands.push(current);
  }
  return {commands:commands.map(tokens => {let index = 0;while (index < tokens.length && (["sudo","command","env","time","nohup"].includes(tokens[index]) || /^\w+=/.test(tokens[index]))) index++;return tokens.slice(index);}).filter(tokens => tokens.length),writes};
}
const sourceFile = /\.(?:py|pyi|pyx|pxd|js|jsx|mjs|cjs|ts|tsx|rs|go|java|kt|kts|scala|c|cc|cpp|cxx|h|hh|hpp|rb|php|cs|swift|m|mm|sh|bash|zsh|lua|jl|ex|exs|erl|hs|ml|clj|sql|toml|ya?ml|json|cfg|ini|conf|md|rst|html?|css|scss|vue|svelte|xml|gradle|properties|in)$/i;
function notScratch(path: string): boolean {return Boolean(path) && !/^\/(?:dev|proc|tmp)\//.test(path);}
const gitValueOptions = new Set(["-C","-c","--git-dir","--work-tree","--namespace","--config-env","--attr-source"]);
function gitArgs(tokens:string[]):string[] {
  if (basename(tokens[0]) !== "git") return [];
  let index=1;while(index<tokens.length && tokens[index].startsWith("-")) index+=gitValueOptions.has(tokens[index]) ? 2 : 1;
  return tokens.slice(index);
}
function restored(tokens: string[]): string[] {
  const args=gitArgs(tokens);if(args.length<2 || !["checkout","restore"].includes(args[0])) return [];
  const rest = args.includes("--") ? args.slice(args.indexOf("--")+1) : args[0] === "restore" ? args.slice(1) : [];
  return rest.filter(token => !token.startsWith("-"));
}
function scriptFlag(token: string,perl: boolean): "next" | "inline" | null {
  if (!perl) {if (["--expression","--file"].includes(token)) return "next";if (/^--(?:expression|file)=/.test(token)) return "inline";}
  if (token.startsWith("--") || token.length < 2) return null;
  for (let i = 1; i < token.length; i++) {if ((perl ? "iIMmxdDC" : "i").includes(token[i])) return null;if ((perl ? "eE" : "ef").includes(token[i])) return token.slice(i+1) ? "inline" : "next";}
  return null;
}
function inplaceFiles(tokens: string[],perl: boolean): string[] {
  if (!tokens.slice(1).some(token => (perl ? /^-[a-zA-Z]*i/ : /^(?:-[a-zA-Z]*i|--in-place)/).test(token))) return [];
  const files: string[] = [];let script = false, skip = false;
  for (const token of tokens.slice(1)) {
    if (skip) {skip = false;script = true;continue;}
    if (!token || token.startsWith("-")) {const where = scriptFlag(token,perl);if (where === "next") skip = true;else if (where === "inline") script = true;continue;}
    if (!script) {script = true;continue;}files.push(token);
  }
  return files;
}
function pythonWrites(text: string): string[] {
  const paths: string[] = [], variables: string[] = [];
  for (const match of text.matchAll(/open\(\s*(['"])([^'"\n]+)\1\s*,\s*(['"])([^'"]*)\3/g)) if (/[wax+]/.test(match[4])) paths.push(match[2]);
  for (const match of text.matchAll(/open\(\s*([A-Za-z_]\w*)\s*,\s*(['"])([^'"]*)\2/g)) if (/[wax+]/.test(match[3])) variables.push(match[1]);
  for (const match of text.matchAll(/(?:pathlib\.)?Path\(\s*(['"])([^'"\n]+)\1\s*\)\.write_(?:text|bytes)\(/g)) paths.push(match[2]);
  for (const match of text.matchAll(/\b([A-Za-z_]\w*)\.write_(?:text|bytes)\(/g)) variables.push(match[1]);
  for (const variable of new Set(variables)) {
    // The interpolated name is constrained by the identifier patterns above, never arbitrary regex input.
    const found = Array.from(text.matchAll(new RegExp(`\\b${variable}\\s*=\\s*(?:(?:pathlib\\.)?Path\\(\\s*)?(['"])([^'"\\n]+)\\1`,"g")),match => match[2]);
    const loop = new RegExp(`\\bfor\\s+${variable}\\s+in\\s*[\\[(]([^\\])]*)[\\])]`).exec(text);
    if (loop) found.push(...Array.from(loop[1].matchAll(/['"]([^'"]+)['"]/g),match => match[1]));
    paths.push(...found.length ? found : ["(script)"]);
  }
  return paths;
}
export function shellRevertTargets(command: string): string[] {
  const parsed = commands(splitHeredocs(command).shell);return [...new Set(parsed.commands.flatMap(restored).filter(notScratch).map(basename).filter(Boolean))];
}
export function shellEditTargets(command: string): string[] {
  const {shell,bodies} = splitHeredocs(command), parsed = commands(shell), found = parsed.writes.filter(path => sourceFile.test(path));
  for (const tokens of parsed.commands) {
    const head = basename(tokens[0]);
    if (head === "sed" || head === "perl") found.push(...inplaceFiles(tokens,head === "perl"));
    else if (head === "tee") found.push(...tokens.slice(1).filter(token => !token.startsWith("-") && sourceFile.test(token)));
    else if (head === "apply_patch") {const paths = Array.from([...bodies,tokens.slice(1).join(" ")].join("\n").matchAll(/^\*\*\* (?:Update|Add|Delete) File:\s*(.+?)\s*$/gm),match => match[1]);found.push(...paths.length ? paths : ["(patch)"]);}
    else if (head === "patch" || gitArgs(tokens)[0] === "apply") found.push("(patch)");
    else found.push(...restored(tokens));
  }
  if (/(?:^|[\s/;&|(])python\d?(?:\.\d+)?\b/.test(shell)) found.push(...pythonWrites([shell,...bodies].join("\n")));
  return [...new Set(found.filter(path => path.startsWith("(") || notScratch(path)).map(path => path.startsWith("(") ? path : basename(path)).filter(Boolean))];
}
