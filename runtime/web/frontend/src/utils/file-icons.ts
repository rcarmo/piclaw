/**
 * file-icons.ts — Seti icon font class resolver for file types.
 *
 * Maps file extensions and special filenames to CSS class names
 * using the VS Code Seti icon font (see seti-icons.css).
 *
 * Font and icon definitions from microsoft/vscode (MIT License):
 * https://github.com/microsoft/vscode/tree/main/extensions/theme-seti
 */

/** Map of file extension (lowercase, no dot) → seti icon name */
const EXT_MAP: Record<string, string> = {
  // TypeScript
  ts: "typescript",
  // TSX — React TypeScript
  tsx: "react",
  // JavaScript
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  // JSX — React JavaScript
  jsx: "react",
  // JSON
  json: "json",
  jsonc: "json",
  // Markdown
  md: "markdown",
  mdx: "markdown",
  // CSS
  css: "css",
  // SCSS / SASS
  scss: "sass",
  sass: "sass",
  // HTML
  html: "html",
  htm: "html",
  // Python
  py: "python",
  pyw: "python",
  // Rust
  rs: "rust",
  // Go
  go: "go",
  // Java
  java: "java",
  // YAML
  yaml: "yaml",
  yml: "yaml",
  // TOML / config
  toml: "toml",
  ini: "toml",
  conf: "toml",
  cfg: "toml",
  // Shell
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  // C
  c: "c",
  // C++
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  // C# 
  cs: "csharp",
  // Header
  h: "header",
  hpp: "header",
  hxx: "header",
  // Ruby
  rb: "ruby",
  // PHP
  php: "php",
  // Vue
  vue: "vue",
  // Svelte
  svelte: "svelte",
  // Bicep
  bicep: "bicep",
  // Terraform
  tf: "terraform",
  tfvars: "terraform",
  // SQL
  sql: "sql",
  // GraphQL
  graphql: "graphql",
  gql: "graphql",
  // SVG
  svg: "svg",
  // Images
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  ico: "image",
  // Archives
  zip: "zip",
  tar: "zip",
  gz: "zip",
  tgz: "zip",
  bz2: "zip",
  xz: "zip",
  "7z": "zip",
  rar: "zip",
  // Kotlin
  kt: "kotlin",
  kts: "kotlin",
  // Scala
  scala: "scala",
  // Dart
  dart: "dart",
  // Swift
  swift: "swift",
  // Lua
  lua: "lua",
  // R
  r: "r",
  // PowerShell
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  // Batch
  bat: "bat",
  cmd: "bat",
  // XML
  xml: "xml",
  xsl: "xml",
  xsd: "xml",
  // Git ignore type files
  gitignore: "git",
  gitattributes: "git",
  gitmodules: "git",
  // Lock files
  lock: "yarn",
};

/** Map of exact filename (lowercase) → seti icon name */
const FILENAME_MAP: Record<string, string> = {
  // Docker
  dockerfile: "docker",
  "dockerfile.dev": "docker",
  "dockerfile.prod": "docker",
  // Makefile
  makefile: "makefile",
  gnumakefile: "makefile",
  // Git
  ".gitignore": "git",
  ".gitattributes": "git",
  ".gitmodules": "git",
  // TypeScript config
  "tsconfig.json": "tsconfig",
  "tsconfig.build.json": "tsconfig",
  "tsconfig.base.json": "tsconfig",
  // Package
  "package.json": "json",
  "package-lock.json": "json",
  "bun.lockb": "yarn",
  "yarn.lock": "yarn",
  "pnpm-lock.yaml": "yaml",
  // Env
  ".env": "toml",
  ".env.local": "toml",
  ".env.development": "toml",
  ".env.production": "toml",
  ".env.test": "toml",
  // Readme / info
  readme: "info",
  "readme.md": "info",
  "readme.txt": "info",
  "readme.rst": "info",
  // License
  license: "license",
  "license.md": "license",
  "license.txt": "license",
  copying: "license",
  // Editor config
  ".editorconfig": "toml",
};

/**
 * Returns the full CSS class string for a given filename.
 * Example: getFileIconClass("main.ts") → "seti-icon seti-icon-typescript"
 */
export function getFileIconClass(filename: string): string {
  const lower = filename.toLowerCase();

  // Check exact filename match first
  const fnameIcon = FILENAME_MAP[lower];
  if (fnameIcon) {
    return `seti-icon seti-icon-${fnameIcon}`;
  }

  // Check extension
  const lastDot = lower.lastIndexOf(".");
  if (lastDot !== -1) {
    const ext = lower.slice(lastDot + 1);
    const extIcon = EXT_MAP[ext];
    if (extIcon) {
      return `seti-icon seti-icon-${extIcon}`;
    }
  }

  // Default file icon
  return "seti-icon seti-icon-default";
}
