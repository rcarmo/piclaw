/** Ambient type declarations for deferred vendor globals loaded via <script defer>. */

interface PiclawMarked {
  parse(src: string, options?: { headerIds?: boolean; mangle?: boolean }): string;
}

interface PiclawKaTeX {
  renderToString(tex: string, options?: { displayMode?: boolean; throwOnError?: boolean }): string;
}

interface PiclawBeautifulMermaid {
  renderMermaid(code: string, options?: Record<string, unknown>): Promise<string>;
  renderMermaidSync?(code: string, options?: Record<string, unknown>): string;
  THEMES: Record<string, Record<string, unknown>>;
  DEFAULTS: Record<string, unknown>;
}

interface PiclawCmHighlight {
  classHighlighter: unknown;
  highlightTree: (tree: unknown, highlighter: unknown, callback: (from: number, to: number, cls: string) => void) => void;
  StreamLanguage: { define: (spec: unknown) => { parser: { parse: (input: string) => unknown } } };
  // Language parsers — all have .parser property
  cssLanguage: { parser: { parse: (input: string) => unknown } };
  cppLanguage: { parser: { parse: (input: string) => unknown } };
  goLanguage: { parser: { parse: (input: string) => unknown } };
  htmlLanguage: { parser: { parse: (input: string) => unknown } };
  javascriptLanguage: { parser: { parse: (input: string) => unknown } };
  jsxLanguage: { parser: { parse: (input: string) => unknown } };
  tsxLanguage: { parser: { parse: (input: string) => unknown } };
  typescriptLanguage: { parser: { parse: (input: string) => unknown } };
  jsonLanguage: { parser: { parse: (input: string) => unknown } };
  markdownLanguage: { parser: { parse: (input: string) => unknown } };
  pythonLanguage: { parser: { parse: (input: string) => unknown } };
  rustLanguage: { parser: { parse: (input: string) => unknown } };
  StandardSQL: { language: { parser: { parse: (input: string) => unknown } } };
  xmlLanguage: { parser: { parse: (input: string) => unknown } };
  yamlLanguage: { parser: { parse: (input: string) => unknown } };
  dockerFile: unknown;
  powerShell: unknown;
  ruby: unknown;
  shell: unknown;
  swift: unknown;
  toml: unknown;
  clojure: unknown;
  cmake: unknown;
  coffeeScript: unknown;
  crystal: unknown;
  cypher: unknown;
  d: unknown;
  diff: unknown;
  eiffel: unknown;
  elm: unknown;
  erlang: unknown;
  factor: unknown;
  forth: unknown;
  fortran: unknown;
  gas: unknown;
  gherkin: unknown;
  groovy: unknown;
  haskell: unknown;
  haxe: unknown;
  http: unknown;
  jinja2: unknown;
  julia: unknown;
  liveScript: unknown;
  lua: unknown;
  mathematica: unknown;
  fSharp: unknown;
  nginx: unknown;
  octave: unknown;
  oz: unknown;
  pascal: unknown;
  perl: unknown;
  properties: unknown;
  protobuf: unknown;
  pug: unknown;
  puppet: unknown;
  r: unknown;
  sas: unknown;
  sass: unknown;
  scheme: unknown;
  smalltalk: unknown;
  solr: unknown;
  sparql: unknown;
  stex: unknown;
  stylus: unknown;
  tcl: unknown;
  textile: unknown;
  turtle: unknown;
  vb: unknown;
  verilog: unknown;
  vhdl: unknown;
  wast: unknown;
  webIDL: unknown;
  xQuery: unknown;
}

interface Window {
  marked?: PiclawMarked;
  DOMPurify?: PiclawDOMPurify;
  katex?: PiclawKaTeX;
  beautifulMermaid?: PiclawBeautifulMermaid;
  cmHighlight?: PiclawCmHighlight;
}
