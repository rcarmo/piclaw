#!/usr/bin/env bun
/**
 * Build a platform-native portable Piclaw artifact for the current runner.
 *
 * Outputs:
 * - Linux: self-extracting .run bundle
 * - macOS: .tar.gz bundle
 * - Windows: .zip bundle
 *
 * Every bundle contains the current Bun executable, packaged Piclaw app tree,
 * built web/runtime assets, skel files, and production node_modules installed
 * for the current OS/architecture.
 */

import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { resolvePiCli } from "../../runtime/scripts/pi-cli.ts";

interface Options {
  outputDir: string;
  keepWorkdir: boolean;
  bunTarget: string | null;
}

interface PlatformInfo {
  platform: "linux" | "macos" | "windows";
  arch: "x64" | "arm64" | "x64-baseline";
  bundleName: string;
  artifactPath: string;
  bunTarget: string | null;
}

const repoRoot = resolve(import.meta.dir, "..", "..");
const defaultOutputDir = join(repoRoot, "artifacts", "release");

export async function buildPortableArtifactFromCli(argv = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(argv);
  await buildPortableArtifact(options);
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    outputDir: defaultOutputDir,
    keepWorkdir: false,
    bunTarget: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output-dir" && typeof argv[index + 1] === "string") {
      options.outputDir = resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      options.outputDir = resolve(arg.slice("--output-dir=".length));
      continue;
    }
    if (arg === "--keep-workdir") {
      options.keepWorkdir = true;
      continue;
    }
    if (arg === "--bun-target" && typeof argv[index + 1] === "string") {
      options.bunTarget = normalizeBundledBunTarget(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--bun-target=")) {
      options.bunTarget = normalizeBundledBunTarget(arg.slice("--bun-target=".length));
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelpAndExit(): never {
  console.log(`Usage: bun run scripts/release/build-portable-artifact.ts [options]\n\nOptions:\n  --output-dir DIR       Directory for the generated artifact (default: artifacts/release)\n  --bun-target TARGET    Bundle a specific Bun release target instead of process.execPath\n                         Supported today: linux-x64-baseline (non-AVX x64 Linux)\n  --keep-workdir         Keep the temporary build directory for inspection\n  -h, --help             Show this help\n`);
  process.exit(0);
}

function normalizeBundledBunTarget(value: string): string {
  const target = value.trim();
  if (target !== "linux-x64-baseline") {
    throw new Error(`Unsupported --bun-target '${value}'. Supported target: linux-x64-baseline`);
  }
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(`--bun-target ${target} must be built on a linux-x64 runner`);
  }
  return target;
}

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): void {
  const pretty = [command, ...args].join(" ");
  console.error(`[portable] ${pretty}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed (${result.status ?? "signal"}): ${pretty}`);
}

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version?: string };
  if (!pkg.version) throw new Error("package.json has no version");
  return pkg.version;
}

function currentPlatformInfo(outputDir: string, version: string, bunTarget: string | null): PlatformInfo {
  const platform = normalizePlatform();
  const arch = bunTarget === "linux-x64-baseline" ? "x64-baseline" : normalizeArch();
  const bundleName = `piclaw-${version}-${platform}-${arch}`;
  const extension = platform === "linux" ? ".run" : platform === "windows" ? ".zip" : ".tar.gz";
  return {
    platform,
    arch,
    bundleName,
    artifactPath: join(outputDir, `${bundleName}${extension}`),
    bunTarget,
  };
}

function normalizePlatform(): PlatformInfo["platform"] {
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "macos";
  if (process.platform === "win32") return "windows";
  throw new Error(`Unsupported platform for portable artifacts: ${process.platform}`);
}

function normalizeArch(): Extract<PlatformInfo["arch"], "x64" | "arm64"> {
  if (process.arch === "x64") return "x64";
  if (process.arch === "arm64") return "arm64";
  throw new Error(`Unsupported architecture for portable artifacts: ${process.arch}`);
}

