# Plannotator — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-05-25-plannotator-design.md`  
**Branch:** `feature/plannotator`  
**Created:** 2026-05-25  

---

## Checkpoints

| Phase | SHA | Date | Status |
|---|---|---|---|
| Phase 1 — Types & State | | | pending |
| Phase 2 — Painel Lateral | | | pending |
| Phase 3 — Tab Completa | | | pending |
| Phase 4 — Triggers | | | pending |
| Phase 5 — Estilos | | | pending |

---

## Phase 1 — Tipos, Estado e Orquestração

### Tasks

- [ ] **1.1** Criar `runtime/web/src/ui/plannotator-types.ts` com os tipos `PlannotatorContentType`, `PlannotatorSession`, `PlannotatorAnnotation`, `PlannotatorSuggestion`
- [ ] **1.2** Adicionar `plannotatorSession` / `setPlannotatorSession` ao `useMainAppSurfaceState` em `app-main-surface-state.ts`
- [ ] **1.3** Criar `runtime/web/src/ui/use-plannotator-orchestration.ts` com `openPlannotator`, `closePlannotator`, `approvePlannotator`, `rejectPlannotator`
- [ ] **1.4** Ligar orquestração ao shell: adicionar props de Plannotator ao `app-main-shell-render.ts` (imports + passagem de props, sem ainda renderizar o componente)

**Verificação:** `bun run typecheck` sem erros novos.

---

## Phase 2 — Painel Lateral

### Tasks

- [ ] **2.1** Criar `runtime/web/src/components/plannotator-panel.ts` — componente Preact seguindo padrão de `btw-panel.ts`:
  - Cabeçalho: título "Plannotator", botão "⤢ Tab", botão "✕"
  - Corpo: conteúdo com diff rendering básico (linhas `+`/`-` coloridas) ou texto plain
  - Rodapé fixo: "✓ Aprovar" (verde) e "✕ Rejeitar" (vermelho)
  - Rejeitar: expande textarea inline para comentário antes de confirmar
- [ ] **2.2** Renderizar `PlannotatorPanel` no shell em `app-main-shell-render.ts` logo após `BtwPanel`
- [ ] **2.3** Rotear SSE `plannotator_review_request` em `app-sse-events.ts` → `openPlannotator(session)`
- [ ] **2.4** Ligar botão "⤢ Tab" → `openEditor('piclaw://plannotator', { label: 'Plannotator', transferState: session })`

**Verificação:** `bun run typecheck` + abrir manualmente via `openPlannotator` no console.

---

## Phase 3 — Tab Completa (Pane)

### Tasks

- [ ] **3.1** Criar `runtime/web/src/panes/plannotator-pane.ts` — `WebPaneExtension` com:
  - `id: 'plannotator'`, `canHandle` só para `piclaw://plannotator`
  - Layout dois painéis: diff/conteúdo (esquerda, 65%) + anotações + sugestões + botões (direita, 35%)
  - Recebe `context.transferState` como `PlannotatorSession`
- [ ] **3.2** Implementar anotações inline na tab completa:
  - Para `diff`: click em linha → input de anotação inline acima da linha
  - Para `plan`/`message`/`file`: seleccionar texto → tooltip "Anotar" / "Sugerir alteração"
- [ ] **3.3** Implementar sugestões de alteração:
  - Seleccionar texto → "Sugerir alteração" → editor two-line (original / replacement)
  - Lista de sugestões no painel direito com diff inline
- [ ] **3.4** Registar pane em `runtime/web/src/panes/index.ts` e no bootstrap

**Verificação:** `bun run typecheck` + abrir tab via botão "⤢ Tab" no painel lateral.

---

## Phase 4 — Triggers

### Tasks

- [ ] **4.1** Slash commands `/plannotate` e `/review` em `compose-box.ts`:
  - Adicionar entradas ao array `SLASH_COMMANDS`
  - Intercept: buscar última mensagem do agente com `plan: true` ou bloco de código ≥ 3 linhas
  - Se não existir, abrir painel com "Nenhum plano disponível nesta sessão"
- [ ] **4.2** Botão "Review →" em `post.ts`:
  - Condição de visibilidade: `role === 'agent'` E (`post.plan === true` OU conteúdo tem bloco de código ≥ 3 linhas)
  - Botão no rodapé de ações, segue padrão `post-action-btn`
  - Ao clicar → `onPlannotate?.(post)` propagado via prop até ao shell
- [ ] **4.3** Context menu no workspace explorer em `workspace-explorer.ts`:
  - Opção "Review" em ficheiros de texto (`.ts`, `.js`, `.py`, `.md`, `.json`, etc.)
  - Lê conteúdo via `getWorkspaceFile(path)` → `openPlannotator({ contentType: 'file', ... })`

**Verificação:** `bun run typecheck` + testar cada trigger manualmente.

---

## Phase 5 — Estilos

### Tasks

- [ ] **5.1** Adicionar estilos do painel lateral em `runtime/web/static/css/overlays.css`:
  - `.plannotator-panel` — coluna direita 300px, slide-in animation, z-index adequado
  - `.plannotator-panel-header`, `.plannotator-panel-title`, `.plannotator-panel-close`
  - `.plannotator-panel-body` — scroll, padding
  - `.plannotator-panel-footer` — sticky bottom, flex row com gap
  - `.plannotator-btn`, `.plannotator-btn-approve` (verde), `.plannotator-btn-reject` (vermelho)
  - `.plannotator-reject-comment` — textarea expansível inline
  - `.plannotator-diff-line`, `.plannotator-diff-add` (verde), `.plannotator-diff-remove` (vermelho)
- [ ] **5.2** Adicionar estilos da tab completa em `runtime/web/static/css/styles.css`:
  - `.plannotator-pane` — flex row, height 100%
  - `.plannotator-pane-content` — 65%, overflow auto, padding
  - `.plannotator-pane-sidebar` — 35%, border-left, flex column
  - `.plannotator-annotation-list`, `.plannotator-annotation-item`
  - `.plannotator-suggestion-item` — diff two-line display
  - `.plannotator-inline-annotation-input` — input inline sobre linha
  - `.plannotator-selection-tooltip` — tooltip "Anotar / Sugerir alteração"
- [ ] **5.3** Verificar temas: testar com `xterm`, `github` (light) e `dracula` — ajustar CSS variables se necessário

**Verificação:** `bun run build:web` sem erros + inspecção visual nos 3 temas.

---

## Fase Final — CI

- [ ] **F.1** `make ci-fast` verde
- [ ] **F.2** Criar PR com descrição completa
