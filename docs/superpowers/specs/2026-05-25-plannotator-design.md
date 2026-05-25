# Plannotator — Design Spec

**Date:** 2026-05-25  
**Status:** Approved  

---

## Overview

Plannotator é uma funcionalidade de review de conteúdo gerado pelo agente (planos, código, mensagens, ficheiros). Existe em dois modos:

1. **Painel lateral** — overlay rápido ao lado da timeline com Aprovar / Rejeitar
2. **Tab completa** — pane dedicado com diff, anotações inline e sugestões de edição

A decisão do reviewer é enviada ao agente como mensagem de chat, permitindo-lhe continuar ou corrigir o rumo.

---

## Casos de uso

| Trigger | Conteúdo | Modo inicial |
|---|---|---|
| `/plannotate` ou `/review` | Último plano gerado pelo agente | Painel lateral |
| Agente gera plano (SSE `plannotator_review_request`) | Plano estruturado | Painel lateral automático |
| Botão "Review →" numa mensagem da timeline | Conteúdo da mensagem | Painel lateral |
| Context menu no workspace explorer | Conteúdo do ficheiro | Painel lateral |
| Agente termina de gerar código (SSE `plannotator_review_request` com diff) | Diff de ficheiros | Painel lateral |

---

## Arquitectura

### Componentes novos

#### `PlannotatorPanel` (Preact component)
- Renderizado condicionalmente no shell, ao lado da timeline, quando `plannotatorSession !== null`
- Padrão idêntico ao `BtwPanel` existente
- Estado gerido em `usePlannotatorOrchestration` (novo hook no `ui/`)
- Conteúdo: título, corpo (plano / diff / mensagem / ficheiro em texto), dois botões
- Botão "⤢ Tab" → transfere estado e abre `PlannotatorPane` via `openEditor('piclaw://plannotator')`
- Botão "✕" → fecha painel, sem enviar mensagem ao agente

#### `PlannotatorPane` (WebPaneExtension)
- ID: `plannotator`
- Path virtual: `piclaw://plannotator`
- Placement: `tabs`
- `canHandle(context)`: `context.path === 'piclaw://plannotator' ? 100 : false`
- Layout dois painéis:
  - **Esquerda** — conteúdo com diff rendering (linhas `+`/`-`) ou texto plain
  - **Direita** — lista de anotações, lista de sugestões, botões Aprovar/Rejeitar
- Recebe estado via `context.transferState` (conteúdo, tipo, origem)

#### `usePlannotatorOrchestration` (hook)
- Gere `plannotatorSession` (null | `PlannotatorSession`)
- Expõe: `openPlannotator(session)`, `closePlannotator()`, `approvePlannotator(comments)`, `rejectPlannotator(comments)`
- `approvePlannotator` → `sendAgentMessage("✓ Aprovado" + comentários opcionais)`
- `rejectPlannotator` → `sendAgentMessage("✕ Rejeitado\n\n" + comentários serializados)`

### Tipos

```typescript
type PlannotatorContentType = 'plan' | 'diff' | 'message' | 'file';

interface PlannotatorSession {
  id: string;                        // único por invocação
  title: string;                     // ex: "Plano do agente", "Diff — auth.ts"
  contentType: PlannotatorContentType;
  content: string;                   // texto do plano / diff / mensagem / ficheiro
  sourceMessageId?: string;          // mensagem de origem (se aplicável)
  sourcePath?: string;               // path do ficheiro (se aplicável)
  annotations: PlannotatorAnnotation[];
  suggestions: PlannotatorSuggestion[];
}

interface PlannotatorAnnotation {
  id: string;
  lineNumber?: number;               // para diff/ficheiro
  text: string;
  createdAt: number;
}

interface PlannotatorSuggestion {
  id: string;
  originalText: string;
  replacementText: string;
  lineNumber?: number;
}
```

---

## Integração nos triggers

### SSE — `plannotator_review_request`
Novo tipo de evento SSE enviado pelo backend quando o agente quer solicitar review:
```json
{
  "type": "plannotator_review_request",
  "title": "Plano do agente",
  "contentType": "plan",
  "content": "1. Criar auth.ts\n2. ...",
  "sourceMessageId": "msg_123"
}
```
Roteado em `app-sse-event-routing.ts` → `openPlannotator(session)`.

### Slash commands
`/plannotate` e `/review` intercetados em `compose-box.ts` → invocam `openPlannotator` com o conteúdo do último plano. "Último plano" é definido como a mensagem mais recente do agente na sessão activa que tenha `plan: true` ou que contenha um bloco de código de ≥ 3 linhas. Se não existir nenhuma, o painel abre com uma nota informativa "Nenhum plano disponível nesta sessão".