function findPackedTarball(packDir: string): string {
  const glob = new Bun.Glob("piclaw-*.tgz");
  const matches = Array.from(glob.scanSync({ cwd: packDir, absolute: true })).sort();
  const latest = matches.at(-1);
  if (!latest) throw new Error(`No piclaw-*.tgz found in ${packDir}`);
  return latest;
}

function buildUnixPiclawLauncherScript(): string {
  return `#!/usr/bin/env sh\nset -eu\nSELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nROOT=$(CDPATH= cd -- "$SELF_DIR/.." && pwd)\nexport BUN_INSTALL="$ROOT/bun"\nexport PATH="$ROOT/bun/bin:$ROOT/bin:$ROOT/app/node_modules/.bin:$PATH"\nexec "$ROOT/bun/bin/bun" "$ROOT/app/runtime/src/index.ts" "$@"\n`;
}

function buildUnixPiLauncherScript(): string {
  return `#!/usr/bin/env sh\nset -eu\nSELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nROOT=$(CDPATH= cd -- "$SELF_DIR/.." && pwd)\nexport BUN_INSTALL="$ROOT/bun"\nexport PATH="$ROOT/bun/bin:$ROOT/bin:$ROOT/app/node_modules/.bin:$PATH"\nexec "$ROOT/bun/bin/bun" "$ROOT/app/runtime/scripts/pi-cli.ts" "$@"\n`;
}

function buildWindowsPiclawCmdLauncher(): string {
  return `@echo off\r\nsetlocal\r\nset "SELF_DIR=%~dp0"\r\nfor %%I in ("%SELF_DIR%..") do set "ROOT=%%~fI"\r\nset "BUN_INSTALL=%ROOT%\\bun"\r\nset "PATH=%ROOT%\\bun;%ROOT%\\bin;%ROOT%\\app\\node_modules\\.bin;%PATH%"\r\n"%ROOT%\\bun\\bun.exe" "%ROOT%\\app\\runtime\\src\\index.ts" %*\r\n`;
}

function buildWindowsPiCmdLauncher(): string {
  return `@echo off\r\nsetlocal\r\nset "SELF_DIR=%~dp0"\r\nfor %%I in ("%SELF_DIR%..") do set "ROOT=%%~fI"\r\nset "BUN_INSTALL=%ROOT%\\bun"\r\nset "PATH=%ROOT%\\bun;%ROOT%\\bin;%ROOT%\\app\\node_modules\\.bin;%PATH%"\r\n"%ROOT%\\bun\\bun.exe" "%ROOT%\\app\\runtime\\scripts\\pi-cli.ts" %*\r\n`;
}

function buildWindowsPiclawPowerShellLauncher(): string {
  return `$ErrorActionPreference = 'Stop'\r\n$Root = Resolve-Path (Join-Path $PSScriptRoot '..')\r\n$env:BUN_INSTALL = Join-Path $Root 'bun'\r\n$env:PATH = (Join-Path $Root 'bun') + [IO.Path]::PathSeparator + (Join-Path $Root 'bin') + [IO.Path]::PathSeparator + (Join-Path $Root 'app/node_modules/.bin') + [IO.Path]::PathSeparator + $env:PATH\r\n& (Join-Path $Root 'bun/bun.exe') (Join-Path $Root 'app/runtime/src/index.ts') @args\r\nexit $LASTEXITCODE\r\n`;
}

function buildWindowsPiPowerShellLauncher(): string {
  return `$ErrorActionPreference = 'Stop'\r\n$Root = Resolve-Path (Join-Path $PSScriptRoot '..')\r\n$env:BUN_INSTALL = Join-Path $Root 'bun'\r\n$env:PATH = (Join-Path $Root 'bun') + [IO.Path]::PathSeparator + (Join-Path $Root 'bin') + [IO.Path]::PathSeparator + (Join-Path $Root 'app/node_modules/.bin') + [IO.Path]::PathSeparator + $env:PATH\r\n& (Join-Path $Root 'bun/bun.exe') (Join-Path $Root 'app/runtime/scripts/pi-cli.ts') @args\r\nexit $LASTEXITCODE\r\n`;
}

