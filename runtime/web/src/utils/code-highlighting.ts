import {
  classHighlighter,
  highlightTree,
  StreamLanguage,
  cssLanguage,
  cppLanguage,
  goLanguage,
  htmlLanguage,
  javascriptLanguage,
  jsxLanguage,
  tsxLanguage,
  typescriptLanguage,
  jsonLanguage,
  markdownLanguage,
  pythonLanguage,
  rustLanguage,
  StandardSQL,
  xmlLanguage,
  yamlLanguage,
  dockerFile,
  powerShell,
  ruby,
  shell,
  swift,
  toml,
} from '#editor-vendor/codemirror';

interface TokenSegment {
  from: number;
  to: number;
  cls: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const LANGUAGE_LABEL_ALIASES: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  py: 'Python',
  python: 'Python',
  sh: 'Shell',
  shell: 'Shell',
  bash: 'Bash',
  zsh: 'Zsh',
  ps1: 'PowerShell',
  powershell: 'PowerShell',
  md: 'Markdown',
  markdown: 'Markdown',
  yml: 'YAML',
  yaml: 'YAML',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  go: 'Go',
  c: 'C',
  cc: 'C++',
  cpp: 'C++',
  'c++': 'C++',
  cxx: 'C++',
  h: 'C/C++',
  hh: 'C++',
  hpp: 'C++',
  hxx: 'C++',
  rust: 'Rust',
  rs: 'Rust',
  ruby: 'Ruby',
  swift: 'Swift',
  toml: 'TOML',
  dockerfile: 'Dockerfile',
};

const LEGACY_SHELL_PARSER = StreamLanguage.define(shell).parser;
const LEGACY_POWERSHELL_PARSER = StreamLanguage.define(powerShell).parser;
const LEGACY_DOCKERFILE_PARSER = StreamLanguage.define(dockerFile).parser;
const LEGACY_RUBY_PARSER = StreamLanguage.define(ruby).parser;
const LEGACY_SWIFT_PARSER = StreamLanguage.define(swift).parser;
const LEGACY_TOML_PARSER = StreamLanguage.define(toml).parser;

export function normalizeCodeLanguageLabel(lang: string): string {
  const raw = String(lang || '').trim().toLowerCase();
  if (!raw) return 'text';
  return LANGUAGE_LABEL_ALIASES[raw] || String(lang || '').trim();
}

export function parserForCodeFenceLanguage(lang: string): { parse: (input: string) => any } | null {
  const raw = String(lang || '').trim().toLowerCase();
  switch (raw) {
    case 'js':
    case 'javascript':
      return javascriptLanguage.parser;
    case 'ts':
    case 'typescript':
      return typescriptLanguage.parser;
    case 'jsx':
      return jsxLanguage.parser;
    case 'tsx':
      return tsxLanguage.parser;
    case 'py':
    case 'python':
      return pythonLanguage.parser;
    case 'json':
      return jsonLanguage.parser;
    case 'css':
      return cssLanguage.parser;
    case 'html':
      return htmlLanguage.parser;
    case 'xml':
      return xmlLanguage.parser;
    case 'yaml':
    case 'yml':
      return yamlLanguage.parser;
    case 'md':
    case 'markdown':
      return markdownLanguage.parser;
    case 'sql':
      return StandardSQL.language.parser;
    case 'go':
      return goLanguage.parser;
    case 'c':
    case 'cc':
    case 'cpp':
    case 'cxx':
    case 'c++':
    case 'h':
    case 'hh':
    case 'hpp':
    case 'hxx':
      return cppLanguage.parser;
    case 'sh':
    case 'bash':
    case 'shell':
    case 'zsh':
      return LEGACY_SHELL_PARSER;
    case 'ps1':
    case 'powershell':
      return LEGACY_POWERSHELL_PARSER;
    case 'dockerfile':
      return LEGACY_DOCKERFILE_PARSER;
    case 'rb':
    case 'ruby':
      return LEGACY_RUBY_PARSER;
    case 'rs':
    case 'rust':
      return rustLanguage.parser;
    case 'swift':
      return LEGACY_SWIFT_PARSER;
    case 'toml':
      return LEGACY_TOML_PARSER;
    default:
      return null;
  }
}

export function highlightCodeToHtml(code: string, lang: string): string {
  const parser = parserForCodeFenceLanguage(lang);
  if (!parser) return escapeHtml(code);

  const tokens: TokenSegment[] = [];
  try {
    const tree = parser.parse(code);
    highlightTree(tree, classHighlighter, (from, to, cls) => {
      if (!cls || from >= to) return;
      tokens.push({ from, to, cls });
    });
  } catch {
    return escapeHtml(code);
  }

  if (!tokens.length) return escapeHtml(code);
  tokens.sort((a, b) => a.from - b.from || a.to - b.to);

  let cursor = 0;
  let html = '';
  for (const token of tokens) {
    if (token.from > cursor) html += escapeHtml(code.slice(cursor, token.from));
    html += `<span class="${escapeHtml(token.cls)}">${escapeHtml(code.slice(token.from, token.to))}</span>`;
    cursor = Math.max(cursor, token.to);
  }
  if (cursor < code.length) html += escapeHtml(code.slice(cursor));
  return html;
}

export function highlightCodeLinesAsHtml(code: string, lang: string): string[] {
  const lines = String(code || '').split('\n');
  if (!code) return lines;

  const parser = parserForCodeFenceLanguage(lang);
  if (!parser) return lines.map((line) => escapeHtml(line));

  const tokens: TokenSegment[] = [];
  try {
    const tree = parser.parse(code);
    highlightTree(tree, classHighlighter, (from, to, cls) => {
      if (!cls || from >= to) return;
      tokens.push({ from, to, cls });
    });
  } catch {
    return lines.map((line) => escapeHtml(line));
  }

  if (!tokens.length) return lines.map((line) => escapeHtml(line));
  tokens.sort((a, b) => a.from - b.from || a.to - b.to);

  const lineStarts: number[] = [];
  let pos = 0;
  for (const line of lines) {
    lineStarts.push(pos);
    pos += line.length + 1;
  }

  const result: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const start = lineStarts[i];
    const end = start + lines[i].length;
    let html = '';
    let cursor = start;

    for (const token of tokens) {
      if (token.to <= start) continue;
      if (token.from >= end) break;

      const tokenFrom = Math.max(start, token.from);
      const tokenTo = Math.min(end, token.to);
      if (tokenFrom > cursor) html += escapeHtml(code.slice(cursor, tokenFrom));
      if (tokenTo > tokenFrom) html += `<span class="${escapeHtml(token.cls)}">${escapeHtml(code.slice(tokenFrom, tokenTo))}</span>`;
      cursor = Math.max(cursor, tokenTo);
    }

    if (cursor < end) html += escapeHtml(code.slice(cursor, end));
    result.push(html || '&nbsp;');
  }

  return result;
}
