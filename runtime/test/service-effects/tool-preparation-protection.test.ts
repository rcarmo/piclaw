import "../helpers.js";

import { describe, expect, test } from "bun:test";

import {
  DYNAMIC_TOOL_PREPARATION_TEMPLATES,
  TOOL_PREPARATION_MANIFEST,
} from "../../src/service-effects/tool-preparation/manifest.js";
import {
  candidateForSelector,
  observeWithProtection,
} from "./fixtures/protected-observer.js";
import {
  extractLiteralRegistrationParameterFields,
  extractNativeToolParameterFields,
  inventoryRepositoryToolFamilies,
  readRepositorySourceTree,
} from "./fixtures/repository-tool-family-oracle.js";

const OPAQUE_FACTORY_SCHEMA_EVIDENCE = Object.freeze([
  Object.freeze({ toolName: "exec_batch", file: "runtime/src/tools/context-tools.ts", factory: "createBatchExecTool", fields: Object.freeze(["commands"]), rationale: "The registration spreads an imported factory result; the batch command array is user-authored process input." }),
  Object.freeze({ toolName: "search_tool_output", file: "runtime/src/tools/context-tools.ts", factory: "createToolOutputSearchTool", fields: Object.freeze(["handle", "query"]), rationale: "The registration spreads an imported factory result; both output handle and query identify private prior tool output." }),
  Object.freeze({ toolName: "local_bash", file: "runtime/src/extensions/ssh-core.ts", factory: "createBashTool", fields: Object.freeze(["command", "timeout"]), rationale: "The registration spreads the installed SDK bash definition and overrides execution without restating its schema." }),
  Object.freeze({ toolName: "powershell", file: "runtime/extensions/platform/windows/powershell/index.ts", factory: "baseDefinition", fields: Object.freeze(["command", "timeout"]), rationale: "The Windows registration spreads a generated PowerShell base definition rather than declaring a literal parameter object." }),
  Object.freeze({ toolName: "mcp", file: "node_modules/pi-mcp-adapter", factory: "createMcpAdapter", fields: Object.freeze(["tool", "args", "server", "search", "describe", "instructions", "connect", "redirectUrl"]), rationale: "The programmatic external adapter owns an action-union schema outside repository registration literals." }),
]);

function safeException(toolName: string, fields: readonly string[], rationale: string) {
  return Object.freeze({ toolName, fields: Object.freeze([...fields]), rationale });
}