function buildUnixInstallScript(bundleName: string): string {
  return `#!/usr/bin/env sh\nset -eu\nPREFIX=\${1:-/opt/piclaw}\nBIN_DIR=\${PICLAW_BIN_DIR:-/usr/local/bin}\nSELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nmkdir -p "$PREFIX/releases"\nrm -rf "$PREFIX/releases/${bundleName}"\ncp -a "$SELF_DIR" "$PREFIX/releases/${bundleName}"\nln -sfn "releases/${bundleName}" "$PREFIX/current"\nif [ "\${PICLAW_SKIP_BIN_LINK:-0}" != "1" ]; then\n  mkdir -p "$BIN_DIR"\n  cat > "$BIN_DIR/piclaw" <<EOF\n#!/usr/bin/env sh\nexec "$PREFIX/current/bin/piclaw" "\\$@"\nEOF\n  cat > "$BIN_DIR/pi" <<EOF\n#!/usr/bin/env sh\nexec "$PREFIX/current/bin/pi" "\\$@"\nEOF\n  chmod 755 "$BIN_DIR/piclaw" "$BIN_DIR/pi"\nfi\necho "Installed Piclaw to $PREFIX/current"\n`;
}

export function buildWindowsInstallScript(bundleName: string): string {
  return [
    "param(",
    "  [string]$Prefix = (Join-Path $env:LOCALAPPDATA 'Piclaw'),",
    "  [string]$BinDir = (Join-Path $env:LOCALAPPDATA 'Microsoft\\WindowsApps'),",
    "  [switch]$SkipBinLink",
    ")",
    "$ErrorActionPreference = 'Stop'",
    "$SelfDir = Split-Path -Parent $MyInvocation.MyCommand.Path",
    "$Releases = Join-Path $Prefix 'releases'",
    `$Dest = Join-Path $Releases '${bundleName}'`,
    "New-Item -ItemType Directory -Force -Path $Releases | Out-Null",
    "if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }",
    "Copy-Item -Recurse -Force $SelfDir $Dest",
    "$Current = Join-Path $Prefix 'current'",
    "if (Test-Path $Current) { Remove-Item -Recurse -Force $Current }",
    "New-Item -ItemType Junction -Path $Current -Target $Dest | Out-Null",
    "if (-not $SkipBinLink) {",
    "  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null",
    "  $PiclawLauncher = Join-Path $Current 'bin\\piclaw.cmd'",
    "  $PiLauncher = Join-Path $Current 'bin\\pi.cmd'",
    "  $PiclawShim = \"@echo off`r`n`\"$PiclawLauncher`\" %*`r`n\"",
    "  $PiShim = \"@echo off`r`n`\"$PiLauncher`\" %*`r`n\"",
    "  $PiclawShim | Set-Content -Encoding ASCII (Join-Path $BinDir 'piclaw.cmd')",
    "  $PiShim | Set-Content -Encoding ASCII (Join-Path $BinDir 'pi.cmd')",
    "}",
    "Write-Host \"Installed Piclaw to $Current\"",
    "",
  ].join("\r\n");
}

