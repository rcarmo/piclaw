import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

interface PrepareLocalInstallArchiveOptions {
  sourceArchive: string;
  stageDir: string;
  outputArchive: string;
  patchRoot: string;
  globalPackagePath: string;
  piAgentVersion: string;
}

async function run(command: string[]): Promise<void> {
  const process = Bun.spawn({
    cmd: command,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`${command[0]} exited with code ${exitCode}`);
  }
}

function resolvePackagePath(packageDir: string, packagePath: string): string {
  if (isAbsolute(packagePath)) {
    throw new Error(`patched dependency path must be relative: ${packagePath}`);
  }
  const resolvedPath = resolve(packageDir, packagePath);
  const relativePath = relative(packageDir, resolvedPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`patched dependency path escapes the package: ${packagePath}`);
  }
  return resolvedPath;
}

export async function prepareLocalInstallArchive({
  sourceArchive,
  stageDir,
  outputArchive,
  patchRoot,
  globalPackagePath,
  piAgentVersion,
}: PrepareLocalInstallArchiveOptions): Promise<void> {
  await Promise.all([
    rm(stageDir, { recursive: true, force: true }),
    rm(outputArchive, { force: true }),
    rm(patchRoot, { recursive: true, force: true }),
    rm(globalPackagePath, { force: true }),
  ]);
  await Promise.all([mkdir(stageDir, { recursive: true }), mkdir(patchRoot, { recursive: true })]);

  await run(["tar", "-xzf", sourceArchive, "-C", stageDir]);

  const packageDir = join(stageDir, "package");
  const packageJsonPath = join(packageDir, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as Record<string, unknown>;
  const rawPatchedDependencies = packageJson.patchedDependencies;
  if (
    rawPatchedDependencies !== undefined &&
    (typeof rawPatchedDependencies !== "object" || rawPatchedDependencies === null || Array.isArray(rawPatchedDependencies))
  ) {
    throw new Error("package patchedDependencies must be an object");
  }
  const patchedDependencies = (rawPatchedDependencies ?? {}) as Record<string, unknown>;

  for (const [dependency, packagePath] of Object.entries(patchedDependencies)) {
    if (typeof packagePath !== "string" || packagePath.length === 0) {
      throw new Error(`patched dependency path must be a non-empty string: ${dependency}`);
    }
    const sourcePath = resolvePackagePath(packageDir, packagePath);
    const destinationPath = resolvePackagePath(patchRoot, packagePath);
    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }

  delete packageJson.patchedDependencies;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  await mkdir(dirname(outputArchive), { recursive: true });
  await run(["tar", "-czf", outputArchive, "-C", stageDir, "package"]);

  const globalPackage = {
    dependencies: {
      // Piclaw owns the Bun-backed `pi` bin and pins its SDK dependency itself.
      // A second direct global coding-agent install can overwrite that bin.
      "@earendil-works/pi-agent-core": piAgentVersion,
      "@earendil-works/pi-ai": piAgentVersion,
      "@earendil-works/pi-tui": piAgentVersion,
      piclaw: outputArchive,
    },
    // Bun resolves overrides from the installation root, not the nested package.
    ...(packageJson.overrides ? { overrides: packageJson.overrides } : {}),
    ...(Object.keys(patchedDependencies).length > 0 ? { patchedDependencies } : {}),
  };
  await mkdir(dirname(globalPackagePath), { recursive: true });
  await writeFile(globalPackagePath, `${JSON.stringify(globalPackage)}\n`);
}

if (import.meta.main) {
  const [sourceArchive, stageDir, outputArchive, patchRoot, globalPackagePath, piAgentVersion] = Bun.argv.slice(2);
  if (!sourceArchive || !stageDir || !outputArchive || !patchRoot || !globalPackagePath || !piAgentVersion) {
    console.error(
      "Usage: bun scripts/prepare-local-install.ts <source.tgz> <stage-dir> <output.tgz> <patch-root> <global-package.json> <pi-agent-version>",
    );
    process.exit(2);
  }
  await prepareLocalInstallArchive({
    sourceArchive,
    stageDir,
    outputArchive,
    patchRoot,
    globalPackagePath,
    piAgentVersion,
  });
}
