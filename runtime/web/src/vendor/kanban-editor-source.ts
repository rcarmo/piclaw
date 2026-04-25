/**
 * Kanban Board Editor
 *
 * Renders a markdown-backed kanban board using vendored Preact + HTM.
 * Exposes a mount/update/destroy API on window.__kanbanEditor for the
 * pane host to drive — no VS Code abstractions.
 */

import { moveCardInBoard, moveLaneInBoard } from './kanban-board-ops.js';

// Declare globals from vendored scripts (set by kanban-pane.ts before this runs)
declare const preact: any;
declare const preactHooks: any;
declare const htm: any;

// ── Types ───────────────────────────────────────────────────────

interface CardData {
  id: string;
  title: string;
  checked: boolean;
  checkChar: string;
}

interface LaneData {
  id: string;
  title: string;
  cards: CardData[];
  collapsed?: boolean;
}

interface BoardData {
  lanes: LaneData[];
  archive: CardData[];
  settings: Record<string, any>;
}

interface KanbanMountOpts {
  content: string;
  isDark: boolean;
  onEdit: (markdownContent: string) => void;
}

interface HistoryEntry {
  board: BoardData;
  label: string;
}

// ── Module state ────────────────────────────────────────────────

const { h, render: preactRender } = preact;
const { useState, useEffect, useCallback, useRef } = preactHooks;
const html = htm.bind(h);

let _container: HTMLElement | null = null;
let _onEdit: ((md: string) => void) | null = null;

// External update channel: the pane calls __kanbanEditor.update(content)
// which sets this, and a useEffect picks it up.
let _pendingContent: string | null = null;
let _pendingContentVersion = 0;

// Drag state
let draggedCard: { card: CardData; fromLaneId: string; fromIndex: number } | null = null;
let draggedLane: { laneId: string; fromIndex: number } | null = null;
const _cardMarkdownCache = new Map<string, string>();
let _dragPreviewEl: HTMLElement | null = null;
let _transparentDragImageEl: HTMLCanvasElement | null = null;

// ── Helpers ─────────────────────────────────────────────────────