function buildLinuxRunReadme(bundleName: string, version: string, arch: string): string {
  const artifactName = `${bundleName}.run`;
  return `# Piclaw ${version} Linux .run bundle (${arch})\n\nThis directory was extracted from \`${artifactName}\`, a self-extracting Piclaw Linux bundle. It contains the bundled Bun runtime, Piclaw application files, production dependencies, the Pi CLI, and launch/install scripts.\n\n## Running without installing\n\n\`\`\`sh\n./bin/piclaw --version\n./bin/pi --version\n./bin/piclaw --help\n./bin/pi --help\n./bin/piclaw\n\`\`\`\n\nThe launchers set \`BUN_INSTALL\` and \`PATH\` to use the bundled runtime under \`./bun\` and bundled dependency CLIs under \`./app/node_modules/.bin\`.\n\n## Installing or upgrading from the .run file\n\nFrom the directory that contains the downloaded \`.run\` file:\n\n\`\`\`sh\nchmod +x ${artifactName}\nsudo ./${artifactName} --install /opt/piclaw\n\`\`\`\n\nBy default this installs the release under \`/opt/piclaw/releases/${bundleName}\`, updates \`/opt/piclaw/current\`, and writes \`/usr/local/bin/piclaw\` and \`/usr/local/bin/pi\`.\n\n## Extracting without installing\n\n\`\`\`sh\n./${artifactName} --extract /tmp/piclaw-run-test\n/tmp/piclaw-run-test/${bundleName}/bin/piclaw --version\n/tmp/piclaw-run-test/${bundleName}/bin/pi --version\n\`\`\`\n\n## Installer options\n\n\`\`\`text\n${artifactName} --install [PREFIX]       Install to PREFIX (default: /opt/piclaw)\n${artifactName} --extract DIR            Extract payload under DIR without installing\n${artifactName} --version                Print bundled Piclaw version\n${artifactName} --help                   Show installer help\n\`\`\`\n\nEnvironment variables for \`--install\`:\n\n- \`PICLAW_BIN_DIR=DIR\` — write launchers to \`DIR/piclaw\` and \`DIR/pi\` instead of \`/usr/local/bin\`.\n- \`PICLAW_SKIP_BIN_LINK=1\` — install files but do not write launchers.\n\n## Bundle layout\n\n- \`bin/piclaw\` — launcher script for the bundled Piclaw app.\n- \`bin/pi\` — launcher script for the bundled Pi CLI from \`@earendil-works/pi-coding-agent\`.\n- \`bun/bin/bun\` — bundled Bun runtime.\n- \`app/\` — packaged Piclaw application tree.\n- \`install.sh\` — install script used by the \`.run\` wrapper.\n- \`MANIFEST.json\` — build metadata.\n- \`VERSION\` — bundled Piclaw version.\n\n## Notes\n\nThe \`linux-x64-baseline\` build uses Bun's non-AVX baseline runtime for older x64 CPUs. If your host is modern, the regular \`linux-x64\` artifact is fine; if it grumbles about CPU instructions, use the baseline one and pretend this was wisdom rather than hardware archaeology.\n`;
}

