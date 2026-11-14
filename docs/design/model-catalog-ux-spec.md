# Model catalogue UX specification

> Historical source audit. Visual was removed in #1990; paths and counts below describe the inspected revision, not the current UI.

Status: proposal  
Scope: classic web UI and visual web UI  
Measured catalogue: 405 models on 27 August 2026

## Purpose

Piclaw needs one model catalogue experience with two complementary surfaces:

- the **quick picker** switches the active model with minimal interruption;
- **Settings → Models** supports comparison, inspection, filtering and catalogue configuration.

Both surfaces must use the same normalised data, compatibility rules, search index, grouping and selection commands. They may present different amounts of detail.

## Evidence

The live `/agent/models` response for `web:default:branch:4165db5c5a0f` contained 405 models and was about 188 KB.

| Provider | Models |
|---|---:|
| OpenRouter | 360 |
| GitHub Copilot | 25 |
| Azure OpenAI | 7 |
| OpenAI Codex | 7 |
| Azure Foundry | 3 |
| Cerebras | 3 |

OpenRouter contained 88 OpenAI, 50 Qwen, 31 Google, 28 Anthropic and 17 Mistral entries. The catalogue also contained 60 `:batch`, 20 `:free`, 13 preview and 13 latest-alias variants.

The endpoint exposes useful metadata for every model:

- provider and model ID;
- display name;
- context window;
- reasoning support;
- model-specific thinking levels and labels;
- pricing for 369 models.

Browser measurements of the classic picker found:

- 405 rendered rows and 2,242 descendant DOM nodes;
- 213 context-blocked models;
- about seven visible rows;
- about 20,000 px of internal scroll height;
- 193 enabled tab stops;
- no search field or group headings;
- no `Home`, `End`, `PageUp` or `PageDown` navigation.

The visual picker has the same flat-list structure and gives every model `tabIndex=0`. The classic and visual Settings → Models sections also implement separate filtering, model selection and thinking-level behaviour.

## Product model

### Quick picker

The picker answers: **Which model should this chat use now?**

It must optimise for:

- search and rapid selection;
- current-context compatibility;
- recent and pinned models;
- a small amount of decision-critical metadata;
- keyboard and touch use;
- return to the compose flow after selection.

It must not become a 405-row specification table.

### Settings → Models

Settings answers: **Which models are available, how do they differ, and which ones should appear in normal use?**

It must support:

- catalogue inspection and comparison;
- detailed pricing and capability presentation;
- provider, publisher, family and variant filtering;
- enabled/scoped catalogue configuration;
- pinned/favourite model management;
- model-specific thinking-level inspection;
- switching the active model for the selected chat;
- diagnostics for provider/catalogue availability.

### Shared responsibilities

Both surfaces use the same:

- active chat identity;
- model catalogue data contract;
- model keys and labels;
- compatibility calculation;
- search tokens;
- provider/publisher/family/variant classification;
- recent and pinned state;
- selection command and error handling;
- active-model reconciliation after a switch.

## Shared catalogue model

Create a shared model catalogue module used by classic and visual code. It must normalise `/agent/models` into this conceptual shape:

```ts
interface ModelCatalogueEntry {
  key: string;                    // provider/model-id
  provider: string;               // access/billing route
  publisher: string | null;       // upstream publisher, if encoded
  family: string | null;          // Claude, Gemini, GPT, Qwen, etc.
  id: string;
  displayName: string;
  contextWindow: number | null;
  reasoning: boolean;
  thinkingLevels: Array<{ id: string; label: string }>;
  pricing: {
    inputPerMillion: number | null;
    outputPerMillion: number | null;
    cacheReadPerMillion: number | null;
    cacheWritePerMillion: number | null;
  } | null;
  variants: Array<'alias' | 'batch' | 'free' | 'preview' | 'fast' | 'image' | 'audio'>;
  contextFit: {
    state: 'fits' | 'blocked' | 'unknown';
    currentTokens: number | null;
    safetyAdjustedTokens: number | null;
    effectiveContextWindow: number | null;
  };
  current: boolean;
  pinned: boolean;
  lastUsedAt: string | null;
}
```

