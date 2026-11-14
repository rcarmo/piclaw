/** Core Plan Markdown, action semantics and prompt text. No storage or SDK/session/add-on state. */

export type SessionPlan = {
  chat_jid: string;
  markdown: string;
  updated_at: string | null;
};

export type PlanItemStatus = "pending" | "in_progress" | "completed";

export type UpdatePlanItem = {
  step: string;
  status: PlanItemStatus;
};

export type UpdatePlanArgs = {
  explanation?: string;
  plan: UpdatePlanItem[];
};

export type StructuredSessionPlan = SessionPlan & {
  explanation: string | null;
  plan: UpdatePlanItem[];
};

export const DEFAULT_PLAN = [
  "- [ ] Update this plan thoroughly with ongoing work",
  "- [ ] Clarify the current objective",
  "- [ ] Do the next concrete step",
  "- [ ] Verify the result",
  "- [ ] Report progress and next step",
].join("\n");

const CHECKLIST_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX-])\](\s*)(.*)$/;

function normalizeLineEndings(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n") : "";
}

function normalizeText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function statusFromMarkdownMarker(marker: string): PlanItemStatus {
  if (marker.toLowerCase() === "x") return "completed";
  if (marker === "-") return "in_progress";
  return "pending";
}

function markerForStatus(status: PlanItemStatus): string {
  switch (status) {
    case "completed": return "x";
    case "in_progress": return "-";
    case "pending": return " ";
  }
}

function normalizePlanStep(value: unknown): string {
  return normalizeText(value).replace(/\s+/g, " ");
}

function normalizePlanStatus(value: unknown): PlanItemStatus {
  if (value === "pending" || value === "in_progress" || value === "completed") return value;
  throw new Error("Invalid plan status " + JSON.stringify(value) + "; expected pending, in_progress, or completed.");
}

export function normalizeUpdatePlanArgs(input: unknown): UpdatePlanArgs {
  const raw = input && typeof input === "object" ? input as { explanation?: unknown; plan?: unknown } : {};
  if (!Array.isArray(raw.plan)) throw new Error("plan action=update requires a plan array.");
  let inProgressCount = 0;
  const plan = raw.plan.map((item, index): UpdatePlanItem => {
    const entry = item && typeof item === "object" ? item as { step?: unknown; status?: unknown } : {};
    const step = normalizePlanStep(entry.step);
    if (!step) throw new Error("plan update item " + (index + 1) + " requires a non-empty step.");
    const status = normalizePlanStatus(entry.status);
    if (status === "in_progress") inProgressCount += 1;
    return { step, status };
  });
  if (inProgressCount > 1) throw new Error("plan update accepts at most one in_progress step.");
  const explanation = normalizeText(raw.explanation);
  return explanation ? { explanation, plan } : { plan };
}

export function parsePlanMarkdown(markdownInput: unknown): { explanation: string | null; plan: UpdatePlanItem[]; inProgressCount: number } {
  const lines = normalizeLineEndings(markdownInput).split("\n");
  const explanationLines: string[] = [];
  const plan: UpdatePlanItem[] = [];
  let inProgressCount = 0;
  let sawTask = false;
  for (const line of lines) {
    const match = line.match(CHECKLIST_LINE_RE);
    if (match) {
      sawTask = true;
      const status = statusFromMarkdownMarker(match[2]);
      if (status === "in_progress") inProgressCount += 1;
      plan.push({ step: normalizePlanStep(match[4]), status });
      continue;
    }
    if (!sawTask && line.trim().startsWith(">")) {
      explanationLines.push(line.trim().replace(/^>\s?/, ""));
    }
  }
  const explanation = explanationLines.join("\n").trim() || null;
  return { explanation, plan, inProgressCount };
}

export function normalizeStoredPlanMarkdown(markdownInput: unknown): string {
  const lines = normalizeLineEndings(markdownInput).split("\n");
  let inProgressCount = 0;
  const next = lines.map((line) => {
    const match = line.match(CHECKLIST_LINE_RE);
    if (!match) return line;
    const [, prefix, marker, spacing, text] = match;
    const status = statusFromMarkdownMarker(marker);
    if (status === "in_progress") inProgressCount += 1;
    return `${prefix}[${markerForStatus(status)}]${spacing || " "}${text}`;
  }).join("\n");
  if (inProgressCount > 1) throw new Error("Plan Markdown can contain at most one in-progress checklist item (`[-]`).");
  return next;
}

function quoteMarkdownNote(note: string): string[] {
  return normalizeLineEndings(note)
    .split("\n")
    .map((line) => (`> ${line.trim()}`).trimEnd());
}

