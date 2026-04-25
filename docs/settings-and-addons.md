# Settings Dialog & Extension System

> Added in 2.0.0

The settings dialog provides a centralized UI for configuring piclaw — identity, providers, models, appearance, tools, editor, and add-ons. Extensions can register their own settings panes.

## Opening Settings

| Method | Context |
|---|---|
| `/settings` slash command | Type in the compose box |
| Hamburger menu → Settings | Available in both workspace and chat views |

The hamburger menu button uses `position: fixed` and appears:
- **Top-right** of the chat area when workspace is collapsed
- **Top-left** of the workspace header when workspace is open

## Built-in Settings Panes

### General (order 10)
- **User name** and **avatar** (URL or file upload with preview)
- **Agent name** (auto-saves with 600ms debounce via `/agent-name`)
- **Agent avatar** (URL or file upload with preview)
- **Session auto-rotate** toggle
- **Max session size** (MB)
- **Web terminal** toggle

### Providers (order 20)
- Lists all supported AI providers with auth state from `~/.pi/agent/auth.json`
- Green left border for configured providers; auth type badge (oauth/api_key)
- Capability badges: OAuth, API Key, Custom
- **Set up** button triggers `/login <provider>` card flow in chat
- **Logout** / **Reconfigure** for configured providers
- Supported: Anthropic, GitHub Copilot, Google Gemini CLI, Antigravity, OpenAI Codex, OpenAI, OpenCode, Azure OpenAI, Ollama, OpenAI-compatible

### Models (order 30)
- Searchable model table (filter in title bar) with radio buttons
- Model switching via `/model <label>`
- Columns: Model, Provider, Context window, Reasoning (🧠)
- **Thinking level slider** pinned to bottom footer:
  - Snapping slider with model-specific available levels
  - Non-reasoning models: "does not support thinking"
  - 5-stop scale (off→high) or 6-stop (off→xhigh/max)
  - Effort providers (Anthropic) display "max" for xhigh
  - Updates available levels when switching models

### Appearance (order 40)
- **Default theme** card at top with native color picker for tint
  - Tint applies immediately; clear button to reset
- **Theme table** with radio buttons and color swatches
  - Borderless table, centered swatch cells
  - Themes apply immediately via client-side `applyThemeFromEvent()`
  - 15 themes: Default, Tango, XTerm, Monokai, Monokai Pro, Ristretto, Dracula, Catppuccin, Nord, Gruvbox, Solarized, Tokyo, Miasma, GitHub, Gotham

### Editor (order 150) — Extension pane
- **Vim mode** toggle (`piclaw_vim_mode`)
- **Show whitespace** toggle (`piclaw_show_whitespace`)
- **Markdown live preview** toggle (`piclaw_md_live_preview`)
- **Font size** in pixels (`piclaw_editor_font_size`)
- **Font family** override (`piclaw_editor_font_family`)
- All stored in `localStorage`, matching CodeMirror editor extension keys

### Tools (order 80)
- Searchable (filter in title bar)
- Grouped by toolset with SVG icons from tool-status-hints vocabulary
- Group checkboxes collapse/expand tool lists
- Per-tool: name, kind badge (🔍 read-only / ✏️ mutating / 🔄 mixed), summary, source label
- 12 toolsets: core, discovery, attachments, model-control, data, workspace, automation, remote, browser, ui, experiments, lifecycle

### Add-ons (order 90)
- Searchable (filter in title bar)
- Card layout with left accent border for installed add-ons
- Shows version, description, tags, bundled skills
- **Install** / **Upgrade** / **Remove** buttons with spinner progress in status bar
- Fetches catalog from `rcarmo/piclaw-addons` (5-minute cache)
- Package-first install flow: prefers `bun add <package-spec>` and falls back to direct package download only for legacy/unpublished entries

## Extension Settings Pane API

Extensions can register custom settings panes that appear in the dialog nav:

