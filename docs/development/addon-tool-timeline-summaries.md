# Tool-owned call summaries

A tool supplies its own `callSummary(args)` callback alongside its parameter schema and execution function. Add-ons own the wording, action interpretation and safe-field selection. Core carries this metadata through the native bridge, resolves the conversation’s selected tools, and applies generic text validation and presentation.

The public type is in `runtime/public/addon-hooks.d.ts`:

```ts
type ToolCallSummary = (args: unknown) => string | null | undefined;
interface ToolCallSummaryMetadata { readonly callSummary: ToolCallSummary }
```

The add-on repository documents the authoring contract in `documentation/tool-call-summaries.md`. Standalone packages vendor the small registration/text helper; they do not import private Core source.

## Data flow

1. The add-on declares a pure, synchronous callback on each tool. Legacy and native factories both carry the metadata.
2. `createHostTool()` snapshots the callback with the actual definition, preserves it on the native registration, and includes it in binding-identity checks. The upstream SDK interface and argument schema are unchanged.
3. Native loading requires a synchronous callback for each qualified add-on tool. Captured registrations retain their callback identity. Approved source hashes include the package’s formatter/helper modules and protect them against resolution shadows.
4. A native watch resolves metadata from that conversation’s public `agent()` tools, callable tools and deferred tools. The resolved snapshot is refreshed when the selected agent or registry changes. A same-named tool in an unselected extension cannot supply text.
5. The existing title tracker reuses captions while the arguments and selected provider stay unchanged, then clears them at the turn boundary.
6. Historical reads return bounded text facts for model and nested calls. The timeline consumes those facts; it does not load an add-on or retain a callback itself.

There is no Core add-on-name dictionary and no process-global name-to-formatter registry. No caption is inserted into a tool result, model transcript or new storage ledger. Raw arguments and results remain unchanged.

## Presentation rules

Callbacks receive deeply readonly copies of argument data and return detail text only. Core adds the stable tool-name prefix, strips control/ANSI sequences, folds whitespace and bounds the detail to 120 characters. Non-string output, exceptions and unsupported asynchronous providers produce a safe tool-name caption without an argument preview.

A tool without metadata retains the generic compatibility fallback. Historical reads use currently available registered providers, so a caption can change after an add-on update. Unavailable providers do not cause module loading or execution replay.

The callback grants no execution, source-adoption, ownership or cancellation authority. All existing fences remain in force. Callbacks must not execute a tool, read configuration/keychain/files, contact services, start asynchronous work, capture a session context or mutate arguments. First-party tests check the pure formatter import closure and sensitive-field selection; this contract is not a JavaScript security sandbox.

A tool can deliberately retain an existing payload-preview policy. For example, the Codex `exec_command` tool supplies its own shell-command preview, while `write_stdin` supplies only input/output intent and the session ID. Core does not infer either policy from the tool name.

## Coverage and package ownership

The repository contains 49 add-on source directories, including three retired packages. Its active catalogue has 46 entries. All 27 active tool add-ons provide 77 distinct tool names. The current Core-owned Plan and Delegate tools declare their own callbacks through the same contract; their retired add-on packages remain byte-identical.

Proxmox and Portainer own their 55 and 42 workflow labels beside their capability metadata. Their callbacks retain useful endpoints, HTTP methods, request counts and selected target IDs. Other formatters live in their own packages, including the four factory-registered Microsoft To Do tools. Core does not know those operation vocabularies or field selections.

All changed active packages receive patch-version updates. Explicit standalone package allowlists include the formatter/helper files, and archive tests import every pure formatter closure from the actual packed package. Existing published archives and retired release bytes are preserved.

## Verification

- Root contract tests cover callback scoping, snapshots, readonly inputs, invalid/async providers, text bounds, historical/nested facts and the absence of an add-on dictionary.
- Native bridge tests protect callback identity and reject malformed metadata.
- A real public-SDK integration test holds a nested tool while live and historical captions are read. It checks correct conversation ownership, no extra effects or stored captions, nested rendering, and exclusion of callback/execution properties from model `toolsAdded` declarations.
- Add-on tests cover every active tool declaration, documented operations, all 97 infrastructure workflows, sensitive fields, package-local imports and standalone archive closure. The AST check detects a missing registration provider and expands the dynamic To Do registration helper.
- Existing Plan/delegate wording tests now exercise their tool-provided callbacks. The generic Core formatter no longer supplies those domain-specific strings.

Coordinated source pins and default bundles must match the published add-on versions before a Core release. Installation and restart remain separately authorised.