Classification may initially infer publisher, family and variants from IDs. Keep the inference in one module and test it. The server may later provide explicit fields without changing the UI contract.

### Identity rules

- `key = provider + '/' + id` is the selection identity.
- Display names never replace identity.
- Equivalent model IDs routed through different providers remain separate entries.
- Provider means the route used for authentication, quota and billing.
- Publisher means the upstream model owner where that distinction exists, chiefly inside OpenRouter.

### Compatibility rules

Use the existing context-fit calculation:

- reserve 4,000 tokens for application/tool overhead;
- apply the current 1.1 estimator safety multiplier;
- classify missing context data as `unknown`;
- do not silently hide blocked entries from Settings;
- collapse blocked entries by default in the quick picker.

The UI must present the concrete calculation. Example:

> Current context is 150K tokens, about 165K with estimator safety. This model safely fits about 124K. Compact before switching.

### Persisted user preferences

Store:

- pinned model keys;
- recent model keys and last-used timestamps;
- preferred picker sort;
- optional picker filters such as “compatible only”.

Pinning and recency are user-interface preferences. They must not alter the provider registry or `enabledModels` configuration.

## Quick picker specification

### Opening and focus

- Opening the picker focuses the search field.
- The current query is empty on a new opening unless the user closed and reopened the same picker without changing chats.
- `Escape` closes the picker and returns focus to the trigger.
- Selecting a model closes the picker and returns focus to compose.
- The picker uses the active chat JID for both fetch and switch operations.
- While data loads, keep the current-model row visible and show a loading state for the catalogue.

### Layout

Desktop/tablet:

- use a popover attached to the model trigger;
- width: 520–680 px where space allows;
- maximum height: the lesser of 70dvh and 640 px;
- sticky search/filter header;
- independently scrollable results;
- sticky footer for compact/settings actions only when needed.

Phone/coarse pointer:

- use a bottom sheet or near-full-screen dialog;
- width: viewport minus safe-area margins;
- height: 75–90dvh;
- sticky search/header;
- safe-area bottom padding;
- at least 44 px touch targets;
- no small nested 220 px scroller above compose.

### Search

Search must match normalised, case-insensitive tokens from:

- display name;
- full key and model ID;
- provider;
- publisher;
- family;
- variant labels;
- reasoning capability;
- formatted context window.

Behaviour:

- filter as the user types;
- show result count;
- preserve group structure in filtered results;
- highlight matched text when practical;
- show a clear button;
- show “No models match” with a link/action to clear filters;
- do not use pricing text as a primary fuzzy-search token unless the query has a recognised price/filter form.

### Quick filters

Provide compact filter chips or a filter menu:

- compatible with current context;
- pinned;
- reasoning;
- provider;
- variant: stable, free, batch, preview;
- context threshold where useful.

Default state:

- all compatible models visible;
- blocked group collapsed;
- no provider restriction;
- stable variants ranked ahead of preview/batch variants.

### Sections and grouping

Default sections:

1. Current
2. Pinned
3. Recent
4. Compatible models
5. Does not fit current context — collapsed, with count

Avoid duplicate rows across Current, Pinned and Recent. A model shown in an earlier priority section is omitted from later sections.

Within Compatible models:

- group by access provider;
- group OpenRouter by publisher inside the provider group;
- allow group collapse;
- show group counts, including compatible and total where useful.

Example:

```text
OpenRouter · 147 compatible
  Anthropic · 16
  Google · 19
  OpenAI · 42
  Qwen · 31
```

### Ranking

Default ranking within a group:

1. current;
2. pinned;
3. recently used;
4. stable aliases and current stable versions;
5. other stable versions, newest first where versions can be compared safely;
6. fast/free variants;
7. preview and batch variants;
8. alphabetical key as a deterministic tie-breaker.

Do not attempt semantic version ordering when the ID format is ambiguous. Use explicit variant classification and a stable natural sort.

