import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { posix, relative, resolve } from "node:path";
import * as ts from "@babel/types";

import {
  forEachSyntaxChild,
  literalString,
  parseTypeScriptSource,
  propertyKeyName,
  syntaxText,
  type ParsedTypeScriptSource,
} from "./typescript-syntax-oracle.js";

const runtimeRoot = resolve(import.meta.dir, "../../..");
const BUILTIN_ROOT = "src/extensions/index.ts";
const RETIRED_COMPOSITION = "historical/retired-session-composition.ts";
const SERVICE_FACTORY_ROOT = "src/agent-pool/service-factory.ts";
const SDK_TOOLS_SOURCE = resolve(runtimeRoot, "../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/index.js");

export interface SourceTree {
  readonly files: Readonly<Record<string, string>>;
}

export interface LatentCompositionConfig {
  readonly platform?: "linux" | "win32";
  readonly enabledEnv?: ReadonlySet<string>;
  readonly sdkToolFamilies?: readonly string[];
}

export interface StaticToolContract {
  readonly name: string;
  readonly description: string;
  readonly promptSnippet: string;
  readonly parameterSchemaFingerprint: string;
}

export interface RepositoryToolFamilyInventory {
  readonly names: readonly string[];
  readonly unresolvedRegistrations: readonly string[];
  readonly sdkToolFamilies: readonly string[];
  readonly compositionRoots: readonly string[];
  readonly reachableRoots: readonly string[];
  readonly registrationSites: Readonly<Record<string, readonly string[]>>;
  readonly nonProductionDuplicateSites: Readonly<Record<string, readonly string[]>>;
}

/**
 * Read repository source as data. No extension, add-on, MCP adapter, or tool is
 * imported or executed.
 */
export function readRepositorySourceTree(root = runtimeRoot): SourceTree {
  const files: Record<string, string> = {};
  for (const [name, path] of [["tsconfig.json", resolve(root, "tsconfig.json")], ["package.json", resolve(root, "../package.json")]] as const) {
    try { files[name] = readFileSync(path, "utf8"); } catch (error) { void error; /* A synthetic source tree may omit repository config. */ }
  }
  for (const directory of [resolve(root, "src"), resolve(root, "extensions")]) {
    for (const path of walkTypeScript(directory)) {
      files[relative(root, path).replaceAll("\\", "/")] = readFileSync(path, "utf8");
    }
  }
  return Object.freeze({ files: Object.freeze(files) });
}

/** Preserve latent registry coverage using the original composition declarations.
 * Current native tools are qualified separately under qualification/native.
 */
export function readLatentPreparationSourceTree(): SourceTree {
  const tree = readRepositorySourceTree();
  const excerpts = JSON.parse(readFileSync(resolve(runtimeRoot, "test/fixtures/retired-session-composition.json"), "utf8"));
  return Object.freeze({ files: Object.freeze({ ...tree.files,
    [RETIRED_COMPOSITION]: excerpts.optionalExtensions + "\n" + excerpts.mcpComposition,
  }) });
}

export function inventoryLatentToolFamilies(
  tree: SourceTree = readLatentPreparationSourceTree(),
  config: LatentCompositionConfig = {},
): RepositoryToolFamilyInventory {
  const files = tree.files;
  const sdkToolFamilies = Object.freeze([...(config.sdkToolFamilies ?? extractSdkToolFamilies(readFileSync(SDK_TOOLS_SOURCE, "utf8")))].sort());
  const names = new Set<string>(sdkToolFamilies);
  const sites = new Map<string, Set<string>>();
  const unresolved = new Set<string>();
  const roots = new Set<string>();

  for (const root of parseBuiltinFactoryRoots(files[BUILTIN_ROOT] ?? "", BUILTIN_ROOT, files)) roots.add(root);
  for (const root of parseOptionalExtensionRoots(files[RETIRED_COMPOSITION] ?? "", config)) roots.add(root);
  if (files[SERVICE_FACTORY_ROOT]) roots.add(SERVICE_FACTORY_ROOT);
  if (containsCall(files[RETIRED_COMPOSITION] ?? "", "createMcpAdapter")) names.add("mcp");

  const compositionRoots = Object.freeze([...roots].sort());
  const queue = [...roots].sort();
  const scanned = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (scanned.has(file)) continue;
    scanned.add(file);
    const source = files[file];
    if (source === undefined) {
      unresolved.add(`${file}#missing-production-root`);
      continue;
    }
    for (const registration of parseRegistrations(file, source, files)) {
      if (registration.name) {
        names.add(registration.name);
        addSite(sites, registration.name, file);
      } else {
        unresolved.add(`${file}#${registration.fingerprint}`);
      }
    }
    const referenced = new Set(resolveCalledImportedRoots(file, source, files));
    const forwarded = resolveForwardedDefaultRoot(file, source, files);
    if (forwarded) referenced.add(forwarded);
    for (const dependency of referenced) {
      if (scanned.has(dependency)) continue;
      roots.add(dependency);
      queue.push(dependency);
    }
    queue.sort();
  }

  // Module-graph-only edges prove latent reachability without pretending that an imported
  // factory's registerTool body was invoked by current composition.
  const graphQueue = [...roots].sort();
  const graphScanned = new Set<string>();
  while (graphQueue.length > 0) {
    const file = graphQueue.shift()!;
    if (graphScanned.has(file)) continue;
    graphScanned.add(file);
    const source = files[file];
    if (source === undefined) continue;
    for (const dependency of resolveModuleGraphEdges(file, source, files)) {
      if (!roots.has(dependency)) roots.add(dependency);
      if (!graphScanned.has(dependency)) graphQueue.push(dependency);
    }
    graphQueue.sort();
  }

  const duplicateSites = new Map<string, Set<string>>();
  for (const [file, source] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    if (scanned.has(file)) continue;
    for (const registration of parseRegistrations(file, source, files)) {
      if (registration.name && names.has(registration.name)) addSite(duplicateSites, registration.name, file);
    }
  }

  return Object.freeze({
    names: Object.freeze([...names].sort()),
    unresolvedRegistrations: Object.freeze([...unresolved].sort()),
    sdkToolFamilies,
    compositionRoots,
    reachableRoots: Object.freeze([...roots].sort()),
    registrationSites: readonlySiteRecord(sites),
    nonProductionDuplicateSites: readonlySiteRecord(duplicateSites),
  });
}

