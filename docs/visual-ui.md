# Visual UI Mode

PiClaw ships with two web UI modes:

- **classic** (default) — the original htm/preact UI
- **visual** — a Preact SPA with a VS Code-inspired layout

## Switching modes

```bash
PICLAW_WEB_UI_MODE=visual
```

## Building from source

```bash
bun run build:web:visual
```

## Architecture

```
runtime/web/
├── frontend/          # Visual UI source (Preact/TypeScript)
│   ├── build.ts       # Bun bundler entry
│   └── src/           # App, components, hooks, panels, utils
├── static/
│   ├── classic/       # Classic UI (unchanged)
│   ├── visual/        # Visual UI built output
│   │   ├── index.html
│   │   ├── css/
│   │   └── dist/
│   └── common/        # Shared assets (fonts, vendor libs) — unchanged
└── src/               # Classic UI source (unchanged)
```

The visual UI is fully self-contained — it does not import from or modify classic source.