function createId(prefix: 'card' | 'lane'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// ── SVG Icons ───────────────────────────────────────────────────

const icons = {
  grip: html`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>`,
  plus: html`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  plusCircle: html`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
  trash: html`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
  archive: html`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>`,
  restore: html`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
  moreVertical: html`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`,
  check: html`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  x: html`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};

// ── Parsing ─────────────────────────────────────────────────────

function stripFrontmatter(md: string): string {
  if (!md.startsWith('---\n')) return md;
  const endIndex = md.indexOf('\n---\n', 4);
  return endIndex === -1 ? md : md.slice(endIndex + 5);
}

function extractSettings(content: string): { settings: Record<string, any>; content: string } {
  const settingsStart = content.indexOf('%% kanban:settings');
  if (settingsStart === -1) return { settings: {}, content };
  const codeStart = content.indexOf('```', settingsStart);
  if (codeStart === -1) return { settings: {}, content };
  const codeEnd = content.indexOf('```', codeStart + 3);
  if (codeEnd === -1) return { settings: {}, content };
  const settingsText = content.slice(codeStart + 3, codeEnd).trim();
  let settings: Record<string, any> = {};
  try { settings = JSON.parse(settingsText); } catch { /* ignore */ }
  const endMarker = content.indexOf('%%', codeEnd + 3);
  const removeEnd = endMarker === -1 ? codeEnd + 3 : endMarker + 2;
  const cleaned = `${content.slice(0, settingsStart).trimEnd()}\n${content.slice(removeEnd).trimStart()}`.trim();
  return { settings, content: cleaned };
}

function escapeMarkdownLine(line: string): string {
  if (line.startsWith('\\#') || line.startsWith('\\---')) return line;
  if (line.startsWith('#') || line.startsWith('---')) return `\\${line}`;
  return line;
}

function unescapeMarkdownLine(line: string): string {
  if (line.startsWith('\\#') || line.startsWith('\\---')) return line.slice(1);
  return line;
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeMarkdownUrl(rawUrl: string): string {
  const text = String(rawUrl || '').trim();
  if (!text) return '#';
  if (text.startsWith('#') || text.startsWith('/')) return text;
  try {
    const parsed = new URL(text, window.location.origin);
    if (['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) {
      return parsed.toString();
    }
  } catch {
    // ignore invalid urls
  }
  return '#';
}

function renderBasicCardMarkdown(text: string): string {
  return text.replace(/\n/g, '<br>');
}

function renderCardMarkdown(text: string): string {
  const source = String(text || '');
  const cached = _cardMarkdownCache.get(source);
  if (cached) return cached;

  const escaped = escapeHtml(source);
  let html = renderBasicCardMarkdown(escaped);
  const markedApi = (globalThis as any)?.marked;
  try {
    if (markedApi?.parse) {
      html = String(markedApi.parse(escaped, {
        gfm: true,
        breaks: true,
        headerIds: false,
        mangle: false,
      }) || '');
    }
  } catch {
    html = renderBasicCardMarkdown(escaped);
  }

  html = html.replace(/<a\s+([^>]*?)href=(['"])(.*?)\2([^>]*)>/gi, (_match, before, quote, href, after) => {
    const safeHref = sanitizeMarkdownUrl(href);
    return `<a ${before}href=${quote}${safeHref}${quote}${after} target="_blank" rel="noopener noreferrer">`;
  });

  _cardMarkdownCache.set(source, html);
  return html;
}

function getTransparentDragImage(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (_transparentDragImageEl) return _transparentDragImageEl;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  _transparentDragImageEl = canvas;
  return canvas;
}

function ensureCardDragPreview(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (_dragPreviewEl?.isConnected) return _dragPreviewEl;
  const el = document.createElement('div');
  el.className = 'kanban-plugin__drag-preview';
  document.body.appendChild(el);
  _dragPreviewEl = el;
  return el;
}

function updateCardDragPreviewPosition(clientX: number, clientY: number): void {
  const preview = ensureCardDragPreview();
  if (!preview) return;
  preview.style.left = `${Math.round(Number(clientX || 0) + 18)}px`;
  preview.style.top = `${Math.round(Number(clientY || 0) + 18)}px`;
}

function showCardDragPreview(card: CardData, point?: { clientX?: number; clientY?: number }): void {
  const preview = ensureCardDragPreview();
  if (!preview) return;
  preview.innerHTML = `
    <div class="kanban-plugin__item kanban-plugin__item--drag-preview ${card.checked ? 'is-complete' : ''}">
      <div class="kanban-plugin__item-content-wrapper">
        <div class="kanban-plugin__item-title-wrapper">
          <div class="kanban-plugin__item-prefix-button-wrapper">
            <div class="kanban-plugin__item-checkbox ${card.checked ? 'is-checked' : ''}">${card.checked ? '✓' : ''}</div>
          </div>
          <div class="kanban-plugin__item-title kanban-plugin__item-markdown">${renderCardMarkdown(card.title)}</div>
        </div>
      </div>
    </div>`;
  preview.classList.add('is-visible');
  updateCardDragPreviewPosition(Number(point?.clientX || 0), Number(point?.clientY || 0));
}

function hideCardDragPreview(): void {
  _dragPreviewEl?.classList.remove('is-visible');
}

function destroyCardDragPreview(): void {
  hideCardDragPreview();
  _dragPreviewEl?.remove();
  _dragPreviewEl = null;
}

function parseMarkdown(md: string): BoardData {
  const board: BoardData = { lanes: [], archive: [], settings: {} };
  let content = stripFrontmatter(md);
  const extracted = extractSettings(content);
  board.settings = extracted.settings;
  content = extracted.content;
  const parts = content.split(/\n---\n/);
  board.lanes = parseLanes(parts[0]);
  if (parts.length > 1) {
    const archiveContent = parts.slice(1).join('\n---\n');
    const archiveLanes = parseLanes(archiveContent);
    const archiveLane = archiveLanes.find(l => l.title.toLowerCase() === 'archive');
    if (archiveLane) board.archive = archiveLane.cards;
  }
  return board;
}

function parseLanes(content: string): LaneData[] {
  const lanes: LaneData[] = [];
  const sections = content.split(/(?=^## )/gm).filter(s => s.trim());
  for (const section of sections) {
    const lines = section.split('\n');
    const headerMatch = lines[0].match(/^## (.+)$/);
    if (!headerMatch) continue;
    const lane: LaneData = { id: createId('lane'), title: headerMatch[1].trim(), cards: [] };
    let currentCard: CardData | null = null;
    let currentTitle = '';
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const cardMatch = line.match(/^- \[(.)\] (.*)$/);
      if (cardMatch) {
        if (currentCard) { currentCard.title = currentTitle.trim(); lane.cards.push(currentCard); }
        currentCard = { id: createId('card'), title: unescapeMarkdownLine(cardMatch[2]), checkChar: cardMatch[1], checked: cardMatch[1] !== ' ' };
        currentTitle = unescapeMarkdownLine(cardMatch[2]);
      } else if (currentCard && line.match(/^\s+\S/)) {
        currentTitle += '\n' + unescapeMarkdownLine(line.replace(/^\s+/, ''));
      }
    }
    if (currentCard) { currentCard.title = currentTitle.trim(); lane.cards.push(currentCard); }
    lanes.push(lane);
  }
  return lanes;
}

function serializeMarkdown(board: BoardData): string {
  const lines: string[] = ['---', '', 'kanban-plugin: board', '', '---', ''];
  for (const lane of board.lanes) {
    lines.push(`## ${lane.title}`, '');
    for (const card of lane.cards) {
      const checkbox = `[${card.checked ? (card.checkChar !== ' ' ? card.checkChar : 'x') : ' '}]`;
      const titleLines = card.title.split('\n');
      lines.push(`- ${checkbox} ${escapeMarkdownLine(titleLines[0])}`);
      for (let i = 1; i < titleLines.length; i++) lines.push(`  ${escapeMarkdownLine(titleLines[i])}`);
    }
    lines.push('');
  }
  if (board.archive.length > 0) {
    lines.push('---', '', '## Archive', '');
    for (const card of board.archive) {
      const titleLines = card.title.split('\n');
      lines.push(`- [${card.checked ? 'x' : ' '}] ${escapeMarkdownLine(titleLines[0])}`);
      for (let i = 1; i < titleLines.length; i++) lines.push(`  ${escapeMarkdownLine(titleLines[i])}`);
    }
    lines.push('');
  }
  if (Object.keys(board.settings).length > 0) {
    lines.push('%% kanban:settings', '```', JSON.stringify(board.settings), '```', '%%');
  }
  return lines.join('\n');
}

// ── Preact Components ───────────────────────────────────────────

function ItemCheckbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return html`
    <div class="kanban-plugin__item-prefix-button-wrapper">
      <button class="kanban-plugin__item-checkbox ${checked ? 'is-checked' : ''}"
        onClick=${(e: Event) => { e.stopPropagation(); onChange(); }}>
        ${checked ? icons.check : ''}
      </button>
    </div>`;
}

function ItemMenuButton({ onArchive, isEditing, onCancelEdit }: any) {
  return html`
    <div class="kanban-plugin__item-postfix-button-wrapper">
      ${isEditing ? html`
        <button class="kanban-plugin__item-postfix-button is-enabled"
          onClick=${(e: Event) => { e.stopPropagation(); onCancelEdit(); }} title="Cancel">${icons.x}</button>
      ` : html`
        <button class="kanban-plugin__item-postfix-button"
          onClick=${(e: Event) => { e.stopPropagation(); onArchive(); }} title="Archive">${icons.archive}</button>
      `}
    </div>`;
}

function Card({ card, laneId, cardIndex, onUpdate, onDelete, onArchive, onMoveCard }: any) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(card.title);
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length);
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = inputRef.current.scrollHeight + 'px';
    }
  }, [isEditing]);

  const handleDragStart = (e: DragEvent) => {
    draggedCard = { card, fromLaneId: laneId, fromIndex: cardIndex };
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', card.id);
    const transparentDragImage = getTransparentDragImage();
    if (transparentDragImage && e.dataTransfer?.setDragImage) {
      e.dataTransfer.setDragImage(transparentDragImage, 0, 0);
    }
    showCardDragPreview(card, { clientX: e.clientX, clientY: e.clientY });
    setTimeout(() => { (e.target as HTMLElement).classList.add('is-dragging'); }, 0);
  };
  const handleDrag = (e: DragEvent) => {
    if (!draggedCard) return;
    updateCardDragPreviewPosition(e.clientX, e.clientY);
  };
  const handleDragEnd = (e: DragEvent) => {
    draggedCard = null;
    setDropPosition(null);
    hideCardDragPreview();
    (e.target as HTMLElement).classList.remove('is-dragging');
  };
  const updateDropPosition = (e: DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropPosition(e.clientY >= rect.top + rect.height / 2 ? 'after' : 'before');
  };
  const handleDragOver = (e: DragEvent) => {
    if (!draggedCard || isEditing) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer!.dropEffect = 'move';
    updateCardDragPreviewPosition(e.clientX, e.clientY);
    updateDropPosition(e);
  };
  const handleDragLeave = (e: DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      setDropPosition(null);
    }
  };
  const handleDrop = (e: DragEvent) => {
    if (!draggedCard || isEditing) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const insertAfter = e.clientY >= rect.top + rect.height / 2;
    onMoveCard(draggedCard.card, draggedCard.fromLaneId, laneId, cardIndex + (insertAfter ? 1 : 0));
    setDropPosition(null);
    hideCardDragPreview();
    draggedCard = null;
  };
  const handleCheck = () => { onUpdate({ ...card, checked: !card.checked, checkChar: card.checked ? ' ' : 'x' }); };
  const saveEdit = () => { if (editTitle.trim()) onUpdate({ ...card, title: editTitle.trim() }); setIsEditing(false); };
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
    else if (e.key === 'Escape') { setEditTitle(card.title); setIsEditing(false); }
  };
  const handleInput = (e: any) => { setEditTitle(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; };
  const cancelEdit = () => { setEditTitle(card.title); setIsEditing(false); };

  return html`
    <div class="kanban-plugin__item-wrapper ${dropPosition ? `is-drop-${dropPosition}` : ''}"
      onDragOver=${handleDragOver}
      onDragLeave=${handleDragLeave}
      onDrop=${handleDrop}>
      <div class="kanban-plugin__item ${card.checked ? 'is-complete' : ''} ${isEditing ? 'is-editing' : ''}"
        draggable=${!isEditing}
        onKeyDown=${(e: KeyboardEvent) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); setIsEditing(true); }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); onDelete(card); }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); onArchive(card); }
        }}
        onDragStart=${handleDragStart} onDrag=${handleDrag} onDragEnd=${handleDragEnd}
        onDblClick=${() => !isEditing && setIsEditing(true)} tabindex="0">
        <div class="kanban-plugin__item-content-wrapper">
          <div class="kanban-plugin__item-title-wrapper">
            <${ItemCheckbox} checked=${card.checked} onChange=${handleCheck} />
            ${isEditing ? html`
              <textarea ref=${inputRef} class="kanban-plugin__item-edit-textarea"
                value=${editTitle} onInput=${handleInput}
                onBlur=${() => { if (isEditing) saveEdit(); }}
                onKeyDown=${handleKeyDown} />
            ` : html`<div class="kanban-plugin__item-title kanban-plugin__item-markdown" dangerouslySetInnerHTML=${{ __html: renderCardMarkdown(card.title) }}></div>`}
            <${ItemMenuButton} isEditing=${isEditing}
              onArchive=${() => onArchive(card)} onCancelEdit=${cancelEdit} />
          </div>
        </div>
      </div>
    </div>`;
}