Optional sort modes:

- Recommended;
- Name;
- Context window;
- Input price;
- Output price.

### Row content

Each row shows:

- display name as the primary label;
- provider/model key as secondary text;
- context window aligned consistently;
- up to three concise capability/variant badges;
- current/pinned state;
- blocked status with a visible reason.

Example:

```text
Claude Sonnet 5                                      1M ctx
GitHub Copilot · claude-sonnet-5          Reasoning · Pinned
```

Pricing in the quick picker uses a compact tier or one relevant metric. Do not repeat four exact rates on every row. Exact pricing belongs in Settings or an optional row detail affordance.

### Footer actions

Replace the current “Next model” primary footer action with:

- **Open Models settings**;
- **Compact context**, shown when blocked results are relevant;
- optional “Clear filters”.

Cycling through 405 models is retained only as a keyboard/command feature if users still need it.

### Keyboard and accessibility

Use a single-select listbox or combobox/listbox pattern.

- search field owns text input;
- results use one tab stop with roving focus or `aria-activedescendant`;
- `aria-selected` marks the active option;
- `aria-disabled` marks blocked options;
- disabled reasons are visible and associated with `aria-describedby`;
- `ArrowUp`/`ArrowDown`: previous/next selectable row;
- `Home`/`End`: first/last selectable result;
- `PageUp`/`PageDown`: move by one visible page;
- `Left`/`Right`: collapse/expand a focused group where applicable;
- `Enter`: select;
- `Escape`: close;
- `Tab`: normal focus traversal; it must not select a model;
- focus returns to the trigger/compose after close or selection.

Avoid `menu/menuitem` and `div role="button"` for model choice.

### Rendering performance

- Render only expanded groups.
- Window/virtualise rows when a result set exceeds 100 entries.
- Keep the current/active option addressable even if its group is virtualised or collapsed.
- Search and grouping must be computed from a memoised catalogue index.
- Opening the picker must not create thousands of focusable or descendant elements.

## Settings → Models specification

### Layout

Use a master-detail catalogue:

- left/top: search, filters, saved views and model list/table;
- right/bottom: details for the selected model;
- responsive collapse to a list followed by a detail drawer/sheet on narrow screens.

The settings surface may show a denser table than the picker, but must still group or virtualise 405 rows.

### Catalogue controls

Provide:

- search across the same shared index;
- provider and publisher filters;
- family filter;
- context-fit filter;
- reasoning filter;
- stable/free/batch/preview variant filters;
- context-window range;
- price range or sortable price columns;
- sort selection;
- visible result count;
- “Reset filters”.

The scoped-model control belongs here. Clarify its effect:

> Restrict the model catalogue and picker to entries matched by `enabledModels`.

Show the active patterns and matched model count. Link to the relevant configuration or provide a safe editor if one already exists.

### List/table columns

Default columns:

- pin;
- model name;
- access provider;
- publisher/family;
- context;
- reasoning;
- input price;
- output price;
- variant/status.

Allow column visibility and horizontal scrolling on smaller desktop widths. Keep the model name/provider columns sticky if practical.

Rows must not each become a tab stop. Use table/grid keyboard patterns or a single listbox with a detail pane.

### Model detail pane

Show the information omitted from the quick picker:

- full provider/model key;
- display name;
- access provider;
- publisher and family;
- context window and current-context fit calculation;
- reasoning support;
- supported thinking levels using server-provided IDs and labels;
- exact input, output, cache-read and cache-write prices per million tokens;
- variant classification;
- provider rate limits when the backend exposes them;
- active-provider quota/usage where applicable;
- current, pinned and last-used state;
- catalogue source/diagnostics when available.

Actions:

- Use for current chat;
- Pin/unpin;
- Compact then switch when blocked;
- Copy model key;
- open provider settings or diagnostics where relevant.

### Thinking-level control

Thinking level is model-specific and chat-specific.