const SAFE_PARAMETER_EXCEPTIONS = Object.freeze([
  safeException("read", ["offset", "limit"], "Line-window controls bound the public read operation; file paths and returned content remain protected."),
  safeException("bash", ["timeout"], "The numeric execution timeout is an operational bound; command text and all process output remain protected."),
  safeException("local_bash", ["timeout"], "The numeric local execution timeout is an operational bound; command text and all process output remain protected."),
  safeException("powershell", ["timeout"], "The numeric PowerShell execution timeout is an operational bound; command text and all process output remain protected."),
  safeException("grep", ["glob", "ignoreCase", "literal", "context", "limit"], "Glob syntax, matching switches, context count, and result bound are query controls; search text, paths, and results remain protected."),
  safeException("find", ["limit"], "The bounded result count is an operational control; path, pattern, and returned filesystem names remain protected."),
  safeException("ls", ["limit"], "The bounded result count is an operational control; path and returned filesystem names remain protected."),
  safeException("list_tools", ["limit", "include_parameters"], "Bounded catalog pagination and a boolean detail switch contain no free-form request content."),
  safeException("list_scripts", ["scope", "role", "limit", "include_metadata"], "Closed scope/role selectors, a bounded count, and a metadata boolean carry no user-authored content."),
  safeException("activate_tools", ["names", "mode"], "Tool names come from the public catalog and mode is a closed activation enum, not private payload data."),
  safeException("attach_file", ["content_type", "kind"], "MIME classification and the closed attachment-kind enum do not reveal file paths, names, or bytes."),
  safeException("read_attachment", ["mode", "max_bytes"], "The read mode and bounded byte limit are operational controls; attachment identity and content remain protected."),
  safeException("messages", ["action", "role", "after", "before", "since", "after_row", "before_row", "limit", "excerpt_chars", "offset", "context_before", "context_after", "details_max_chars", "content_lines", "regex", "context_lines", "max_matches", "capture_group", "dedupe", "sort", "type", "dry_run", "force"], "Closed actions, pagination bounds, time/row cursors, and matching switches expose query mechanics but no message content or identities."),
  safeException("list_models", ["limit", "offset"], "Pagination integers reveal only catalog traversal mechanics and no provider credentials or prompts."),
  safeException("switch_model", ["model"], "The model value is a public provider/catalog identifier selected from the runtime model registry."),
  safeException("switch_thinking", ["level"], "Thinking level is a closed public execution-mode enum with no prompt or response content."),
  safeException("introspect_sql", ["limit"], "The bounded result count is safe while the SQL query and returned database values remain protected."),
  safeException("schedule_task", ["schedule_type", "schedule_value", "model", "task_kind", "timeout_sec", "notify", "muted", "no_nudge"], "Schedule timing, task/model enums, timeout, and notification flags are controls; command and prompt bodies remain protected."),
  safeException("scheduled_tasks", ["action", "status", "limit", "include_latest_run_log", "allow_internal", "notify", "muted", "no_nudge", "schedule_type", "schedule_value", "model", "task_kind", "timeout_sec"], "Closed task actions/status, timing, bounds, and notification flags do not include stored prompts, commands, or run output."),
  safeException("memory_query", ["limit", "offset", "mode"], "Bounded count, candidate offset, and closed retrieval-mode selector are mechanics; query text and returned notes remain protected."),
  safeException("search_workspace", ["scope", "limit", "offset", "refresh", "max_kb"], "Search scope, pagination, refresh, and size bounds are mechanics; the free-form query and matched content stay protected."),
  safeException("send_adaptive_card", ["schema_version", "submit_behavior", "completed_at"], "Schema version, closed submit behavior, and completion time describe transport state rather than card payload content."),
  safeException("send_dashboard_widget", ["interactive"], "The interaction boolean is a transport capability flag; widget HTML and fallback content remain protected."),
  safeException("chat", ["mode"], "Delivery mode is a closed queueing enum and contains neither destination identity nor message content."),
  safeException("chat_project", ["action"], "The closed project-setting action carries no repository URL or chat identity."),
  safeException("session_control", ["action", "model", "force"], "Closed control action, public model identifier, and force flag carry no cross-session instructions or destination identity."),
  safeException("session_status", ["action"], "The status action is a closed read-only selector and contains no session result details."),
  safeException("open_workspace_file", ["target"], "The target is a closed tab/popout presentation enum; file path and user-visible label remain protected."),
  safeException("env", ["action", "limit"], "Closed environment operation and bounded listing count reveal no variable names or values."),
  safeException("image_process", ["action", "format", "quality", "width", "height", "fit", "left", "top", "angle", "sigma", "gravity", "preserve_transparency", "overwrite", "animated", "delay", "loop", "frame_count", "direction", "brightness", "saturation", "hue", "gamma", "contrast", "tint_color", "clahe_width", "clahe_height", "threshold_value", "median_size", "extend_top", "extend_bottom", "extend_left", "extend_right", "extend_background", "channel", "text_color", "text_size", "density", "tile_size", "affine_matrix", "strip_metadata"], "Closed image-operation selectors and numeric/rendering controls expose transformation mechanics; paths, overlays, and text remain protected."),
  safeException("bun_run", ["timeout_sec", "capture_stdout"], "Timeout and output-capture controls contain no script path, arguments, working directory, or process output."),
  safeException("keychain", ["action", "field", "type", "limit"], "Closed keychain operation/field/type selectors and a bound contain no entry name, username, or secret."),
  safeException("ssh", ["action", "ssh_port", "strict_host_key_checking"], "Closed profile action, numeric port, and host-key policy expose no target, chat identity, or keychain entry names."),
  safeException("cdp_browser", ["action", "ms", "landscape", "displayHeaderFooter", "preferCSSPageSize"], "The closed browser action, wait duration, and PDF layout booleans are execution controls; expressions, URLs, match text, selectors, paths, and templates remain protected."),
]);
const SAFE_PARAMETER_FIELDS = new Map(SAFE_PARAMETER_EXCEPTIONS.map((entry) => [entry.toolName, entry.fields]));