export function snapshotLatentToolContracts(
  tree: SourceTree = readLatentPreparationSourceTree(),
  config: LatentCompositionConfig = {},
): Readonly<Record<string, StaticToolContract>> {
  const inventory = inventoryLatentToolFamilies(tree, config);
  const contracts: Record<string, StaticToolContract> = Object.create(null);
  for (const [name, sites] of Object.entries(inventory.registrationSites)) {
    const file = sites[0];
    const source = file && tree.files[file];
    if (!file || source === undefined) continue;
    const contract = staticRegistrationContract(name, file, source, tree.files);
    if (contract) contracts[name] = contract;
  }
  for (const name of inventory.sdkToolFamilies) {
    const path = resolve(runtimeRoot, `../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/${name}.js`);
    contracts[name] = staticSdkContract(name, readFileSync(path, "utf8"));
  }
  if (inventory.names.includes("mcp")) {
    contracts.mcp = freezeContract("mcp", "programmatic pi-mcp-adapter factory", "", "external:pi-mcp-adapter");
  }
  return Object.freeze(Object.fromEntries(Object.entries(contracts).sort(([left], [right]) => left.localeCompare(right))));
}

export function resolveRepositoryModule(fromFile: string, specifier: string, files: Readonly<Record<string, string>>): string | null {
  return resolveSourceFile(fromFile, specifier, files);
}

export function extractSdkToolFamilies(source: string): readonly string[] {
  const ast = sourceFile("@earendil-works/pi-coding-agent/core/tools/index.js", source);
  let names: string[] | null = null;
  const visit = (node: ts.Node): void => {
    if (!names && ts.isVariableDeclarator(node) && ts.isIdentifier(node.id) && node.id.name === "allToolNames"
      && node.init && ts.isNewExpression(node.init) && calleeName(node.init.callee) === "Set") {
      const values = expressionArgument(node.init.arguments[0]);
      if (values && ts.isArrayExpression(values)) {
        const entries = values.elements.map((entry) => entry && literalString(entry)).filter((entry): entry is string => entry !== null);
        if (entries.length === values.elements.length) names = entries;
      }
    }
    if (!names) forEachSyntaxChild(node, visit);
  };
  visit(ast.program);
  if (!names) throw new Error("SDK allToolNames literal was not found");
  return Object.freeze(names.sort());
}

function staticRegistrationContract(name: string, file: string, source: string, files: Readonly<Record<string, string>>): StaticToolContract | null {
  const ast = sourceFile(file, source);
  const constants = stringConstants(ast);
  const variables = variableInitializers(ast);
  let contract: StaticToolContract | null = null;
  const visit = (node: ts.Node): void => {
    const argument = ts.isCallExpression(node) ? expressionArgument(node.arguments[0]) : null;
    if (contract || !ts.isCallExpression(node) || !isRegisterToolCall(node.callee) || !argument) {
      if (!contract) forEachSyntaxChild(node, visit);
      return;
    }
    const resolved = resolveRegistration(argument, constants, variables, ast, file, files);
    if (resolved.name !== name) return;
    const object = ts.isObjectExpression(argument) ? argument : null;
    const description = object && objectProperty(object, "description");
    const prompt = object && objectProperty(object, "promptSnippet");
    const parameters = object && objectProperty(object, "parameters");
    contract = freezeContract(
      name,
      description ? normalizeContractText(syntaxText(ast, description.value)) : `factory:${normalizeContractText(syntaxText(ast, argument))}`,
      prompt ? normalizeContractText(syntaxText(ast, prompt.value)) : "",
      parameters ? fingerprint(syntaxText(ast, parameters.value)) : fingerprint(`factory:${syntaxText(ast, argument)}`),
    );
  };
  visit(ast.program);
  return contract;
}