- Populate controls from the selected/current model's `thinking_levels` and `thinking_level_labels`.
- Do not hard-code `off`, `minimal`, `low`, `medium`, `high` in the visual Settings panel.
- Distinguish inspecting another model from changing the active model's thinking level.
- Disable the thinking control when the selected model is not active, or label an atomic “switch model and set thinking” action.
- Reconcile state from `/agent/models?chat_jid=...` after every command.

### Chat affinity

Both Settings implementations must:

- resolve the active chat JID;
- include it when fetching `/agent/models`;
- send model/thinking commands to the same chat;
- update if the active chat changes while Settings remains open;
- show which chat is being configured.

The classic implementation already has `resolveModelsSettingsChatJid()`. The visual implementation must gain equivalent behaviour.

### Provider diagnostics

Use existing `provider_diagnostics` and provider usage fields where useful:

- configured/authenticated state;
- available model count;
- catalogue refresh error or stale state;
- provider usage/quota summary.

Do not mix provider credential editing into the model list. Link to Settings → Providers.

## Shared command and state flow

### Fetch

1. Resolve active chat JID.
2. Fetch `/agent/models?chat_jid=<jid>`.
3. Normalise into the shared catalogue.
4. Merge pinned/recent UI preferences.
5. Compute context fit from the active chat context.
6. Render picker/settings projections from the same catalogue state.

### Select

1. Reject blocked selection locally with the fit explanation and Compact action.
2. Send the model command to the active chat.
3. Show a pending state on the selected row and trigger.
4. Re-fetch `/agent/models?chat_jid=<jid>` after success.
5. Use the server's `current` value as final authority.
6. On failure, keep the previous model and display the server error.
7. Record recency only after server confirmation.

Do not optimistically claim success without reconciliation.

### Cross-surface synchronisation

A model change from picker, Settings, slash command or another client must update:

- model badge;
- picker current row;
- Settings current row/detail;
- model-specific thinking controls;
- context-fit calculations.

Use existing model-state/SSE events where available and re-fetch on uncertain transitions.

## Compatibility and migration

### Older payloads

The shared normaliser must support:

- structured `model_options`;
- legacy string `models`;
- missing names, pricing, context or thinking-level fields.

Unknown metadata renders as “Unknown” or is omitted. Missing metadata must not block selection unless context safety requires it.

### Existing preferences

- Keep `scopedModelsOnly` and `enabledModels` semantics unchanged.
- Add pin/recent preferences without changing registry scope.
- Retain `/model`, `/thinking` and `/cycle-model` commands.
- Keep context-fit safety rules unchanged unless separately reviewed.

### Classic and visual rollout

Build shared pure catalogue functions first. Then migrate:

1. classic picker;
2. classic Settings → Models;
3. visual picker;
4. visual Settings → Models.

Do not leave the two surfaces with different classification, context-fit or chat-affinity behaviour. A temporary presentation difference is acceptable while each stage lands.

## Implementation structure

Suggested modules:

```text
runtime/web/src/ui/model-catalogue.ts
runtime/web/src/ui/model-catalogue-search.ts
runtime/web/src/ui/model-catalogue-preferences.ts
runtime/web/src/components/model-picker/*
runtime/web/src/components/settings/models.ts
runtime/web/static/visual/frontend/src/components/model-context-bar/*
runtime/web/static/visual/frontend/src/panels/settings/ModelsSection.tsx
```

If classic and visual builds cannot import the same component, share pure TypeScript catalogue logic through a build-safe module and keep thin surface-specific renderers.

Shared functions should include:

- `normaliseModelCatalogue(payload)`;
- `classifyModelIdentity(entry)`;
- `classifyModelVariants(entry)`;
- `calculateModelContextFit(entry, contextUsage)`;
- `buildModelSearchDocument(entry)`;
- `filterAndRankModels(entries, state)`;
- `groupModels(entries, state)`.

## Acceptance criteria

### Shared catalogue

- [ ] Classic and visual surfaces use the same normalisation, classification, compatibility, search and ranking rules.
- [ ] Structured and legacy model payloads remain supported.
- [ ] Provider, publisher, family and variant classifications have deterministic tests.
- [ ] Equivalent model IDs through different access providers remain distinct.

