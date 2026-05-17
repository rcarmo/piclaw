# Visual UI Mode

PiClaw ships with two web UI modes:

- **classic** (default) — the original htm/preact UI
- **visual** — a Preact SPA with a VS Code-inspired layout

## Switching modes

Set the environment variable before starting:

```bash
PICLAW_WEB_UI_MODE=visual
```

Or in your Dockerfile:
```dockerfile
ENV PICLAW_WEB_UI_MODE=visual
```

## Building from source

```bash
bun run build:web:visual
```

This builds the Preact frontend from `runtime/web/frontend/` into `runtime/web/static/visual/dist/`.

## Architecture

```
runtime/web/
├── frontend/          # Visual UI source (Preact/TypeScript)
│   ├── build.ts       # Bun bundler entry
│   └── src/
│       ├── App.tsx
│       ├── components/ # Shared UI components
│       ├── hooks/      # Custom hooks
│       ├── panels/     # Panel components (settings, workspace, etc.)
│       ├── api/        # API layer
│       └── utils/      # Shared utilities
├── static/
│   ├── classic/       # Classic UI (unchanged)
│   ├── visual/        # Visual UI built output
│   │   ├── index.html
│   │   ├── css/       # Stylesheets
│   │   └── dist/      # JS bundles + assets
│   └── common/        # Shared assets (fonts, vendor libs)
└── src/               # Classic UI source (unchanged)
```

The visual UI is fully self-contained — it does not import from or modify `runtime/web/src/` (classic source).

## Key features

- Dark-themed Preact SPA with VS Code-inspired layout
- Activity bar, command palette, settings panels
- Agent status panels (thought, draft, output, tools) with shared components
- 17 bundled VS Code themes + custom theme import
- Unified overlay system (OverlayShell) with focus trap, scroll lock, z-index tiers
- Context window safety margins in model picker
- TOTP + passkey authentication settings