function staticSdkContract(name: string, source: string): StaticToolContract {
  const ast = sourceFile(`${name}.js`, source);
  const definition = `create${name[0]!.toUpperCase()}${name.slice(1)}ToolDefinition`;
  let object: ts.ObjectExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (!object && ts.isFunctionDeclaration(node) && node.id?.name === definition && node.body) {
      forEachSyntaxChild(node.body, (child) => {
        if (!object && ts.isReturnStatement(child) && child.argument && ts.isObjectExpression(child.argument)) object = child.argument;
        if (!object) visit(child);
      });
      return;
    }
    if (!object) forEachSyntaxChild(node, visit);
  };
  visit(ast.program);
  if (!object) return freezeContract(name, `unresolved:${definition}`, "", fingerprint(`unresolved:${definition}`));
  const description = objectProperty(object, "description");
  const prompt = objectProperty(object, "promptSnippet");
  const parameters = objectProperty(object, "parameters");
  return freezeContract(
    name,
    description ? normalizeContractText(syntaxText(ast, description.value)) : "",
    prompt ? normalizeContractText(syntaxText(ast, prompt.value)) : "",
    parameters ? fingerprint(syntaxText(ast, parameters.value)) : fingerprint(`unresolved-schema:${definition}`),
  );
}

function freezeContract(name: string, description: string, promptSnippet: string, parameterSchemaFingerprint: string): StaticToolContract {
  return Object.freeze({ name, description, promptSnippet, parameterSchemaFingerprint });
}

function normalizeContractText(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function fingerprint(value: string): string { return createHash("sha256").update(normalizeContractText(value)).digest("hex"); }

function parseBuiltinFactoryRoots(source: string, file: string, files: Readonly<Record<string, string>>): string[] {
  const ast = sourceFile(file, source);
  const imports = importBindings(ast);
  const roots = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.id?.name === "createBuiltinExtensionFactories") {
      const returned = findReturnedArray(node.body);
      for (const element of returned?.elements ?? []) {
        const expression = element && (ts.isCallExpression(element) ? element.callee : element);
        if (!expression || !ts.isIdentifier(expression)) continue;
        const binding = imports.get(expression.name);
        if (!binding) continue;
        const resolved = resolveSourceFile(file, binding.specifier, files);
        if (resolved) roots.add(resolved);
      }
    }
    forEachSyntaxChild(node, visit);
  };
  visit(ast.program);
  return [...roots].sort();
}

function parseOptionalExtensionRoots(source: string, config: LatentCompositionConfig): string[] {
  const ast = sourceFile(RETIRED_COMPOSITION, source);
  const roots: string[] = [];
  const platform = config.platform;
  const enabledEnv = config.enabledEnv;
  const visit = (node: ts.Node): void => {
    if (!ts.isVariableDeclarator(node) || !ts.isIdentifier(node.id) || node.id.name !== "OPTIONAL_EXTENSIONS") {
      forEachSyntaxChild(node, visit);
      return;
    }
    if (!node.init || !ts.isArrayExpression(node.init)) return;
    for (const element of node.init.elements) {
      if (!element || !ts.isObjectExpression(element)) continue;
      const pathProperty = objectProperty(element, "path");
      const path = pathProperty && ts.isExpression(pathProperty.value) ? optionalPath(pathProperty.value) : null;
      if (!path) continue;
      const envGate = stringProperty(element, "envGate");
      const platforms = stringArrayProperty(element, "platforms");
      if (enabledEnv && envGate && !enabledEnv.has(envGate)) continue;
      if (platform && platforms.length > 0 && !platforms.includes(platform)) continue;
      roots.push(path);
    }
  };
  visit(ast.program);
  return [...new Set(roots)].sort();
}

function optionalPath(expression: ts.Expression): string | null {
  if (!ts.isCallExpression(expression) || expression.arguments.length < 2) return null;
  const parts = expression.arguments.slice(1).map((argument) => literalString(argument));
  if (parts.some((part) => part === null)) return null;
  return posix.join("extensions", ...(parts as string[]));
}

export interface RegistrationParameterInventory {
  readonly fieldsByTool: Readonly<Record<string, readonly string[]>>;
  readonly unresolvedSchemas: readonly Readonly<{ file: string; registration: string }>[];
}

export interface NativeToolSchemaInventory {
  readonly fieldsByTool: Readonly<Record<string, readonly string[]>>;
  readonly variantsByTool: Readonly<Record<string, readonly Readonly<{ source: string; fields: readonly string[]; fingerprint: string }>[]>>;
  readonly unresolvedSchemas: readonly Readonly<{ file: string; registration: string }>[];
}