describe("WP-3C protected trace/projection oracle", () => {
  test("redacts every declared selector from params, results and updates", () => {
    const selectors = new Set([
      ...TOOL_PREPARATION_MANIFEST.flatMap((row) => row.protectedFields),
      ...DYNAMIC_TOOL_PREPARATION_TEMPLATES.flatMap((row) => row.protectedFields),
    ]);
    for (const [index, selector] of [...selectors].sort().entries()) {
      const secret = `fixture-secret-${index}-${selector}`;
      const candidate = candidateForSelector(selector, secret);
      const observation = observeWithProtection({
        ...candidate,
        updates: candidate.result ? [candidate.result] : [],
      }, [selector]);
      expect(JSON.stringify(observation)).not.toContain(secret);
    }
  });

  test("does not invoke thrown or changing getters and sanitizes generic errors", () => {
    const secret = "getter-and-error-secret";
    let calls = 0;
    const params = Object.defineProperty({}, "secret", {
      enumerable: true,
      get: () => { calls += 1; if (calls > 1) throw new Error(secret); return secret; },
    });
    const result = Object.defineProperty({}, "content", {
      enumerable: true,
      get: () => { calls += 1; throw new Error(secret); },
    });
    const observation = observeWithProtection({ params, result, updates: [result], error: new Error(secret) }, [
      "params.secret", "result.content",
    ]);
    expect(calls).toBe(0);
    expect(JSON.stringify(observation)).not.toContain(secret);
    expect(observation.error).toEqual({ name: "Error", message: "tool operation failed" });
  });

  test("rejects hostile outer inputs, update arrays and selector arrays without invoking accessors", () => {
    let calls = 0;
    const hostileInput = Object.defineProperty({}, "params", {
      enumerable: true,
      get: () => { calls += 1; return { secret: "outer-secret" }; },
    });
    const hostileUpdates = Object.defineProperty([], "0", {
      enumerable: true,
      get: () => { calls += 1; return { content: "update-secret" }; },
    });
    hostileUpdates.length = 1;
    const hostileSelectors = Object.defineProperty([], "0", {
      enumerable: true,
      get: () => { calls += 1; return "params.secret"; },
    });
    hostileSelectors.length = 1;
    const revoked = Proxy.revocable([], {});
    revoked.revoke();

    const inputObservation = observeWithProtection(hostileInput as never, ["params.secret"]);
    const updateObservation = observeWithProtection({ updates: hostileUpdates }, ["result.content"]);
    const selectorObservation = observeWithProtection({ params: { secret: "selector-secret" } }, hostileSelectors as never);
    expect(() => observeWithProtection({ params: {} }, revoked.proxy as never)).not.toThrow();
    expect(calls).toBe(0);
    expect(inputObservation.params).toBe("[UNOBSERVABLE]");
    expect(updateObservation.updates).toBe("[UNOBSERVABLE]");
    expect(selectorObservation.params).toBe("[UNOBSERVABLE]");
  });

  test("safe-field exceptions are frozen, unique and carry explicit closed rationales", () => {
    expect(Object.isFrozen(SAFE_PARAMETER_EXCEPTIONS)).toBeTrue();
    expect(new Set(SAFE_PARAMETER_EXCEPTIONS.map((entry) => entry.toolName)).size).toBe(SAFE_PARAMETER_EXCEPTIONS.length);
    for (const exception of SAFE_PARAMETER_EXCEPTIONS) {
      expect(Object.isFrozen(exception)).toBeTrue();
      expect(Object.isFrozen(exception.fields)).toBeTrue();
      expect(exception.rationale.length).toBeGreaterThan(60);
      expect(new Set(exception.fields).size).toBe(exception.fields.length);
      expect(TOOL_PREPARATION_MANIFEST.some((row) => row.toolName === exception.toolName)).toBeTrue();
    }
  });

  test("reports an unresolved registration schema instead of treating it as empty", () => {
    const inventory = extractLiteralRegistrationParameterFields(
      "fixture.ts",
      `declare const externalSchema: unknown; pi.registerTool({ name: "fixture_tool", parameters: externalSchema });`,
    );
    expect(inventory.fieldsByTool).toEqual({});
    expect(inventory.unresolvedSchemas).toEqual([{ file: "fixture.ts", registration: "fixture_tool#externalSchema" }]);
    expect(Object.isFrozen(inventory.unresolvedSchemas)).toBeTrue();
  });

  test("source schemas are closed by protected fields or explicit safe-field exceptions", () => {
    const sourceTree = readRepositorySourceTree();
    const inventory = inventoryRepositoryToolFamilies(sourceTree);
    const schemaFields = new Map<string, Set<string>>();
    const unresolvedSchemas: Array<Readonly<{ file: string; registration: string }>> = [];
    const visitedSites = new Set<string>();
    for (const sites of Object.values(inventory.registrationSites)) {
      for (const file of sites) {
        if (visitedSites.has(file)) continue;
        visitedSites.add(file);
        const extracted = extractLiteralRegistrationParameterFields(file, sourceTree.files[file], sourceTree.files);
        unresolvedSchemas.push(...extracted.unresolvedSchemas);
        for (const [toolName, fields] of Object.entries(extracted.fieldsByTool)) {
          const accumulated = schemaFields.get(toolName) ?? new Set<string>();
          for (const field of fields) accumulated.add(field);
          schemaFields.set(toolName, accumulated);
        }
      }
    }

    const nativeInventory = extractNativeToolParameterFields();
    unresolvedSchemas.push(...nativeInventory.unresolvedSchemas);
    for (const [toolName, fields] of Object.entries(nativeInventory.fieldsByTool)) schemaFields.set(toolName, new Set(fields));
    for (const toolName of ["read", "write", "edit", "bash"] as const) {
      const variants = nativeInventory.variantsByTool[toolName];
      expect(variants.map((variant) => variant.source)).toEqual([
        `@earendil-works/pi-agent-core:${toolName}.js`, `@earendil-works/pi-coding-agent:${toolName}.js`,
      ]);
      expect(variants[0]!.fields).toEqual(variants[1]!.fields);
      expect(variants.every((variant) => /^[a-f0-9]{64}$/.test(variant.fingerprint))).toBeTrue();
    }

    const opaqueNames = inventory.names.filter((toolName) => !schemaFields.has(toolName)).sort();
    expect(opaqueNames).toEqual(OPAQUE_FACTORY_SCHEMA_EVIDENCE.map((entry) => entry.toolName).sort());
    for (const evidence of OPAQUE_FACTORY_SCHEMA_EVIDENCE) {
      expect(evidence.file.length).toBeGreaterThan(20);
      expect(evidence.factory.length).toBeGreaterThan(4);
      expect(evidence.rationale.length).toBeGreaterThan(80);
      expect(Object.isFrozen(evidence.fields)).toBeTrue();
      schemaFields.set(evidence.toolName, new Set(evidence.fields));
    }

    expect(unresolvedSchemas).toEqual([]);
    expect([...schemaFields.keys()].sort()).toEqual(TOOL_PREPARATION_MANIFEST.map((row) => row.toolName).sort());
    for (const [toolName, fields] of schemaFields) {
      const row = TOOL_PREPARATION_MANIFEST.find((candidate) => candidate.toolName === toolName)!;
      const protectedTopLevel = new Set(row.protectedFields.flatMap((selector) => {
        const match = /^params\.([^.]+)$/.exec(selector);
        return match ? [match[1]] : [];
      }));
      const safe = new Set(SAFE_PARAMETER_FIELDS.get(toolName) ?? []);
      expect([...safe].filter((field) => !fields.has(field))).toEqual([]);
      expect([...safe].filter((field) => protectedTopLevel.has(field))).toEqual([]);
      expect([...fields].filter((field) => !protectedTopLevel.has(field) && !safe.has(field))).toEqual([]);
    }
  });

  test("wildcard templates redact arbitrary nested candidate data", () => {
    const secret = "dynamic-template-secret";
    for (const template of DYNAMIC_TOOL_PREPARATION_TEMPLATES) {
      const observation = observeWithProtection({
        params: { nested: { secret } },
        result: { content: [{ type: "text", text: secret }], details: { secret } },
        updates: [{ content: secret }],
        error: new Error(secret),
      }, template.protectedFields);
      expect(JSON.stringify(observation)).not.toContain(secret);
    }
  });
});