function buildSelfExtractingStub(bundleName: string, version: string, arch: string): string {
  return `#!/usr/bin/env sh
set -eu

BUNDLE_NAME='${bundleName}'
PICLAW_VERSION='${version}'
PICLAW_PLATFORM='linux-${arch}'
DEFAULT_PREFIX='/opt/piclaw'
DEFAULT_BIN_DIR='/usr/local/bin'

usage() {
  cat <<EOF
Piclaw $PICLAW_VERSION self-extracting Linux bundle ($PICLAW_PLATFORM)

Usage:
  $0 --install [PREFIX]       Install to PREFIX (default: $DEFAULT_PREFIX)
  $0 --extract DIR            Extract payload under DIR without installing
  $0 --version                Print bundled Piclaw version
  $0 --help                   Show this help

Install environment variables:
  PICLAW_BIN_DIR=DIR          Launcher directory for --install (default: $DEFAULT_BIN_DIR)
  PICLAW_SKIP_BIN_LINK=1      Do not write DIR/piclaw or DIR/pi launchers
EOF
}

payload_line() {
  awk '/^__PICLAW_PAYLOAD_BELOW__$/ { print NR + 1; exit 0; }' "$0"
}

extract_payload() {
  dest=$1
  mkdir -p "$dest"
  line=$(payload_line)
  if [ -z "$line" ]; then
    echo "Could not locate embedded payload marker" >&2
    exit 1
  fi
  tail -n +"$line" "$0" | tar -xzf - -C "$dest"
}

install_bundle() {
  prefix=$1
  bin_dir=\${PICLAW_BIN_DIR:-$DEFAULT_BIN_DIR}
  tmpdir=$(mktemp -d "\${TMPDIR:-/tmp}/piclaw-run.XXXXXX")
  cleanup() { rm -rf "$tmpdir"; }
  trap cleanup EXIT INT TERM

  extract_payload "$tmpdir"
  src="$tmpdir/$BUNDLE_NAME"
  if [ ! -x "$src/bin/piclaw" ]; then
    echo "Extracted payload is missing bin/piclaw" >&2
    exit 1
  fi
  if [ ! -x "$src/bin/pi" ]; then
    echo "Extracted payload is missing bin/pi" >&2
    exit 1
  fi

  mkdir -p "$prefix/releases"
  rm -rf "$prefix/releases/$BUNDLE_NAME"
  mv "$src" "$prefix/releases/$BUNDLE_NAME"
  ln -sfn "releases/$BUNDLE_NAME" "$prefix/current"

  if [ "\${PICLAW_SKIP_BIN_LINK:-0}" != "1" ]; then
    mkdir -p "$bin_dir"
    cat > "$bin_dir/piclaw" <<LAUNCHER
#!/usr/bin/env sh
exec "$prefix/current/bin/piclaw" "\\$@"
LAUNCHER
    cat > "$bin_dir/pi" <<LAUNCHER
#!/usr/bin/env sh
exec "$prefix/current/bin/pi" "\\$@"
LAUNCHER
    chmod 755 "$bin_dir/piclaw" "$bin_dir/pi"
  fi

  echo "Installed Piclaw $PICLAW_VERSION to $prefix/current"
  echo "Usage notes: $prefix/current/README.md"
  if [ "\${PICLAW_SKIP_BIN_LINK:-0}" != "1" ]; then
    echo "Launchers: $bin_dir/piclaw, $bin_dir/pi"
  fi
}

command=\${1:---help}
case "$command" in
  --help|-h)
    usage
    exit 0
    ;;
  --version)
    echo "$PICLAW_VERSION"
    exit 0
    ;;
  --extract)
    if [ $# -lt 2 ]; then
      echo "--extract requires a destination directory" >&2
      exit 1
    fi
    extract_payload "$2"
    echo "Extracted $BUNDLE_NAME to $2/$BUNDLE_NAME"
    echo "Usage notes: $2/$BUNDLE_NAME/README.md"
    exit 0
    ;;
  --install)
    prefix=\${2:-$DEFAULT_PREFIX}
    install_bundle "$prefix"
    exit 0
    ;;
  *)
    echo "Unknown command: $command" >&2
    usage >&2
    exit 1
    ;;
esac

__PICLAW_PAYLOAD_BELOW__
`;
}

async function writeStubAndPayload(targetPath: string, stub: string, payloadPath: string): Promise<void> {
  const stream = createWriteStream(targetPath, { mode: 0o755 });
  stream.write(stub);
  await pipeline(createReadStream(payloadPath), stream, { end: true });
}

function readPinnedBunVersion(): string {
  const raw = readFileSync(join(repoRoot, "BUN_VERSION"), "utf8").trim();
  const version = raw.replace(/^bun-v/, "").replace(/^v/, "");
  if (!version) throw new Error("BUN_VERSION file is empty");
  return version;
}