export function extractNativeToolParameterFields(): NativeToolSchemaInventory {
  const fieldsByTool: Record<string, readonly string[]> = Object.create(null);
  const variantsByTool: Record<string, readonly Readonly<{ source: string; fields: readonly string[]; fingerprint: string }>[]> = Object.create(null);
  const unresolvedSchemas: Array<Readonly<{ file: string; registration: string }>> = [];
  for (const toolName of ["read", "write", "edit", "bash", "grep", "find", "ls"] as const) {
    // The removed Harness family is checked by the pinned historical consumer.
    const variants = [["@earendil-works/pi-coding-agent", resolve(runtimeRoot, `../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/${toolName}.js`)]] as const;
    const snapshots: Array<Readonly<{ source: string; fields: readonly string[]; fingerprint: string }>> = [];
    for (const [packageName, path] of variants) {
      const source = readFileSync(path, "utf8");
      const schema = extractFirstTypeObjectSchema(path, source);
      if (!schema) {
        unresolvedSchemas.push(Object.freeze({ file: path, registration: toolName }));
        continue;
      }
      snapshots.push(Object.freeze({ source: `${packageName}:${posix.basename(path)}`, fields: Object.freeze(schema.fields), fingerprint: fingerprint(schema.source) }));
    }
    if (snapshots.length > 0) fieldsByTool[toolName] = snapshots[0]!.fields;
    variantsByTool[toolName] = Object.freeze(snapshots);
  }
  return Object.freeze({
    fieldsByTool: Object.freeze(fieldsByTool),
    variantsByTool: Object.freeze(variantsByTool),
    unresolvedSchemas: Object.freeze(unresolvedSchemas),
  });
}

function extractFirstTypeObjectSchema(file: string, source: string): { fields: string[]; source: string } | null {
  const ast = sourceFile(file, source);
  const variables = variableInitializers(ast);
  let schema: ts.Expression | null = null;
  const visit = (node: ts.Node): void => {
    if (!schema && ts.isObjectProperty(node) && propertyKeyName(node.key) === "parameters" && ts.isExpression(node.value)) {
      schema = ts.isIdentifier(node.value) ? variables.get(node.value.name) ?? null : node.value;
    }
    if (!schema) forEachSyntaxChild(node, visit);
  };
  visit(ast.program);
  if (!schema || !ts.isCallExpression(schema) || !ts.isMemberExpression(schema.callee) || schema.callee.computed
    || syntaxText(ast, schema.callee.object) !== "Type" || propertyKeyName(schema.callee.property) !== "Object") return null;
  const object = expressionArgument(schema.arguments[0]);
  if (!object || !ts.isObjectExpression(object)) return null;
  const fields = object.properties.map((property) => ts.isObjectProperty(property) ? propertyKeyName(property.key) : null)
    .filter((name): name is string => name !== null);
  if (fields.length !== object.properties.length) return null;
  return { fields, source: syntaxText(ast, schema) };
}

export function extractLiteralRegistrationParameterFields(
  file: string,
  source: string,
  files: Readonly<Record<string, string>> = {},
): RegistrationParameterInventory {
  const ast = sourceFile(file, source);
  const variables = variableInitializers(ast);
  const constants = stringConstants(ast);
  const fieldsByTool: Record<string, readonly string[]> = Object.create(null);
  const unresolvedSchemas: Array<Readonly<{ file: string; registration: string }>> = [];
  const parameterKeys = (expression: ts.Expression, seen = new Set<string>()): string[] | null => {
    if (ts.isCallExpression(expression)) {
      const argument = expressionArgument(expression.arguments[0]);
      if (argument) return parameterKeys(argument, seen);
    }
    if (ts.isObjectExpression(expression)) {
      const jsonSchemaProperties = objectProperty(expression, "properties");
      const fieldObject = jsonSchemaProperties && ts.isObjectExpression(jsonSchemaProperties.value)
        ? jsonSchemaProperties.value : expression;
      const names: string[] = [];
      for (const property of fieldObject.properties) {
        if (!ts.isObjectProperty(property)) return null;
        const name = propertyKeyName(property.key);
        if (!name) return null;
        names.push(name);
      }
      return names;
    }
    if (ts.isIdentifier(expression) && !seen.has(expression.name)) {
      seen.add(expression.name);
      const initializer = variables.get(expression.name);
      return initializer ? parameterKeys(initializer, seen) : null;
    }
    return null;
  };
  const visit = (node: ts.Node): void => {
    const argument = ts.isCallExpression(node) ? expressionArgument(node.arguments[0]) : null;
    if (ts.isCallExpression(node) && isRegisterToolCall(node.callee) && argument && ts.isObjectExpression(argument)) {
      const nameProperty = objectProperty(argument, "name");
      const parametersProperty = objectProperty(argument, "parameters");
      if (nameProperty && parametersProperty && ts.isExpression(nameProperty.value) && ts.isExpression(parametersProperty.value)) {
        const toolName = literalString(nameProperty.value)
          ?? (ts.isIdentifier(nameProperty.value)
            ? constants.get(nameProperty.value.name) ?? resolveImportedString(nameProperty.value.name, file, ast, files)
            : null)
          ?? undefined;
        const fields = parameterKeys(parametersProperty.value);
        if (toolName && fields) fieldsByTool[toolName] = Object.freeze(fields);
        else unresolvedSchemas.push(Object.freeze({
          file,
          registration: `${toolName ?? compact(syntaxText(ast, nameProperty.value))}#${compact(syntaxText(ast, parametersProperty.value))}`,
        }));
      }
    }
    forEachSyntaxChild(node, visit);
  };
  visit(ast.program);
  return Object.freeze({
    fieldsByTool: Object.freeze(fieldsByTool),
    unresolvedSchemas: Object.freeze(unresolvedSchemas),
  });
}