### Botão na timeline (`Post`)
O botão "Review →" aparece no rodapé de ações de uma mensagem quando **qualquer** das seguintes condições for verdadeira:
- A mensagem foi enviada pelo agente (`role === 'agent'`) e o seu `content` contém um bloco de código de 3 ou mais linhas (regex `/```[\s\S]{30,}/`)
- A mensagem tem `contentType: 'plan'` no payload SSE que a gerou (campo `plan: true` na mensagem persistida)
- A mensagem foi originada por um evento SSE `plannotator_review_request`

Ao clicar → `openPlannotator({ contentType: post.plan ? 'plan' : 'message', content: post.content, sourceMessageId: post.id })`.

### Workspace Explorer
Context menu adiciona opção "Review" em ficheiros de texto → `openPlannotator({ contentType: 'file', content: fileContent, sourcePath: path })`.

---

## Modo Painel Lateral — comportamento detalhado

- Aparece como coluna direita com `width: 300px`, animação slide-in
- Cabeçalho: ícone 📝, título, botão "⤢ Tab", botão "✕"
- Corpo: scroll, conteúdo renderizado como texto com syntax highlight básico para diffs
- Rodapé fixo: botão "✓ Aprovar" (verde) e "✕ Rejeitar" (vermelho)
- Rejeitar sem comentários: abre textarea inline para comentário antes de confirmar
- Não bloqueia o chat — o utilizador pode continuar a ler a timeline

---

## Modo Tab Completa — comportamento detalhado

- Recebe `PlannotatorSession` via `context.transferState`. O mecanismo `transferState` é o mesmo usado pelos panes de terminal e VNC — é populado em `openEditor('piclaw://plannotator', { transferState: session })` e disponível em `context.transferState` dentro de `mount()`.
- Painel esquerdo (2/3 da largura):
  - Para `diff`: rendering linha a linha com `+`/`-` coloridos; click em linha abre input de anotação inline
  - Para `plan`/`message`/`file`: texto com paragraphs seleccionáveis; seleccionar texto → tooltip "Anotar" / "Sugerir alteração"
- Painel direito (1/3):
  - Secção "Anotações" — lista de `PlannotatorAnnotation`; click vai para linha
  - Secção "Sugestões" — lista de `PlannotatorSuggestion` com diff inline
  - Botões "✓ Aprovar" / "✕ Rejeitar" no rodapé
- Aprovar na tab → serializa anotações + sugestões na mensagem de aprovação se existirem
- Rejeitar na tab → serializa todos os comentários e sugestões na mensagem de rejeição

---

## Feedback ao agente — formato das mensagens

**Aprovação simples:**
```
✓ Aprovado
```

**Aprovação com notas:**
```
✓ Aprovado

Notas:
- linha 4: Falta validação de erro se SECRET não definido
- Sugestão em signToken: adicionar try/catch
```

**Rejeição:**
```
✕ Rejeitado

Motivo: [comentário livre]

Anotações:
- linha 4: Falta validação de erro se SECRET não definido

Sugestões de alteração:
- linha 6: `return jwt.verify(t, process.env.SECRET)` → `return jwt.verify(t, process.env.SECRET ?? throwMissingSecret())`
```

---

## Ficheiros a criar / modificar

### Novos
| Ficheiro | Descrição |
|---|---|
| `runtime/web/src/components/plannotator-panel.ts` | Componente Preact do painel lateral |
| `runtime/web/src/panes/plannotator-pane.ts` | WebPaneExtension para a tab completa |
| `runtime/web/src/ui/use-plannotator-orchestration.ts` | Hook de estado e lógica |
| `runtime/web/src/ui/plannotator-types.ts` | Tipos partilhados |

### Modificados
| Ficheiro | Alteração |
|---|---|
| `runtime/web/src/ui/app-main-shell-render.ts` | Renderizar `PlannotatorPanel` condicionalmente |
| `runtime/web/src/ui/use-main-app-surface-state.ts` | Adicionar `plannotatorSession` ao estado global |
| `runtime/web/src/ui/app-sse-event-routing.ts` | Rotear `plannotator_review_request` |
| `runtime/web/src/components/post.ts` | Botão "Review →" em mensagens relevantes |
| `runtime/web/src/components/compose-box.ts` | Slash commands `/plannotate` e `/review` |
| `runtime/web/src/components/workspace-explorer.ts` | Context menu "Review" |
| `runtime/web/src/panes/index.ts` | Registar `plannotatorPane` |
| `runtime/web/static/css/overlays.css` | Estilos do painel lateral |
| `runtime/web/static/css/styles.css` | Estilos da tab completa |

---

## Fora de âmbito (v1)

- Persistência de anotações em SQLite
- Histórico de reviews passadas
- Review colaborativo multi-utilizador
- Export de relatório de review
- Integração com o sistema de tasks/scheduled