function ItemForm({ onAdd, onCancel }: { onAdd: (title: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const handleSubmit = () => { if (title.trim()) { onAdd(title.trim()); setTitle(''); } };
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
    else if (e.key === 'Escape') onCancel();
  };
  return html`
    <div class="kanban-plugin__item-form">
      <div class="kanban-plugin__item-input-wrapper">
        <textarea ref=${inputRef} placeholder="Card title..." value=${title}
          onInput=${(e: any) => setTitle(e.target.value)} onKeyDown=${handleKeyDown} rows="2" />
      </div>
      <div class="kanban-plugin__item-input-actions">
        <button class="kanban-plugin__item-action-add" onClick=${handleSubmit}>Add card</button>
        <button class="kanban-plugin__item-action-cancel" onClick=${onCancel}>Cancel</button>
      </div>
    </div>`;
}

function Lane({ lane, laneIndex, onUpdate, onDelete, onAddCard, onUpdateCard, onDeleteCard, onArchiveCard, onMoveCard, onMoveLane }: any) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(lane.title);
  const [isAddingCard, setIsAddingCard] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLaneDragOver, setIsLaneDragOver] = useState(false);
  const [isLaneDragging, setIsLaneDragging] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (isEditingTitle && titleInputRef.current) { titleInputRef.current.focus(); titleInputRef.current.select(); } }, [isEditingTitle]);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (draggedCard) {
      e.dataTransfer!.dropEffect = 'move';
      updateCardDragPreviewPosition(e.clientX, e.clientY);
      setIsDragOver(true);
    }
    if (draggedLane) {
      e.dataTransfer!.dropEffect = 'move';
      setIsLaneDragOver(true);
    }
  };
  const handleDragLeave = (e: DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      setIsDragOver(false);
      setIsLaneDragOver(false);
    }
  };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    setIsLaneDragOver(false);
    if (draggedCard) onMoveCard(draggedCard.card, draggedCard.fromLaneId, lane.id);
    if (draggedLane && draggedLane.laneId !== lane.id) onMoveLane(draggedLane.laneId, lane.id);
    hideCardDragPreview();
    draggedCard = null;
    draggedLane = null;
  };
  const handleLaneDragStart = (e: DragEvent) => {
    draggedLane = { laneId: lane.id, fromIndex: laneIndex };
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', lane.id);
    setIsLaneDragging(true);
  };
  const handleLaneDragEnd = () => {
    draggedLane = null;
    setIsLaneDragOver(false);
    setIsLaneDragging(false);
  };
  const saveTitleEdit = () => { if (titleValue.trim()) onUpdate({ ...lane, title: titleValue.trim() }); setIsEditingTitle(false); };
  const handleAddCard = (title: string) => { onAddCard(lane.id, title); setIsAddingCard(false); };

  return html`
    <div class="kanban-plugin__lane-wrapper ${isLaneDragOver ? 'is-lane-drop-target' : ''} ${isLaneDragging ? 'is-lane-dragging' : ''}"
      onDragOver=${handleDragOver}
      onDragLeave=${handleDragLeave}
      onDrop=${handleDrop}>
      <div class="kanban-plugin__lane ${isDragOver ? 'is-dropping' : ''}">
        <div class="kanban-plugin__lane-header-wrapper">
          <div
            class="kanban-plugin__lane-grip"
            draggable=${!isEditingTitle && !isAddingCard}
            onDragStart=${handleLaneDragStart}
            onDragEnd=${handleLaneDragEnd}
            title="Drag lane"
          >${icons.grip}</div>
          <div class="kanban-plugin__lane-title">
            ${isEditingTitle ? html`
              <input ref=${titleInputRef} class="kanban-plugin__lane-title-input" value=${titleValue}
                onInput=${(e: any) => setTitleValue(e.target.value)}
                onBlur=${() => { if (isEditingTitle) saveTitleEdit(); }}
                onKeyDown=${(e: KeyboardEvent) => { if (e.key === 'Enter') saveTitleEdit(); if (e.key === 'Escape') { setTitleValue(lane.title); setIsEditingTitle(false); } }} />
            ` : html`
              <div class="kanban-plugin__lane-title-text" onDblClick=${() => setIsEditingTitle(true)} title=${lane.title}>${lane.title}</div>
            `}
          </div>
          <div class="kanban-plugin__lane-settings-button-wrapper">
            <button class="kanban-plugin__lane-settings-button" onClick=${() => setIsAddingCard(true)} title="Add card">${icons.plusCircle}</button>
          </div>
        </div>
        <div class="kanban-plugin__lane-items">
          ${lane.cards.map((card: CardData, index: number) => html`
            <${Card} key=${card.id} card=${card} laneId=${lane.id} cardIndex=${index}
              onUpdate=${(c: CardData) => onUpdateCard(lane.id, c)}
              onDelete=${(c: CardData) => onDeleteCard(lane.id, c)}
              onArchive=${onArchiveCard}
              onMoveCard=${onMoveCard} />`)}
        </div>
        ${isAddingCard ? html`<${ItemForm} onAdd=${handleAddCard} onCancel=${() => setIsAddingCard(false)} />` : null}
      </div>
    </div>`;
}