function parseRegistrations(
  file: string,
  source: string,
  files: Readonly<Record<string, string>> = {},
): Array<{ name: string | null; fingerprint: string }> {
  if (file.endsWith(".json")) return [];
  const ast = sourceFile(file, source);
  const constants = stringConstants(ast);
  const variables = variableInitializers(ast);
  const registrations: Array<{ name: string | null; fingerprint: string }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isRegisterToolCall(node.callee)) {
      const argument = expressionArgument(node.arguments[0]);
      registrations.push(argument
        ? resolveRegistration(argument, constants, variables, ast, file, files)
        : { name: null, fingerprint: "missing-argument" });
    }
    forEachSyntaxChild(node, visit);
  };
  visit(ast.program);
  return registrations;
}

function resolveRegistration(
  argument: ts.Expression,
  constants: ReadonlyMap<string, string>,
  variables: ReadonlyMap<string, ts.Expression>,
  ast: ParsedTypeScriptSource,
  file: string,
  files: Readonly<Record<string, string>>,
): { name: string | null; fingerprint: string } {
  if (ts.isObjectExpression(argument)) {
    const property = objectProperty(argument, "name");
    if (property && ts.isExpression(property.value)) {
      const literal = literalString(property.value);
      if (literal !== null) return { name: literal, fingerprint: "literal" };
      if (ts.isIdentifier(property.value)) {
        const name = constants.get(property.value.name) ?? resolveImportedString(property.value.name, file, ast, files);
        if (name) return { name, fingerprint: "source-constant" };
      }
      return { name: null, fingerprint: `name:${compact(syntaxText(ast, property.value))}` };
    }
    const spreads = argument.properties.filter(ts.isSpreadElement);
    if (spreads.length === 1 && ts.isIdentifier(spreads[0].argument)) {
      const identifier = spreads[0].argument.name;
      const initializer = variables.get(identifier);
      if (initializer && ts.isCallExpression(initializer)) {
        const factory = calleeName(initializer.callee);
        const name = factory && resolveFactoryToolName(factory, file, ast, files);
        if (name) return { name, fingerprint: `source-factory:${factory}` };
      }
      const inferred = /([A-Za-z][A-Za-z0-9]*)Tool$/.exec(identifier)?.[1];
      if (inferred) return { name: camelToSnake(inferred), fingerprint: `spread:${identifier}` };
    }
    return { name: null, fingerprint: `spread:${spreads.map((spread) => compact(syntaxText(ast, spread.argument))).join("+") || "none"}` };
  }
  if (ts.isCallExpression(argument)) {
    const factory = calleeName(argument.callee);
    const name = factory && resolveFactoryToolName(factory, file, ast, files);
    return name ? { name, fingerprint: `source-factory:${factory}` } : { name: null, fingerprint: `factory:${factory ?? "unknown"}` };
  }
  return { name: null, fingerprint: `expression:${compact(syntaxText(ast, argument))}` };
}

function resolveImportedString(
  localName: string,
  file: string,
  ast: ParsedTypeScriptSource,
  files: Readonly<Record<string, string>>,
): string | null {
  const binding = importBindings(ast).get(localName);
  if (!binding) return null;
  const target = resolveSourceFile(file, binding.specifier, files);
  return target ? resolveExportedString(target, binding.imported, files, new Set()) : null;
}