```typescript
// In your extension module (client-side):
import { registerSettingsPane } from './settings/pane-registry.js';
import { html, useState } from '../vendor/preact-htm.js';

function MySettingsPane({ filter }) {
    // filter prop passed from the title bar search (if searchable: true)
    return html`<div class="settings-section"><h3>My Extension</h3>...</div>`;
}

registerSettingsPane({
    id: 'my-extension',
    label: 'My Extension',
    icon: html`<svg viewBox="0 0 24 24" width="16" height="16" .../>`,
    component: MySettingsPane,
    order: 200,           // built-in panes use 10-90
    searchable: false,    // show filter input in title bar?
    searchPlaceholder: 'Filter...',
});
```

### SettingsPaneDefinition

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique identifier |
| `label` | string | yes | Nav label |
| `icon` | VNode | yes | SVG icon (preact html template) |
| `component` | Component | yes | Preact component `(props: { filter?: string }) => VNode` |
| `order` | number | no | Sort order (default 500; built-in 10-90) |
| `searchable` | boolean | no | Show filter in title bar |
| `searchPlaceholder` | string | no | Filter placeholder text |

Panes self-register on import. The dialog discovers them via `getRegisteredSettingsPanes()` and merges them with built-in panes sorted by order.

## Add-on Management

### Backend Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/agent/addons` | GET | Fetch catalog + installed state |
| `/agent/addons/install` | POST | Install addon by slug |
| `/agent/addons/uninstall` | POST | Uninstall addon by slug |
| `/agent/settings-data` | GET | Full settings data (identity, providers, themes, toolsets) |

### Install Flow

1. Backend fetches `catalog.json`
2. Resolves the add-on's package install spec from the catalog (`install.spec`)
3. Runs `bun add --force <spec>` in `.pi/addons/`
4. Checks installed version from `.pi/addons/node_modules/<name>/package.json`
5. Returns success message; restart required to load the extension
6. If package install is unavailable or fails for a legacy/unpublished entry, backend falls back to direct package-directory download from GitHub and runs `bun install` inside that add-on directory

### Add-on Manifest Format

Add-ons use a dual manifest pattern compatible with both piclaw and the broader agentskills.io ecosystem:

```json
{
  "name": "piclaw-addon-example",
  "version": "0.1.0",
  "type": "module",
  "main": "index.ts",
  "piclaw": {
    "type": "extension",
    "compatibleVersions": ">=1.8.0",
    "tags": ["category"],
    "skills": ["skills/my-skill"]
  },
  "agents": {
    "skills": [
      { "name": "my-skill", "path": "./skills/my-skill" }
    ]
  }
}
```

- **`piclaw`** field: extension type, compatible versions, tags, skill paths
- **`agents`** field: [agentskills.io](https://agentskills.io) compatible, discovered by `npx skills` and 45+ coding agents

### Catalog

Machine-readable catalog at `rcarmo/piclaw-addons/catalog.json` (v2):

```json
{
  "version": 2,
  "source": "github:rcarmo/piclaw-addons",
  "addons": [
    {
      "slug": "autoresearch",
      "name": "piclaw-addon-autoresearch",
      "version": "0.1.0",
      "type": "extension",
      "description": "...",
      "path": "addons/autoresearch",
      "tags": ["experiments"],
      "skills": ["autoresearch-create"],
      "install": {
        "kind": "npm",
        "spec": "piclaw-addon-autoresearch@0.1.0",
        "piSource": "npm:piclaw-addon-autoresearch@0.1.0"
      }
    }
  ]
}
```

## Turn Outcome Rendering

Turn failures now display as collapsible pills instead of markdown tables:

- **Post content**: only the draft text (or minimal fallback)
- **Outcome pill**: below the post, shows last action summary
  - Disclosure triangle expands to show title + detail
  - Severity-colored border (warning/error/critical/info)
  - "draft recovered" badge when applicable
- Small chip in metadata row for quick scan

## Status Bar

The settings dialog has a global status bar pinned to the bottom:

- **Info** (blue): spinner animation during operations
- **Success** (green): operation completed
- **Error** (red): operation failed
- Dismiss button for success/error states

## Responsive Layout

- **Phone portrait** (`<640px`): full-screen dialog, horizontal icon-only nav strip, stacked forms
- **Extra compact** (`<480px`): swatch columns and bundled column hidden