### Quick picker

- [ ] A visible search field receives focus on open.
- [ ] Search matches model name, ID, provider, publisher and family.
- [ ] Current, pinned, recent, compatible and blocked sections are implemented.
- [ ] OpenRouter entries are subgrouped by publisher.
- [ ] Blocked models are collapsed by default and have a concrete explanation.
- [ ] Exact pricing is removed from default rows or moved behind detail disclosure.
- [ ] `Home`, `End`, `PageUp`, `PageDown`, arrows, `Enter`, `Escape` and `Tab` follow the specified behaviour.
- [ ] The picker uses listbox/combobox semantics and has at most a small fixed number of tab stops.
- [ ] Mobile uses a bottom sheet/large dialog with safe-area handling and 44 px targets.
- [ ] Large result sets are virtualised or otherwise bounded in rendered DOM size.
- [ ] “Open Models settings” replaces “Next model” as the primary footer action.

### Settings → Models

- [ ] Settings has shared search and filters plus provider/publisher/family grouping.
- [ ] A master-detail view presents full pricing, context, reasoning, thinking levels, variants and diagnostics.
- [ ] Users can pin/unpin models and use a model for the active chat.
- [ ] Scoped catalogue behaviour and matched counts are explained.
- [ ] Thinking levels come from the selected model's server-provided values.
- [ ] Fetches and commands use the active chat JID in both classic and visual UIs.
- [ ] The 405-model catalogue remains responsive and keyboard-usable.

### State and failure handling

- [ ] Model selection is confirmed against the server before recency is recorded.
- [ ] Switching failures restore prior state and show the server error.
- [ ] Changes from commands/SSE/other clients update picker and Settings.
- [ ] Catalogue loading, timeout, stale and empty states are explicit.

### Tests

- [ ] Pure catalogue tests cover 400+ synthetic entries, variants, duplicates and missing metadata.
- [ ] Keyboard tests cover all specified keys and skip disabled options.
- [ ] Accessibility tests cover roles, selected/disabled state, labels and focus restoration.
- [ ] Responsive tests cover desktop, tablet and phone layouts.
- [ ] Playwright tests use a 405-model fixture and verify search, grouping, selection, blocked-state handling and Settings detail.
- [ ] Rendered DOM remains bounded when the catalogue contains 405 models.
- [ ] Existing model switching, context-fit and chat-affinity tests continue to pass.

## Delivery plan

### Phase 1 — Shared catalogue and quick picker

- extract shared normalisation/classification/search/ranking;
- add visible search and compatibility grouping;
- implement listbox keyboard behaviour;
- replace dense row pricing;
- add mobile sheet and bounded rendering;
- migrate classic and visual pickers.

### Phase 2 — Settings catalogue and details

- build shared filter state and master-detail layout;
- add detailed pricing/capabilities/diagnostics;
- add pinned-model management;
- fix visual chat affinity and model-specific thinking levels;
- migrate classic and visual Settings sections.

### Phase 3 — Recency, ranking and polish

- persist recents and pins;
- tune Recommended ranking with real usage;
- add optional column/sort preferences;
- measure picker open latency, search latency and selection completion.

## Success measures

For a 405-model catalogue:

- search field ready within 100 ms after opening from cached data;
- search updates within 50 ms on a typical supported device;
- no more than 100 model rows rendered at once, with a lower target under virtualisation;
- at most five tab stops in the picker before the result list owns roving focus;
- any known model reachable by search and keyboard selection in fewer than six actions;
- current, pinned and recent models reachable without scrolling;
- blocked-selection explanation visible without relying on a title tooltip;
- desktop and phone Playwright flows pass against the same fixture.

## Non-goals

- changing provider authentication or credential storage;
- changing model registry discovery;
- recommending a model using opaque server-side scoring in the first release;
- merging equivalent models across providers into one selectable identity;
- changing context safety margins;
- replacing `/model`, `/thinking` or `list_models` command/tool contracts.