function resolveExportedString(
  file: string,
  exportedName: string,
  files: Readonly<Record<string, string>>,
  seen: Set<string>,
): string | null {
  const key = `${file}#${exportedName}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const source = files[file];
  if (source === undefined) return null;
  const ast = sourceFile(file, source);
  const local = stringConstants(ast).get(exportedName);
  if (local) return local;
  for (const statement of ast.statements) {
    if (ts.isExportNamedDeclaration(statement)) {
      const specifier = statement.source?.value ?? null;
      const element = statement.specifiers.find((candidate) =>
        ts.isExportSpecifier(candidate) && propertyKeyName(candidate.exported) === exportedName
      );
      if (!element || !ts.isExportSpecifier(element)) continue;
      const original = propertyKeyName(element.local);
      if (!original) continue;
      if (!specifier) return stringConstants(ast).get(original) ?? null;
      const target = resolveSourceFile(file, specifier, files);
      return target ? resolveExportedString(target, original, files, seen) : null;
    }
    if (ts.isExportAllDeclaration(statement)) {
      const target = resolveSourceFile(file, statement.source.value, files);
      const value = target ? resolveExportedString(target, exportedName, files, seen) : null;
      if (value) return value;
    }
  }
  return null;
}

function resolveFactoryToolName(
  localName: string,
  file: string,
  ast: ParsedTypeScriptSource,
  files: Readonly<Record<string, string>>,
): string | null {
  const local = findFactoryToolName(ast, localName);
  if (local) return local;
  const binding = importBindings(ast).get(localName);
  if (!binding) return factoryConvention(localName);
  const target = resolveSourceFile(file, binding.specifier, files);
  return target
    ? resolveExportedFactoryToolName(target, binding.imported, files, new Set())
    : factoryConvention(binding.imported);
}

function resolveExportedFactoryToolName(
  file: string,
  exportedName: string,
  files: Readonly<Record<string, string>>,
  seen: Set<string>,
): string | null {
  const key = `${file}#${exportedName}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const source = files[file];
  if (source === undefined) return null;
  const ast = sourceFile(file, source);
  const local = findFactoryToolName(ast, exportedName);
  if (local) return local;
  for (const statement of ast.statements) {
    if (ts.isExportNamedDeclaration(statement)) {
      const specifier = statement.source?.value ?? null;
      const element = statement.specifiers.find((candidate) =>
        ts.isExportSpecifier(candidate) && propertyKeyName(candidate.exported) === exportedName
      );
      if (!element || !ts.isExportSpecifier(element)) continue;
      const original = propertyKeyName(element.local);
      if (!original) continue;
      if (!specifier) return findFactoryToolName(ast, original);
      const target = resolveSourceFile(file, specifier, files);
      return target ? resolveExportedFactoryToolName(target, original, files, seen) : null;
    }
    if (ts.isExportAllDeclaration(statement)) {
      const target = resolveSourceFile(file, statement.source.value, files);
      const value = target ? resolveExportedFactoryToolName(target, exportedName, files, seen) : null;
      if (value) return value;
    }
  }
  return null;
}

function findFactoryToolName(ast: ParsedTypeScriptSource, symbol: string): string | null {
  let body: ts.Expression | ts.BlockStatement | undefined;
  for (const statement of ast.statements) {
    const declaration = ts.isExportNamedDeclaration(statement) && statement.declaration ? statement.declaration : statement;
    if (ts.isFunctionDeclaration(declaration) && declaration.id?.name === symbol && declaration.body) body = declaration.body;
    if (!ts.isVariableDeclaration(declaration)) continue;
    for (const variable of declaration.declarations) {
      if (ts.isIdentifier(variable.id) && variable.id.name === symbol && variable.init &&
        (ts.isArrowFunctionExpression(variable.init) || ts.isFunctionExpression(variable.init))) body = variable.init.body;
    }
  }
  if (!body) return null;
  let found: string | null = null;
  const inspectObject = (object: ts.ObjectExpression): void => {
    const property = objectProperty(object, "name");
    if (property) found = literalString(property.value);
  };
  if (ts.isObjectExpression(body)) inspectObject(body);
  else {
    const visit = (node: ts.Node): void => {
      if (!found && ts.isReturnStatement(node) && node.argument && ts.isObjectExpression(node.argument)) inspectObject(node.argument);
      if (!found) forEachSyntaxChild(node, visit);
    };
    visit(body);
  }
  return found;
}

function factoryConvention(value: string): string | null {
  const stem = /^create(.+)Tool$/.exec(value)?.[1];
  return stem ? camelToSnake(stem) : null;
}

function camelToSnake(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function resolveCalledImportedRoots(file: string, source: string, files: Readonly<Record<string, string>>): string[] {
  const ast = sourceFile(file, source);
  const imports = importBindings(ast);
  const roots = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.callee)) {
      const binding = imports.get(node.callee.name);
      if (binding) {
        const resolved = resolveSourceFile(file, binding.specifier, files);
        if (resolved) roots.add(resolved);
      }
    }
    forEachSyntaxChild(node, visit);
  };
  visit(ast.program);
  return [...roots].sort();
}

function resolveModuleGraphEdges(file: string, source: string, files: Readonly<Record<string, string>>): string[] {
  const ast = sourceFile(file, source);
  const roots: string[] = [];
  const add = (specifier: string): void => {
    const resolved = resolveSourceFile(file, specifier, files);
    if (resolved && !roots.includes(resolved)) roots.push(resolved);
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isExportNamedDeclaration(node) || ts.isExportAllDeclaration(node)) && node.source) add(node.source.value);
    if (ts.isTSImportEqualsDeclaration(node) && ts.isTSExternalModuleReference(node.moduleReference)) {
      const specifier = literalString(node.moduleReference.expression);
      if (specifier) add(specifier);
    }
    if (ts.isImportExpression(node)) {
      const specifier = literalString(node.source);
      if (specifier) add(specifier);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.callee) && node.callee.name === "require") {
      const specifier = literalString(node.arguments[0]);
      if (specifier) add(specifier);
    }
    forEachSyntaxChild(node, visit);
  };
  visit(ast.program);
  return roots.sort();
}