function sha256File(path: string): string {
  const result = spawnSync("sha256sum", [path], { encoding: "utf8", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`sha256sum failed for ${path}: ${result.stderr}`);
  return result.stdout.trim().split(/\s+/)[0] || "";
}

function downloadBunReleaseBinary(bunTarget: string, workdir: string): string {
  const bunVersion = readPinnedBunVersion();
  const downloadDir = join(workdir, "bun-release-download");
  const extractDir = join(downloadDir, "extract");
  mkdirSync(extractDir, { recursive: true });

  const filename = `bun-${bunTarget}.zip`;
  const baseUrl = `https://github.com/oven-sh/bun/releases/download/bun-v${bunVersion}`;
  const archivePath = join(downloadDir, filename);
  const checksumsPath = join(downloadDir, "SHASUMS256.txt");

  run("curl", ["-fsSL", "--fail", `${baseUrl}/${filename}`, "-o", archivePath]);
  run("curl", ["-fsSL", "--fail", `${baseUrl}/SHASUMS256.txt`, "-o", checksumsPath]);

  const checksumLine = readFileSync(checksumsPath, "utf8")
    .split(/\r?\n/)
    .find((line) => line.trim().split(/\s+/)[1] === filename);
  const expectedChecksum = checksumLine?.trim().split(/\s+/)[0] || "";
  if (!expectedChecksum) throw new Error(`Missing checksum entry for ${filename}`);

  const actualChecksum = sha256File(archivePath);
  if (actualChecksum !== expectedChecksum) {
    throw new Error(`Checksum mismatch for ${filename}\nExpected: ${expectedChecksum}\nActual:   ${actualChecksum}`);
  }

  run("unzip", ["-q", archivePath, "-d", extractDir]);
  const executable = process.platform === "win32" ? "bun.exe" : "bun";
  const candidates = [
    join(extractDir, `bun-${bunTarget}`, executable),
    join(extractDir, bunTarget, executable),
  ];
  const binary = candidates.find((candidate) => existsSync(candidate));
  if (!binary) throw new Error(`Unexpected Bun archive layout for ${bunTarget}`);
  return binary;
}

export function assertBundledPiCli(appDir: string): string {
  if (!existsSync(join(appDir, "runtime", "scripts", "pi-cli.ts"))) {
    throw new Error("Portable bundle is missing the Bun Pi launcher");
  }
  const piCli = resolvePiCli(appDir);
  if (!existsSync(piCli)) throw new Error(`Portable bundle is missing the declared Pi CLI entrypoint: ${piCli}`);
  return piCli;
}

function copyBundledBun(bundleDir: string, info: PlatformInfo, workdir: string): void {
  const bunSource = info.bunTarget ? downloadBunReleaseBinary(info.bunTarget, workdir) : process.execPath;
  if (info.platform === "windows") {
    const bunTargetDir = join(bundleDir, "bun");
    mkdirSync(bunTargetDir, { recursive: true });
    copyFileSync(bunSource, join(bunTargetDir, "bun.exe"));
    return;
  }

  const bunTargetDir = join(bundleDir, "bun", "bin");
  mkdirSync(bunTargetDir, { recursive: true });
  copyFileSync(bunSource, join(bunTargetDir, "bun"));
  chmodSync(join(bunTargetDir, "bun"), 0o755);
}

export function writeLaunchers(bundleDir: string, platform: PlatformInfo["platform"], bundleName: string): void {
  mkdirSync(join(bundleDir, "bin"), { recursive: true });
  if (platform === "windows") {
    writeFileSync(join(bundleDir, "bin", "piclaw.cmd"), buildWindowsPiclawCmdLauncher());
    writeFileSync(join(bundleDir, "bin", "piclaw.ps1"), buildWindowsPiclawPowerShellLauncher());
    writeFileSync(join(bundleDir, "bin", "pi.cmd"), buildWindowsPiCmdLauncher());
    writeFileSync(join(bundleDir, "bin", "pi.ps1"), buildWindowsPiPowerShellLauncher());
    writeFileSync(join(bundleDir, "install.ps1"), buildWindowsInstallScript(bundleName));
    return;
  }

  writeFileSync(join(bundleDir, "bin", "piclaw"), buildUnixPiclawLauncherScript(), { mode: 0o755 });
  writeFileSync(join(bundleDir, "bin", "pi"), buildUnixPiLauncherScript(), { mode: 0o755 });
  chmodSync(join(bundleDir, "bin", "piclaw"), 0o755);
  chmodSync(join(bundleDir, "bin", "pi"), 0o755);
  writeFileSync(join(bundleDir, "install.sh"), buildUnixInstallScript(bundleName), { mode: 0o755 });
  chmodSync(join(bundleDir, "install.sh"), 0o755);
}

function packagePortableArtifact(workdir: string, info: PlatformInfo): void {
  if (info.platform === "linux") {
    const payloadPath = join(workdir, `${info.bundleName}.tar.gz`);
    run("tar", ["-czf", payloadPath, "-C", workdir, info.bundleName]);
    return;
  }

  if (info.platform === "macos") {
    run("tar", ["-czf", info.artifactPath, "-C", workdir, info.bundleName]);
    return;
  }

  run("tar", ["-acf", info.artifactPath, "-C", workdir, info.bundleName]);
}

async function buildPortableArtifact(options: Options): Promise<void> {
  const version = readPackageVersion();
  const info = currentPlatformInfo(options.outputDir, version, options.bunTarget);
  const workdir = mkdtempSync(join(tmpdir(), "piclaw-portable-"));
  const packDir = join(workdir, "pack");
  const extractDir = join(workdir, "extract");
  const bundleDir = join(workdir, info.bundleName);

  try {
    mkdirSync(packDir, { recursive: true });
    mkdirSync(extractDir, { recursive: true });
    mkdirSync(bundleDir, { recursive: true });
    mkdirSync(options.outputDir, { recursive: true });

    run("bun", ["pm", "pack", "--destination", packDir]);
    const tarball = findPackedTarball(packDir);
    run("tar", ["-xzf", tarball, "-C", extractDir]);

    const appDir = join(extractDir, "package");
    if (!existsSync(join(appDir, "package.json"))) throw new Error("Pack extraction did not produce package/package.json");
    copyFileSync(join(repoRoot, "bun.lock"), join(appDir, "bun.lock"));
    const installCacheDir = join(workdir, "bun-cache");
    const installTmpDir = join(workdir, "tmp");
    const bunTmpDir = join(workdir, "bun-tmp");
    mkdirSync(installCacheDir, { recursive: true });
    mkdirSync(installTmpDir, { recursive: true });
    mkdirSync(bunTmpDir, { recursive: true });
    const installEnv = {
      ...process.env,
      BUN_INSTALL_CACHE_DIR: installCacheDir,
      BUN_TMPDIR: bunTmpDir,
      TMPDIR: installTmpDir,
      TMP: installTmpDir,
      TEMP: installTmpDir,
    };
    run("bun", ["install", "--production", "--frozen-lockfile", "--ignore-scripts"], {
      cwd: appDir,
      env: installEnv,
    });
    run("bun", ["run", "scripts/postinstall.ts"], { cwd: appDir, env: installEnv });

    const piCli = assertBundledPiCli(appDir);
    copyBundledBun(bundleDir, info, workdir);
    renameSync(appDir, join(bundleDir, "app"));
    writeLaunchers(bundleDir, info.platform, info.bundleName);

    writeFileSync(join(bundleDir, "VERSION"), `${version}\n`);
    if (info.platform === "linux") {
      writeFileSync(join(bundleDir, "README.md"), buildLinuxRunReadme(info.bundleName, version, info.arch));
    }
    writeFileSync(join(bundleDir, "MANIFEST.json"), JSON.stringify({
      name: "piclaw-portable",
      version,
      platform: info.platform,
      arch: info.arch,
      bun: info.bunTarget ?? basename(process.execPath),
      bunTarget: info.bunTarget,
      launchers: info.platform === "windows" ? ["bin/piclaw.cmd", "bin/piclaw.ps1", "bin/pi.cmd", "bin/pi.ps1"] : ["bin/piclaw", "bin/pi"],
      piCli: `app/${relative(appDir, piCli).replaceAll("\\", "/")}`,
      builtAt: new Date().toISOString(),
    }, null, 2) + "\n");

    if (info.platform === "linux") {
      const payloadPath = join(workdir, `${info.bundleName}.tar.gz`);
      run("tar", ["-czf", payloadPath, "-C", workdir, info.bundleName]);
      await writeStubAndPayload(info.artifactPath, buildSelfExtractingStub(info.bundleName, version, info.arch), payloadPath);
      chmodSync(info.artifactPath, 0o755);
    } else {
      packagePortableArtifact(workdir, info);
    }

    const stat = statSync(info.artifactPath);
    console.log(JSON.stringify({ artifact: info.artifactPath, version, platform: `${info.platform}-${info.arch}`, bytes: stat.size }, null, 2));
  } finally {
    if (options.keepWorkdir) {
      console.error(`[portable] kept workdir: ${workdir}`);
    } else {
      rmSync(workdir, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  buildPortableArtifactFromCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