export function updatePlanArgsToMarkdown(input: unknown): string {
  const args = normalizeUpdatePlanArgs(input);
  const lines: string[] = [];
  if (args.explanation) lines.push(...quoteMarkdownNote(args.explanation), "");
  for (const item of args.plan) lines.push(`- [${markerForStatus(item.status)}] ${item.step}`);
  return lines.join("\n").trimEnd();
}

export function structuredPlanDetails(plan: SessionPlan): StructuredSessionPlan {
  const parsed = parsePlanMarkdown(plan.markdown);
  return { ...plan, explanation: parsed.explanation, plan: parsed.plan };
}

export type PlanEditOperation = "replace" | "delete" | "insert_after" | "insert_before" | "append" | "prepend";

export type PlanEditBlock = {
  operation?: PlanEditOperation;
  oldText?: string;
  newText?: string;
  anchorText?: string;
  text?: string;
};

export type PlanPatchOperation = "add" | "update" | "remove";

export type PlanPatchPosition = "start" | "end";

export type PlanPatchBlock = {
  operation: PlanPatchOperation;
  index?: number;
  match?: string;
  step?: string;
  status?: PlanItemStatus;
  position?: PlanPatchPosition;
  before?: string;
  after?: string;
};

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  while (true) {
    const found = haystack.indexOf(needle, index);
    if (found < 0) return count;
    count += 1;
    index = found + needle.length;
  }
}

function normalizePlanEditOperation(edit: Partial<PlanEditBlock>): PlanEditOperation {
  const operation = edit.operation;
  if (operation === "replace" || operation === "delete" || operation === "insert_after" || operation === "insert_before" || operation === "append" || operation === "prepend") return operation;
  if (typeof edit.oldText === "string" && typeof edit.newText === "string") return "replace";
  throw new Error("Each plan edit needs operation replace, delete, insert_after, insert_before, append, or prepend.");
}