function resolveForwardedDefaultRoot(file: string, source: string, files: Readonly<Record<string, string>>): string | null {
  const ast = sourceFile(file, source);
  const imports = importBindings(ast);
  for (const statement of ast.statements) {
    if (ts.isExportDefaultDeclaration(statement) && ts.isIdentifier(statement.declaration)) {
      const binding = imports.get(statement.declaration.name);
      if (binding) return resolveSourceFile(file, binding.specifier, files);
    }
    if (ts.isExportNamedDeclaration(statement) && statement.source && statement.specifiers.some((element) =>
      ts.isExportSpecifier(element) && propertyKeyName(element.exported) === "default"
    )) {
      return resolveSourceFile(file, statement.source.value, files);
    }
  }
  return null;
}

function resolveSourceFile(fromFile: string, specifier: string, files: Readonly<Record<string, string>>): string | null {
  if (specifier.startsWith(".")) return resolveCandidate(posix.join(posix.dirname(fromFile), specifier), files);
  const configured = resolveTsconfigPath(specifier, files);
  if (configured) return configured;
  const imported = resolvePackageImport(specifier, files);
  if (imported) return imported;
  return resolvePackageExport(specifier, files);
}

function resolveTsconfigPath(specifier: string, files: Readonly<Record<string, string>>): string | null {
  const parsed = parseJsonConfig(files["tsconfig.json"]);
  const compiler = parsed?.compilerOptions;
  if (!compiler || typeof compiler !== "object" || Array.isArray(compiler)) return null;
  const paths = (compiler as Record<string, unknown>).paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) return null;
  const baseUrl = typeof (compiler as Record<string, unknown>).baseUrl === "string"
    ? (compiler as Record<string, unknown>).baseUrl as string : ".";
  for (const [pattern, rawTargets] of Object.entries(paths as Record<string, unknown>)) {
    const wildcard = matchPattern(pattern, specifier);
    if (wildcard === null || !Array.isArray(rawTargets)) continue;
    for (const rawTarget of rawTargets) {
      if (typeof rawTarget !== "string") continue;
      const target = rawTarget.replace("*", wildcard);
      const resolved = resolveCandidate(posix.join(baseUrl, target), files);
      if (resolved) return resolved;
    }
  }
  return null;
}

function resolvePackageImport(specifier: string, files: Readonly<Record<string, string>>): string | null {
  if (!specifier.startsWith("#")) return null;
  const manifest = parseJsonConfig(files["package.json"]);
  const imports = manifest?.imports;
  if (!imports || typeof imports !== "object" || Array.isArray(imports)) return null;
  return resolveExportMapTarget(specifier, imports as Record<string, unknown>, "", files);
}

function resolvePackageExport(specifier: string, files: Readonly<Record<string, string>>): string | null {
  const segments = specifier.split("/");
  const packageName = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0] ?? "";
  if (!packageName) return null;
  const subpath = specifier.slice(packageName.length);
  const rootManifest = parseJsonConfig(files["package.json"]);
  const rootName = typeof rootManifest?.name === "string" ? rootManifest.name : null;
  const packageRoot = rootName === packageName ? "" : `node_modules/${packageName}`;
  const manifest = rootName === packageName ? rootManifest : parseJsonConfig(files[posix.join(packageRoot, "package.json")]);
  if (!manifest) return null;
  const exports = manifest.exports;
  if (exports === undefined) return null;
  const exportKey = subpath ? `.${subpath}` : ".";
  if (typeof exports === "string" && exportKey === ".") return resolveCandidate(posix.join(packageRoot, normalizePackageTarget(exports)), files);
  if (!exports || typeof exports !== "object" || Array.isArray(exports)) return null;
  return resolveExportMapTarget(exportKey, exports as Record<string, unknown>, packageRoot, files);
}

function resolveExportMapTarget(specifier: string, map: Record<string, unknown>, packageRoot: string, files: Readonly<Record<string, string>>): string | null {
  for (const [pattern, rawTarget] of Object.entries(map)) {
    const wildcard = matchPattern(pattern, specifier);
    if (wildcard === null) continue;
    const target = selectExportTarget(rawTarget);
    if (!target) continue;
    const resolved = resolveCandidate(posix.join(packageRoot, normalizePackageTarget(target.replace("*", wildcard))), files);
    if (resolved) return resolved;
  }
  return null;
}

function selectExportTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const condition of ["import", "bun", "node", "default"]) {
    const selected = selectExportTarget(record[condition]);
    if (selected) return selected;
  }
  return null;
}

function matchPattern(pattern: string, value: string): string | null {
  const index = pattern.indexOf("*");
  if (index < 0) return pattern === value ? "" : null;
  if (pattern.indexOf("*", index + 1) >= 0) return null;
  const prefix = pattern.slice(0, index);
  const suffix = pattern.slice(index + 1);
  return value.startsWith(prefix) && value.endsWith(suffix) ? value.slice(prefix.length, value.length - suffix.length) : null;
}

