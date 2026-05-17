/**
 * Syntax highlighting using CodeMirror/Lezer parsers via window.cmHighlight global.
 * Deferred-loaded — returns plain escaped HTML if global not available yet.
 */
import { bicepMode } from "./bicep-mode";

function getCm(): PiclawCmHighlight | null {
  return window.cmHighlight ?? null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Language label aliases (human-readable names)
const LANGUAGE_LABEL_ALIASES: Record<string, string> = {
  js: "JavaScript", javascript: "JavaScript",
  ts: "TypeScript", typescript: "TypeScript",
  jsx: "JSX", tsx: "TSX",
  py: "Python", python: "Python",
  sh: "Shell", shell: "Shell", bash: "Bash", zsh: "Zsh",
  ps1: "PowerShell", powershell: "PowerShell",
  md: "Markdown", markdown: "Markdown",
  yml: "YAML", yaml: "YAML",
  json: "JSON", html: "HTML", css: "CSS", sql: "SQL",
  go: "Go",
  c: "C", cc: "C++", cpp: "C++", "c++": "C++", cxx: "C++",
  h: "C/C++", hh: "C++", hpp: "C++", hxx: "C++",
  rust: "Rust", rs: "Rust",
  ruby: "Ruby", rb: "Ruby",
  swift: "Swift",
  toml: "TOML",
  dockerfile: "Dockerfile",
  bicep: "Bicep",
  xml: "XML",
  plaintext: "Text", text: "Text",
  // Extended languages
  asm: "Gas", s: "Gas", gas: "Gas",
  clj: "Clojure", clojure: "Clojure",
  cmake: "CMake",
  coffee: "CoffeeScript", coffeescript: "CoffeeScript",
  conf: "nginx", nginx: "nginx",
  cr: "Crystal", crystal: "Crystal",
  cypher: "Cypher",
  d: "D",
  diff: "Diff", patch: "Diff",
  eiffel: "Eiffel",
  elm: "Elm",
  erl: "Erlang", erlang: "Erlang",
  f90: "Fortran", f95: "Fortran", fortran: "Fortran",
  factor: "Factor",
  feature: "Gherkin", gherkin: "Gherkin",
  forth: "Forth",
  fsharp: "ML",
  groovy: "Groovy",
  haskell: "Haskell", hs: "Haskell",
  haxe: "Haxe", hx: "Haxe",
  http: "HTTP",
  ini: "Properties", properties: "Properties",
  jade: "Pug", pug: "Pug",
  jinja: "Jinja2", jinja2: "Jinja2",
  jl: "Julia", julia: "Julia",
  latex: "LaTeX", tex: "LaTeX",
  livescript: "LiveScript", ls: "LiveScript",
  lua: "Lua",
  mathematica: "Mathematica", wl: "Mathematica",
  matlab: "Octave", octave: "Octave",
  ml: "ML", mllike: "ML", ocaml: "ML", sml: "ML", fs: "ML",
  oz: "Oz",
  pas: "Pascal", pascal: "Pascal",
  perl: "Perl", pl: "Perl", pm: "Perl",
  pp: "Puppet", puppet: "Puppet",
  proto: "Protobuf", protobuf: "Protobuf",
  r: "R",
  rq: "SPARQL", sparql: "SPARQL",
  sas: "SAS",
  sass: "Sass", scss: "Sass",
  scheme: "Scheme", scm: "Scheme",
  smalltalk: "Smalltalk", st: "Smalltalk",
  solr: "Solr",
  stex: "LaTeX",
  styl: "Stylus", stylus: "Stylus",
  sv: "Verilog", verilog: "Verilog",
  tcl: "Tcl",
  textile: "Textile",
  ttl: "Turtle", turtle: "Turtle",
  vb: "VB",
  vhdl: "VHDL",
  wasm: "WebAssembly", wast: "WebAssembly",
  webidl: "WebIDL",
  xq: "XQuery", xquery: "XQuery",
};

export function normalizeCodeLanguageLabel(lang: string): string {
  const raw = String(lang || "").trim().toLowerCase();
  if (!raw) return "Text";
  return LANGUAGE_LABEL_ALIASES[raw] || String(lang || "").trim();
}

// Cache legacy parsers so StreamLanguage.define is only called once
let _shellParser: { parse: (input: string) => unknown } | null = null;
let _powerShellParser: { parse: (input: string) => unknown } | null = null;
let _dockerFileParser: { parse: (input: string) => unknown } | null = null;
let _rubyParser: { parse: (input: string) => unknown } | null = null;
let _swiftParser: { parse: (input: string) => unknown } | null = null;
let _tomlParser: { parse: (input: string) => unknown } | null = null;
let _bicepParser: { parse: (input: string) => unknown } | null = null;
let _clojureParser: { parse: (input: string) => unknown } | null = null;
let _cmakeParser: { parse: (input: string) => unknown } | null = null;
let _coffeeScriptParser: { parse: (input: string) => unknown } | null = null;
let _crystalParser: { parse: (input: string) => unknown } | null = null;
let _cypherParser: { parse: (input: string) => unknown } | null = null;
let _dParser: { parse: (input: string) => unknown } | null = null;
let _diffParser: { parse: (input: string) => unknown } | null = null;
let _eiffelParser: { parse: (input: string) => unknown } | null = null;
let _elmParser: { parse: (input: string) => unknown } | null = null;
let _erlangParser: { parse: (input: string) => unknown } | null = null;
let _factorParser: { parse: (input: string) => unknown } | null = null;
let _forthParser: { parse: (input: string) => unknown } | null = null;
let _fortranParser: { parse: (input: string) => unknown } | null = null;
let _gasParser: { parse: (input: string) => unknown } | null = null;
let _gherkinParser: { parse: (input: string) => unknown } | null = null;
let _groovyParser: { parse: (input: string) => unknown } | null = null;
let _haskellParser: { parse: (input: string) => unknown } | null = null;
let _haxeParser: { parse: (input: string) => unknown } | null = null;
let _httpParser: { parse: (input: string) => unknown } | null = null;
let _jinja2Parser: { parse: (input: string) => unknown } | null = null;
let _juliaParser: { parse: (input: string) => unknown } | null = null;
let _liveScriptParser: { parse: (input: string) => unknown } | null = null;
let _luaParser: { parse: (input: string) => unknown } | null = null;
let _mathematicaParser: { parse: (input: string) => unknown } | null = null;
let _mlLikeParser: { parse: (input: string) => unknown } | null = null;
let _nginxParser: { parse: (input: string) => unknown } | null = null;
let _octaveParser: { parse: (input: string) => unknown } | null = null;
let _ozParser: { parse: (input: string) => unknown } | null = null;
let _pascalParser: { parse: (input: string) => unknown } | null = null;
let _perlParser: { parse: (input: string) => unknown } | null = null;
let _propertiesParser: { parse: (input: string) => unknown } | null = null;
let _protobufParser: { parse: (input: string) => unknown } | null = null;
let _pugParser: { parse: (input: string) => unknown } | null = null;
let _puppetParser: { parse: (input: string) => unknown } | null = null;
let _rParser: { parse: (input: string) => unknown } | null = null;
let _sasParser: { parse: (input: string) => unknown } | null = null;
let _sassParser: { parse: (input: string) => unknown } | null = null;
let _schemeParser: { parse: (input: string) => unknown } | null = null;
let _smalltalkParser: { parse: (input: string) => unknown } | null = null;
let _solrParser: { parse: (input: string) => unknown } | null = null;
let _sparqlParser: { parse: (input: string) => unknown } | null = null;
let _stexParser: { parse: (input: string) => unknown } | null = null;
let _stylusParser: { parse: (input: string) => unknown } | null = null;
let _tclParser: { parse: (input: string) => unknown } | null = null;
let _textileParser: { parse: (input: string) => unknown } | null = null;
let _turtleParser: { parse: (input: string) => unknown } | null = null;
let _vbParser: { parse: (input: string) => unknown } | null = null;
let _verilogParser: { parse: (input: string) => unknown } | null = null;
let _vhdlParser: { parse: (input: string) => unknown } | null = null;
let _wastParser: { parse: (input: string) => unknown } | null = null;
let _webIDLParser: { parse: (input: string) => unknown } | null = null;
let _xQueryParser: { parse: (input: string) => unknown } | null = null;

function getLegacyParser(cm: PiclawCmHighlight, name: string): { parse: (input: string) => unknown } | null {
  switch (name) {
    case "shell": return _shellParser ??= cm.StreamLanguage.define(cm.shell).parser;
    case "powershell": return _powerShellParser ??= cm.StreamLanguage.define(cm.powerShell).parser;
    case "dockerfile": return _dockerFileParser ??= cm.StreamLanguage.define(cm.dockerFile).parser;
    case "ruby": return _rubyParser ??= cm.StreamLanguage.define(cm.ruby).parser;
    case "swift": return _swiftParser ??= cm.StreamLanguage.define(cm.swift).parser;
    case "toml": return _tomlParser ??= cm.StreamLanguage.define(cm.toml).parser;
    case "bicep": return _bicepParser ??= cm.StreamLanguage.define(bicepMode).parser;
    case "clojure": return _clojureParser ??= cm.StreamLanguage.define(cm.clojure).parser;
    case "cmake": return _cmakeParser ??= cm.StreamLanguage.define(cm.cmake).parser;
    case "coffeescript": return _coffeeScriptParser ??= cm.StreamLanguage.define(cm.coffeeScript).parser;
    case "crystal": return _crystalParser ??= cm.StreamLanguage.define(cm.crystal).parser;
    case "cypher": return _cypherParser ??= cm.StreamLanguage.define(cm.cypher).parser;
    case "d": return _dParser ??= cm.StreamLanguage.define(cm.d).parser;
    case "diff": return _diffParser ??= cm.StreamLanguage.define(cm.diff).parser;
    case "eiffel": return _eiffelParser ??= cm.StreamLanguage.define(cm.eiffel).parser;
    case "elm": return _elmParser ??= cm.StreamLanguage.define(cm.elm).parser;
    case "erlang": return _erlangParser ??= cm.StreamLanguage.define(cm.erlang).parser;
    case "factor": return _factorParser ??= cm.StreamLanguage.define(cm.factor).parser;
    case "forth": return _forthParser ??= cm.StreamLanguage.define(cm.forth).parser;
    case "fortran": return _fortranParser ??= cm.StreamLanguage.define(cm.fortran).parser;
    case "gas": return _gasParser ??= cm.StreamLanguage.define(cm.gas).parser;
    case "gherkin": return _gherkinParser ??= cm.StreamLanguage.define(cm.gherkin).parser;
    case "groovy": return _groovyParser ??= cm.StreamLanguage.define(cm.groovy).parser;
    case "haskell": return _haskellParser ??= cm.StreamLanguage.define(cm.haskell).parser;
    case "haxe": return _haxeParser ??= cm.StreamLanguage.define(cm.haxe).parser;
    case "http": return _httpParser ??= cm.StreamLanguage.define(cm.http).parser;
    case "jinja2": return _jinja2Parser ??= cm.StreamLanguage.define(cm.jinja2).parser;
    case "julia": return _juliaParser ??= cm.StreamLanguage.define(cm.julia).parser;
    case "livescript": return _liveScriptParser ??= cm.StreamLanguage.define(cm.liveScript).parser;
    case "lua": return _luaParser ??= cm.StreamLanguage.define(cm.lua).parser;
    case "mathematica": return _mathematicaParser ??= cm.StreamLanguage.define(cm.mathematica).parser;
    case "mllike": return _mlLikeParser ??= cm.StreamLanguage.define(cm.fSharp).parser;
    case "nginx": return _nginxParser ??= cm.StreamLanguage.define(cm.nginx).parser;
    case "octave": return _octaveParser ??= cm.StreamLanguage.define(cm.octave).parser;
    case "oz": return _ozParser ??= cm.StreamLanguage.define(cm.oz).parser;
    case "pascal": return _pascalParser ??= cm.StreamLanguage.define(cm.pascal).parser;
    case "perl": return _perlParser ??= cm.StreamLanguage.define(cm.perl).parser;
    case "properties": return _propertiesParser ??= cm.StreamLanguage.define(cm.properties).parser;
    case "protobuf": return _protobufParser ??= cm.StreamLanguage.define(cm.protobuf).parser;
    case "pug": return _pugParser ??= cm.StreamLanguage.define(cm.pug).parser;
    case "puppet": return _puppetParser ??= cm.StreamLanguage.define(cm.puppet).parser;
    case "r": return _rParser ??= cm.StreamLanguage.define(cm.r).parser;
    case "sas": return _sasParser ??= cm.StreamLanguage.define(cm.sas).parser;
    case "sass": return _sassParser ??= cm.StreamLanguage.define(cm.sass).parser;
    case "scheme": return _schemeParser ??= cm.StreamLanguage.define(cm.scheme).parser;
    case "smalltalk": return _smalltalkParser ??= cm.StreamLanguage.define(cm.smalltalk).parser;
    case "solr": return _solrParser ??= cm.StreamLanguage.define(cm.solr).parser;
    case "sparql": return _sparqlParser ??= cm.StreamLanguage.define(cm.sparql).parser;
    case "stex": return _stexParser ??= cm.StreamLanguage.define(cm.stex).parser;
    case "stylus": return _stylusParser ??= cm.StreamLanguage.define(cm.stylus).parser;
    case "tcl": return _tclParser ??= cm.StreamLanguage.define(cm.tcl).parser;
    case "textile": return _textileParser ??= cm.StreamLanguage.define(cm.textile).parser;
    case "turtle": return _turtleParser ??= cm.StreamLanguage.define(cm.turtle).parser;
    case "vb": return _vbParser ??= cm.StreamLanguage.define(cm.vb).parser;
    case "verilog": return _verilogParser ??= cm.StreamLanguage.define(cm.verilog).parser;
    case "vhdl": return _vhdlParser ??= cm.StreamLanguage.define(cm.vhdl).parser;
    case "wast": return _wastParser ??= cm.StreamLanguage.define(cm.wast).parser;
    case "webidl": return _webIDLParser ??= cm.StreamLanguage.define(cm.webIDL).parser;
    case "xquery": return _xQueryParser ??= cm.StreamLanguage.define(cm.xQuery).parser;
    default: return null;
  }
}

export function parserForCodeFenceLanguage(lang: string): { parse: (input: string) => unknown } | null {
  const cm = getCm();
  if (!cm) return null;

  const raw = String(lang || "").trim().toLowerCase();
  switch (raw) {
    case "js": case "javascript": return cm.javascriptLanguage.parser;
    case "ts": case "typescript": return cm.typescriptLanguage.parser;
    case "jsx": return cm.jsxLanguage.parser;
    case "tsx": return cm.tsxLanguage.parser;
    case "py": case "python": return cm.pythonLanguage.parser;
    case "json": return cm.jsonLanguage.parser;
    case "css": return cm.cssLanguage.parser;
    case "html": return cm.htmlLanguage.parser;
    case "xml": return cm.xmlLanguage.parser;
    case "yaml": case "yml": return cm.yamlLanguage.parser;
    case "md": case "markdown": return cm.markdownLanguage.parser;
    case "sql": return cm.StandardSQL.language.parser;
    case "go": return cm.goLanguage.parser;
    case "c": case "cc": case "cpp": case "cxx": case "c++":
    case "h": case "hh": case "hpp": case "hxx": return cm.cppLanguage.parser;
    case "rs": case "rust": return cm.rustLanguage.parser;
    case "sh": case "bash": case "shell": case "zsh": return getLegacyParser(cm, "shell");
    case "ps1": case "powershell": return getLegacyParser(cm, "powershell");
    case "dockerfile": return getLegacyParser(cm, "dockerfile");
    case "rb": case "ruby": return getLegacyParser(cm, "ruby");
    case "swift": return getLegacyParser(cm, "swift");
    case "toml": return getLegacyParser(cm, "toml");
    case "bicep": return getLegacyParser(cm, "bicep");
    case "asm": case "s": case "gas": return getLegacyParser(cm, "gas");
    case "clj": case "clojure": return getLegacyParser(cm, "clojure");
    case "cmake": return getLegacyParser(cm, "cmake");
    case "coffee": case "coffeescript": return getLegacyParser(cm, "coffeescript");
    case "conf": case "nginx": return getLegacyParser(cm, "nginx");
    case "cr": case "crystal": return getLegacyParser(cm, "crystal");
    case "cypher": return getLegacyParser(cm, "cypher");
    case "d": return getLegacyParser(cm, "d");
    case "diff": case "patch": return getLegacyParser(cm, "diff");
    case "eiffel": return getLegacyParser(cm, "eiffel");
    case "elm": return getLegacyParser(cm, "elm");
    case "erl": case "erlang": return getLegacyParser(cm, "erlang");
    case "f90": case "f95": case "fortran": return getLegacyParser(cm, "fortran");
    case "factor": return getLegacyParser(cm, "factor");
    case "feature": case "gherkin": return getLegacyParser(cm, "gherkin");
    case "forth": return getLegacyParser(cm, "forth");
    case "fsharp": case "ml": case "mllike": case "ocaml": case "sml": return getLegacyParser(cm, "mllike");
    case "groovy": return getLegacyParser(cm, "groovy");
    case "haskell": case "hs": return getLegacyParser(cm, "haskell");
    case "haxe": case "hx": return getLegacyParser(cm, "haxe");
    case "http": return getLegacyParser(cm, "http");
    case "ini": case "properties": return getLegacyParser(cm, "properties");
    case "jade": case "pug": return getLegacyParser(cm, "pug");
    case "jinja": case "jinja2": return getLegacyParser(cm, "jinja2");
    case "jl": case "julia": return getLegacyParser(cm, "julia");
    case "latex": case "tex": case "stex": return getLegacyParser(cm, "stex");
    case "livescript": case "ls": return getLegacyParser(cm, "livescript");
    case "lua": return getLegacyParser(cm, "lua");
    case "mathematica": case "wl": return getLegacyParser(cm, "mathematica");
    case "matlab": case "octave": return getLegacyParser(cm, "octave");
    case "oz": return getLegacyParser(cm, "oz");
    case "pas": case "pascal": return getLegacyParser(cm, "pascal");
    case "perl": case "pl": case "pm": return getLegacyParser(cm, "perl");
    case "pp": case "puppet": return getLegacyParser(cm, "puppet");
    case "proto": case "protobuf": return getLegacyParser(cm, "protobuf");
    case "r": return getLegacyParser(cm, "r");
    case "rq": case "sparql": return getLegacyParser(cm, "sparql");
    case "sas": return getLegacyParser(cm, "sas");
    case "sass": case "scss": return getLegacyParser(cm, "sass");
    case "scheme": case "scm": return getLegacyParser(cm, "scheme");
    case "smalltalk": case "st": return getLegacyParser(cm, "smalltalk");
    case "solr": return getLegacyParser(cm, "solr");
    case "styl": case "stylus": return getLegacyParser(cm, "stylus");
    case "sv": case "verilog": return getLegacyParser(cm, "verilog");
    case "tcl": return getLegacyParser(cm, "tcl");
    case "textile": return getLegacyParser(cm, "textile");
    case "ttl": case "turtle": return getLegacyParser(cm, "turtle");
    case "vb": return getLegacyParser(cm, "vb");
    case "vhdl": return getLegacyParser(cm, "vhdl");
    case "wasm": case "wast": return getLegacyParser(cm, "wast");
    case "webidl": return getLegacyParser(cm, "webidl");
    case "xq": case "xquery": return getLegacyParser(cm, "xquery");
    default: return null;
  }
}

interface TokenSegment { from: number; to: number; cls: string; }

export function highlightCodeToHtml(code: string, lang: string): string {
  const parser = parserForCodeFenceLanguage(lang);
  if (!parser) return escapeHtml(code);

  const cm = getCm()!;
  const tokens: TokenSegment[] = [];
  try {
    const tree = parser.parse(code);
    cm.highlightTree(tree, cm.classHighlighter, (from: number, to: number, cls: string) => {
      if (!cls || from >= to) return;
      tokens.push({ from, to, cls });
    });
  } catch {
    return escapeHtml(code);
  }

  if (!tokens.length) return escapeHtml(code);
  tokens.sort((a, b) => a.from - b.from || a.to - b.to);

  let cursor = 0;
  let html = "";
  for (const token of tokens) {
    if (token.from > cursor) html += escapeHtml(code.slice(cursor, token.from));
    html += `<span class="${escapeHtml(token.cls)}">${escapeHtml(code.slice(token.from, token.to))}</span>`;
    cursor = Math.max(cursor, token.to);
  }
  if (cursor < code.length) html += escapeHtml(code.slice(cursor));
  return html;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function applySyntaxHighlighting(html: string): string {
  if (!html) return html;
  return html.replace(
    /<pre><code(?:\s+class="language-([A-Za-z0-9_+-]+)")?>([\s\S]*?)<\/code><\/pre>/g,
    (_match, lang, code) => {
      const normalizedLang = String(lang || "").trim().toLowerCase();
      const decodedCode = decodeHtmlEntities(decodeHtmlEntities(code));
      const highlighted = highlightCodeToHtml(decodedCode, normalizedLang);
      const langClass = normalizedLang || "plaintext";
      const humanLabel = normalizeCodeLanguageLabel(langClass);
      // UTF-8 safe base64 encode the raw code for the copy button
      const encodedCode = btoa(unescape(encodeURIComponent(decodedCode)));
      return [
        `<div class="code-block">`,
        `<div class="code-block__header">`,
        `<span class="code-block__lang">${escapeHtml(humanLabel)}</span>`,
        `<button class="code-block__copy" aria-label="Copy code" data-code="${encodedCode}">`,
        `<i class="codicon codicon-copy"></i>`,
        `</button>`,
        `</div>`,
        `<pre><code class="hljs language-${langClass}">${highlighted}</code></pre>`,
        `</div>`,
      ].join("");
    }
  );
}