function LaneForm({ onAdd, onCancel }: { onAdd: (title: string) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const handleSubmit = () => { if (title.trim()) onAdd(title.trim()); };
  return html`
    <div class="kanban-plugin__lane-form-wrapper">
      <input ref=${inputRef} class="kanban-plugin__lane-input" placeholder="Enter lane title..." value=${title}
        onInput=${(e: any) => setTitle(e.target.value)}
        onKeyDown=${(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } else if (e.key === 'Escape') onCancel(); }} />
      <div class="kanban-plugin__lane-input-actions">
        <button class="kanban-plugin__lane-action-add" onClick=${handleSubmit}>Add lane</button>
        <button class="kanban-plugin__lane-action-cancel" onClick=${onCancel}>Cancel</button>
      </div>
    </div>`;
}

function Archive({ cards, onRestore }: { cards: CardData[]; onRestore: (card: CardData) => void }) {
  const [isExpanded, setIsExpanded] = useState(true);
  if (cards.length === 0) return null;
  return html`
    <div class="kanban-plugin__archive">
      <div class="kanban-plugin__archive-header">
        <h3>${icons.archive} Archive (${cards.length})</h3>
        <button class="kanban-plugin__archive-toggle" onClick=${() => setIsExpanded(!isExpanded)}>${isExpanded ? 'Hide' : 'Show'}</button>
      </div>
      ${isExpanded && html`
        <div class="kanban-plugin__archive-cards">
          ${cards.map(card => html`
            <div class="kanban-plugin__archive-card" key=${card.id}>
              <span class="kanban-plugin__archive-card-title">${card.title.split('\n')[0]}</span>
              <button onClick=${() => onRestore(card)} title="Restore">${icons.restore}</button>
            </div>`)}
        </div>`}
    </div>`;
}

// ── Board (root component) ──────────────────────────────────────

function summarizeCardLabel(card: CardData | null | undefined): string {
  const title = String(card?.title || '').split('\n')[0].trim();
  if (!title) return 'card';
  return title.length > 36 ? `${title.slice(0, 35)}…` : title;
}

function summarizeLaneLabel(lane: LaneData | null | undefined): string {
  const title = String(lane?.title || '').trim();
  if (!title) return 'lane';
  return title.length > 28 ? `${title.slice(0, 27)}…` : title;
}

function Board({ initialContent }: { initialContent: string }) {
  const [board, setBoard] = useState<BoardData | null>(() =>
    parseMarkdown(initialContent ?? ''),
  );
  const [isAddingLane, setIsAddingLane] = useState(false);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  // Track external content version so the pane can push updates
  const [extVer, setExtVer] = useState(_pendingContentVersion);

  // Pick up external content pushed via __kanbanEditor.update()
  useEffect(() => {
    const id = setInterval(() => {
      if (_pendingContentVersion !== extVer) {
        setExtVer(_pendingContentVersion);
        if (_pendingContent !== null) {
          setBoard(parseMarkdown(_pendingContent));
          _pendingContent = null;
        }
      }
    }, 100);
    return () => clearInterval(id);
  }, [extVer]);

  const saveBoard = useCallback((newBoard: BoardData, label: string = 'Updated board') => {
    setBoard(newBoard);
    setUndoStack(prev => board ? [...prev, { board, label }] : prev);
    setRedoStack([]);
    _onEdit?.(serializeMarkdown(newBoard));
  }, [board]);

  const undo = useCallback(() => {
    if (!board || undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack(prev => [...prev, { board, label: previous.label }]);
    setBoard(previous.board);
    _onEdit?.(serializeMarkdown(previous.board));
  }, [board, undoStack]);

  const redo = useCallback(() => {
    if (!board || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack(prev => [...prev, { board, label: next.label }]);
    setBoard(next.board);
    _onEdit?.(serializeMarkdown(next.board));
  }, [board, redoStack]);

  // Keyboard shortcuts (scoped to our container, not document)
  useEffect(() => {
    const el = _container;
    if (!el) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleDragOver = (e: DragEvent) => {
      if (!draggedCard) return;
      updateCardDragPreviewPosition(e.clientX, e.clientY);
    };
    const handleDragCleanup = () => {
      hideCardDragPreview();
      draggedCard = null;
    };
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDragCleanup);
    document.addEventListener('dragend', handleDragCleanup);
    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDragCleanup);
      document.removeEventListener('dragend', handleDragCleanup);
      destroyCardDragPreview();
    };
  }, []);

  const addLane = (title: string) => {
    if (!board) return;
    saveBoard(
      { ...board, lanes: [...board.lanes, { id: createId('lane'), title, cards: [] }] },
      `Added lane “${summarizeLaneLabel({ id: '', title, cards: [] })}”`,
    );
    setIsAddingLane(false);
  };
  const updateLane = (l: LaneData) => {
    if (!board) return;
    saveBoard({ ...board, lanes: board.lanes.map(x => x.id === l.id ? l : x) }, `Updated lane “${summarizeLaneLabel(l)}”`);
  };
  const deleteLane = (l: LaneData) => {
    if (!board) return;
    saveBoard({ ...board, lanes: board.lanes.filter(x => x.id !== l.id) }, `Deleted lane “${summarizeLaneLabel(l)}”`);
  };
  const moveLane = (fromLaneId: string, toLaneId: string) => {
    if (!board) return;
    const fromLane = board.lanes.find((lane) => lane.id === fromLaneId) || null;
    const toLane = board.lanes.find((lane) => lane.id === toLaneId) || null;
    const nextBoard = moveLaneInBoard(board, { fromLaneId, toLaneId });
    if (nextBoard === board) return;
    saveBoard(nextBoard, `Moved lane “${summarizeLaneLabel(fromLane)}” before “${summarizeLaneLabel(toLane)}”`);
  };
  const addCard = (laneId: string, title: string) => {
    if (!board) return;
    const lane = board.lanes.find((entry) => entry.id === laneId) || null;
    const c: CardData = { id: createId('card'), title, checked: false, checkChar: ' ' };
    saveBoard(
      { ...board, lanes: board.lanes.map(l => l.id === laneId ? { ...l, cards: [...l.cards, c] } : l) },
      `Added card to “${summarizeLaneLabel(lane)}”`,
    );
  };
  const updateCard = (laneId: string, c: CardData) => {
    if (!board) return;
    const lane = board.lanes.find((entry) => entry.id === laneId) || null;
    saveBoard(
      { ...board, lanes: board.lanes.map(l => l.id === laneId ? { ...l, cards: l.cards.map(x => x.id === c.id ? c : x) } : l) },
      `Updated “${summarizeCardLabel(c)}” in “${summarizeLaneLabel(lane)}”`,
    );
  };
  const deleteCard = (laneId: string, c: CardData) => {
    if (!board) return;
    const lane = board.lanes.find((entry) => entry.id === laneId) || null;
    saveBoard(
      { ...board, lanes: board.lanes.map(l => l.id === laneId ? { ...l, cards: l.cards.filter(x => x.id !== c.id) } : l) },
      `Deleted “${summarizeCardLabel(c)}” from “${summarizeLaneLabel(lane)}”`,
    );
  };
  const archiveCard = (c: CardData) => {
    if (!board) return;
    saveBoard(
      { ...board, lanes: board.lanes.map(l => ({ ...l, cards: l.cards.filter(x => x.id !== c.id) })), archive: [...board.archive, { ...c, checked: true }] },
      `Archived “${summarizeCardLabel(c)}”`,
    );
  };
  const moveCard = (c: CardData, from: string, to: string, toIndex?: number) => {
    if (!board) return;
    const targetLane = board.lanes.find((lane) => lane.id === to) || null;
    const nextBoard = moveCardInBoard(board, { cardId: c.id, fromLaneId: from, toLaneId: to, toIndex });
    if (nextBoard === board) return;
    const action = from === to ? 'Reordered' : 'Moved';
    saveBoard(nextBoard, `${action} “${summarizeCardLabel(c)}” in “${summarizeLaneLabel(targetLane)}”`);
  };
  const restoreFromArchive = (c: CardData) => {
    if (!board) return;
    if (board.lanes.length === 0) {
      saveBoard(
        { ...board, lanes: [{ id: createId('lane'), title: 'Restored', cards: [{ ...c, checked: false }] }], archive: board.archive.filter(x => x.id !== c.id) },
        `Restored “${summarizeCardLabel(c)}”`,
      );
      return;
    }
    const target = board.lanes[0];
    saveBoard(
      { ...board, lanes: board.lanes.map(l => l.id === target.id ? { ...l, cards: [...l.cards, { ...c, checked: false }] } : l), archive: board.archive.filter(x => x.id !== c.id) },
      `Restored “${summarizeCardLabel(c)}” to “${summarizeLaneLabel(target)}”`,
    );
  };

  if (!board) return html`<div class="loading">Loading...</div>`;

  const latestUndoEntry = undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;
  const latestRedoEntry = redoStack.length > 0 ? redoStack[redoStack.length - 1] : null;

  return html`
    <div class="kanban-plugin" tabindex="-1">
      <div class="kanban-plugin__search-wrapper">
        <button onClick=${() => setIsAddingLane(true)}>${icons.plus} Add lane</button>
        <button class="secondary" onClick=${undo} disabled=${undoStack.length === 0} title=${latestUndoEntry ? `Undo: ${latestUndoEntry.label} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}>Undo</button>
        <button class="secondary" onClick=${redo} disabled=${redoStack.length === 0} title=${latestRedoEntry ? `Redo: ${latestRedoEntry.label} (Ctrl+Y)` : 'Redo (Ctrl+Y)'}>Redo</button>
        ${latestUndoEntry && html`<span class="kanban-plugin__history-note" title=${latestUndoEntry.label}>Last change: ${latestUndoEntry.label}</span>`}
      </div>
      <div class="kanban-plugin__board"><div>
        ${board.lanes.map((lane, laneIndex) => html`
          <${Lane} key=${lane.id} lane=${lane} laneIndex=${laneIndex} onUpdate=${updateLane} onDelete=${deleteLane}
            onAddCard=${addCard} onUpdateCard=${updateCard} onDeleteCard=${deleteCard}
            onArchiveCard=${archiveCard} onMoveCard=${moveCard} onMoveLane=${moveLane} />`)}
        ${isAddingLane && html`<${LaneForm} onAdd=${addLane} onCancel=${() => setIsAddingLane(false)} />`}
      </div></div>
      <${Archive} cards=${board.archive} onRestore=${restoreFromArchive} />
    </div>`;
}

// ── Public API ──────────────────────────────────────────────────

(window as any).__kanbanEditor = {
  /** Mount the kanban board into a container. */
  mount(container: HTMLElement, opts: KanbanMountOpts) {
    _container = container;
    _onEdit = opts.onEdit;
    draggedCard = null;
    _pendingContent = null;
    destroyCardDragPreview();
    if (!opts.isDark) container.classList.add('light');
    preactRender(html`<${Board} initialContent=${opts.content} />`, container);
  },

  /** Push new content from the host (external file reload). */
  update(content: string) {
    _pendingContent = content;
    _pendingContentVersion++;
  },

  /** Set light/dark theme. */
  setTheme(isDark: boolean) {
    _container?.classList.toggle('light', !isDark);
  },

  /** Unmount and clean up all state. */
  destroy() {
    if (_container) {
      preactRender(null, _container); // unmounts Board → runs all useEffect cleanups
    }
    _container = null;
    _onEdit = null;
    _pendingContent = null;
    draggedCard = null;
    destroyCardDragPreview();
  },
};