function normalizePackageTarget(target: string): string {
  const normalized = target.replace(/^\.\//, "");
  return normalized.startsWith("runtime/") ? normalized.slice("runtime/".length) : normalized;
}

function resolveCandidate(value: string, files: Readonly<Record<string, string>>): string | null {
  const base = posix.normalize(value).replace(/^\.\//, "");
  if (base.startsWith("../") || base === "..") return null;
  const withoutExtension = base.replace(/\.(?:[cm]?js|tsx?)$/, "");
  const candidates = [base, `${withoutExtension}.ts`, `${withoutExtension}.tsx`, posix.join(base, "index.ts")];
  return candidates.find((candidate) => Object.hasOwn(files, candidate)) ?? null;
}

function parseJsonConfig(source: string | undefined): Record<string, unknown> | null {
  if (source === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

function importBindings(ast: ParsedTypeScriptSource): Map<string, { specifier: string; imported: string }> {
  const bindings = new Map<string, { specifier: string; imported: string }>();
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.source.value;
    for (const binding of statement.specifiers) {
      if (ts.isImportDefaultSpecifier(binding)) bindings.set(binding.local.name, { specifier, imported: "default" });
      if (ts.isImportSpecifier(binding)) {
        const imported = propertyKeyName(binding.imported);
        if (imported) bindings.set(binding.local.name, { specifier, imported });
      }
    }
  }
  return bindings;
}

function findReturnedArray(body: ts.BlockStatement | undefined): ts.ArrayExpression | null {
  if (!body) return null;
  let found: ts.ArrayExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (!found && ts.isReturnStatement(node) && node.argument && ts.isArrayExpression(node.argument)) found = node.argument;
    if (!found) forEachSyntaxChild(node, visit);
  };
  visit(body);
  return found;
}

function stringConstants(ast: ParsedTypeScriptSource): Map<string, string> {
  const values = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclarator(node) && ts.isIdentifier(node.id) && node.init) {
      const value = literalString(node.init);
      if (value !== null) values.set(node.id.name, value);
    }
    forEachSyntaxChild(node, visit);
  };
  visit(ast.program);
  return values;
}

function variableInitializers(ast: ParsedTypeScriptSource): Map<string, ts.Expression> {
  const values = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclarator(node) && ts.isIdentifier(node.id) && node.init && ts.isExpression(node.init)) {
      values.set(node.id.name, node.init);
    }
    forEachSyntaxChild(node, visit);
  };
  visit(ast.program);
  return values;
}

function objectProperty(object: ts.ObjectExpression, name: string): ts.ObjectProperty | null {
  return object.properties.find((property): property is ts.ObjectProperty =>
    ts.isObjectProperty(property) && propertyKeyName(property.key) === name
  ) ?? null;
}

function stringProperty(object: ts.ObjectExpression, name: string): string | null {
  const property = objectProperty(object, name);
  return property ? literalString(property.value) : null;
}

function stringArrayProperty(object: ts.ObjectExpression, name: string): string[] {
  const property = objectProperty(object, name);
  if (!property || !ts.isArrayExpression(property.value)) return [];
  return property.value.elements.map((entry) => entry && literalString(entry)).filter((entry): entry is string => entry !== null);
}

function isRegisterToolCall(expression: ts.Expression | ts.V8IntrinsicIdentifier): boolean {
  return ts.isMemberExpression(expression) && !expression.computed && propertyKeyName(expression.property) === "registerTool";
}

function calleeName(expression: ts.Expression | ts.V8IntrinsicIdentifier): string | null {
  if (ts.isIdentifier(expression)) return expression.name;
  if (ts.isMemberExpression(expression) && !expression.computed) return propertyKeyName(expression.property);
  return null;
}

function expressionArgument(node: ts.Node | null | undefined): ts.Expression | null {
  return node && ts.isExpression(node) ? node : null;
}

function containsCall(source: string, name: string): boolean {
  const ast = sourceFile(RETIRED_COMPOSITION, source);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node.callee) === name) found = true;
    if (!found) forEachSyntaxChild(node, visit);
  };
  visit(ast.program);
  return found;
}

function sourceFile(file: string, source: string): ParsedTypeScriptSource {
  return parseTypeScriptSource(file, source);
}

function addSite(target: Map<string, Set<string>>, name: string, file: string): void {
  const values = target.get(name) ?? new Set<string>();
  values.add(file);
  target.set(name, values);
}

function readonlySiteRecord(source: Map<string, Set<string>>): Readonly<Record<string, readonly string[]>> {
  return Object.freeze(Object.fromEntries(
    [...source].sort(([left], [right]) => left.localeCompare(right)).map(([name, values]) => [name, Object.freeze([...values].sort())]),
  ));
}

function compact(value: string): string {
  return value.replace(/\s+/g, "").slice(0, 120);
}

function walkTypeScript(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...walkTypeScript(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(path);
    }
  }
  return files.sort();
}