function requireEditText(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Each plan edit ${field} must be a string.`);
  if (!value && field !== "newText") throw new Error(`Each plan edit ${field} must not be empty.`);
  return value;
}

function findUniqueAnchor(markdown: string, anchor: string, label = "anchorText"): { from: number; to: number } {
  const occurrences = countOccurrences(markdown, anchor);
  if (occurrences !== 1) throw new Error(`Plan edit ${label} must match exactly once; got ${occurrences} matches for ${JSON.stringify(anchor)}.`);
  const from = markdown.indexOf(anchor);
  return { from, to: from + anchor.length };
}

export function applyPlanEdits(markdownInput: unknown, editsInput: unknown): string {
  const markdown = normalizeLineEndings(markdownInput);
  const edits = Array.isArray(editsInput) ? editsInput : [];
  if (!edits.length) throw new Error("plan action=edit requires at least one edit block.");

  const ranges: Array<{ from: number; to: number; newText: string; order: number }> = [];
  edits.forEach((raw, order) => {
    const edit = raw && typeof raw === "object" ? raw as Partial<PlanEditBlock> : {};
    const operation = normalizePlanEditOperation(edit);

    if (operation === "append") {
      ranges.push({ from: markdown.length, to: markdown.length, newText: requireEditText(edit.text ?? edit.newText, "text"), order });
      return;
    }
    if (operation === "prepend") {
      ranges.push({ from: 0, to: 0, newText: requireEditText(edit.text ?? edit.newText, "text"), order });
      return;
    }

    const anchor = requireEditText(edit.anchorText ?? edit.oldText, operation === "replace" || operation === "delete" ? "oldText" : "anchorText");
    const range = findUniqueAnchor(markdown, anchor, operation === "replace" || operation === "delete" ? "oldText" : "anchorText");
    if (operation === "replace") ranges.push({ ...range, newText: requireEditText(edit.newText, "newText"), order });
    else if (operation === "delete") ranges.push({ ...range, newText: "", order });
    else if (operation === "insert_before") ranges.push({ from: range.from, to: range.from, newText: requireEditText(edit.text ?? edit.newText, "text"), order });
    else ranges.push({ from: range.to, to: range.to, newText: requireEditText(edit.text ?? edit.newText, "text"), order });
  });

  ranges.sort((a, b) => a.from - b.from || a.order - b.order);
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i].from < ranges[i - 1].to) throw new Error("Plan edit blocks must not overlap.");
  }

  let next = "";
  let cursor = 0;
  for (const range of ranges) {
    next += markdown.slice(cursor, range.from) + range.newText;
    cursor = range.to;
  }
  return normalizeStoredPlanMarkdown(next + markdown.slice(cursor));
}

function normalizePatchOperation(value: unknown): PlanPatchOperation {
  if (value === "add" || value === "update" || value === "remove") return value;
  throw new Error("Each plan patch needs operation add, update, or remove.");
}

function normalizePatchPosition(value: unknown): PlanPatchPosition | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "start" || value === "end") return value;
  throw new Error("Plan patch position must be start or end.");
}

function planPatchTargetIndex(items: UpdatePlanItem[], patch: Partial<PlanPatchBlock>, label = "patch"): number {
  if (typeof patch.index === "number" && Number.isInteger(patch.index)) {
    const index = patch.index - 1;
    if (index < 0 || index >= items.length) throw new Error(`Plan ${label} index ${patch.index} is out of range.`);
    return index;
  }
  const match = normalizePlanStep(patch.match);
  if (!match) throw new Error(`Plan ${label} needs index or match.`);
  const matches = items
    .map((item, index) => ({ index, item }))
    .filter(({ item }) => item.step === match || item.step.includes(match));
  if (matches.length !== 1) throw new Error(`Plan ${label} match must identify exactly one item; got ${matches.length} matches for ${JSON.stringify(match)}.`);
  return matches[0].index;
}

function planPatchInsertIndex(items: UpdatePlanItem[], patch: Partial<PlanPatchBlock>): number {
  const position = normalizePatchPosition(patch.position);
  if (position === "start") return 0;
  if (position === "end") return items.length;
  const before = normalizePlanStep(patch.before);
  if (before) return planPatchTargetIndex(items, { match: before }, "patch before") ;
  const after = normalizePlanStep(patch.after);
  if (after) return planPatchTargetIndex(items, { match: after }, "patch after") + 1;
  return items.length;
}

export function applyPlanPatches(markdownInput: unknown, patchesInput: unknown): string {
  const patches = Array.isArray(patchesInput) ? patchesInput : [];
  if (!patches.length) throw new Error("plan action=patch requires at least one patch block.");
  const parsed = parsePlanMarkdown(markdownInput);
  const items = parsed.plan.map((item) => ({ ...item }));

  patches.forEach((raw, order) => {
    const patch = raw && typeof raw === "object" ? raw as Partial<PlanPatchBlock> : {};
    const operation = normalizePatchOperation(patch.operation);
    if (operation === "add") {
      const step = normalizePlanStep(patch.step);
      if (!step) throw new Error(`Plan patch ${order + 1} add requires step.`);
      const status = patch.status === undefined ? "pending" : normalizePlanStatus(patch.status);
      items.splice(planPatchInsertIndex(items, patch), 0, { step, status });
      return;
    }
    const index = planPatchTargetIndex(items, patch, `patch ${order + 1}`);
    if (operation === "remove") {
      items.splice(index, 1);
      return;
    }
    const nextStep = patch.step === undefined ? items[index].step : normalizePlanStep(patch.step);
    if (!nextStep) throw new Error(`Plan patch ${order + 1} update step must not be empty.`);
    const nextStatus = patch.status === undefined ? items[index].status : normalizePlanStatus(patch.status);
    items[index] = { step: nextStep, status: nextStatus };
  });

  return updatePlanArgsToMarkdown({ explanation: parsed.explanation || undefined, plan: items });
}

export function buildPlanSystemPrompt(plan: SessionPlan): string {
  const markdown = normalizeLineEndings(plan.markdown).trim();
  if (!markdown) return "";
  return [
    "## Plan Sidebar",
    `The current session has a Plan sidebar checklist for ${plan.chat_jid}.`,
    "This checklist is editable shared state, not static context: you can modify it and must keep it current as work proceeds.",
    "Use the `plan` tool with `action=patch` for easy multi-item changes: pass `patches: [{ operation: 'add'|'update'|'remove', index?, match?, step?, status?, before?, after?, position? }]` to add, edit, reorder-by-insertion, or remove several checklist items in one call without exact Markdown line edits.",
    "Use `action=update` for structured full-plan replacement: pass `plan: [{ step, status }]` with status `pending`, `in_progress`, or `completed`; at most one step may be `in_progress`.",
    "Use `action=read` to inspect raw Markdown, `action=edit` for batch exact Markdown edits (replace/delete/insert_after/insert_before/append/prepend, including multi-line checklist blocks), and `action=write` only when replacing the whole Markdown checklist.",
    "All plan mutations are normalized into the same Markdown storage. Treat `[x]` items as completed, `[-]` items as in progress, unchecked items as pending, and update the plan after meaningful progress or plan changes.",
    "There may be at most one `[-]` / `in_progress` item.",
    "Read the current checklist with `plan` action=read when its exact state is needed; mutable checklist content is kept out of the system prompt to preserve provider prompt-cache reuse.",
  ].join("\n");
}

export function buildPlanTurnMessage(plan: SessionPlan): { customType: string; content: Array<{ type: "text"; text: string }>; display: boolean } | undefined {
  const markdown = normalizeLineEndings(plan.markdown).trim();
  if (!markdown) return undefined;
  return {
    customType: "plan_sidebar_context",
    content: [{ type: "text", text: `Current Plan Sidebar checklist for ${plan.chat_jid}:\n\n${markdown}` }],
    display: false,
  };
}
