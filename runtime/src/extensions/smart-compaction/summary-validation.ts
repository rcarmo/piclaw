import { MIN_SUMMARY_CHARS } from "./config.js";

export type CompactionSummarySchema = "final" | "chunk";

export interface CompactionSummaryValidationSuccess {
  ok: true;
  text: string;
  stopReason: "stop";
}

export interface CompactionSummaryValidationFailure {
  ok: false;
  code:
    | "stop_reason"
    | "missing_text"
    | "too_short"
    | "too_large"
    | "missing_heading"
    | "duplicate_heading"
    | "unexpected_heading"
    | "leading_content"
    | "heading_order"
    | "empty_section"
    | "invalid_progress_structure"
    | "invalid_terminal_section"
    | "invalid_file_sections";
  reason: string;
  retryable: boolean;
  stopReason: string;
}

export type CompactionSummaryValidation =
  | CompactionSummaryValidationSuccess
  | CompactionSummaryValidationFailure;

export interface CompactionSummaryValidationOptions {
  /**
   * Model-authored file blocks are disposable because deterministic tool
   * analysis supplies the authoritative blocks after validation.
   */
  modelFileBlocks?: "strict" | "discard";
}

const FINAL_HEADINGS = [
  "Goal",
  "Current Active Topic",
  "Historical / Background Context",
  "Constraints & Preferences",
  "Progress",
  "Key Decisions",
  "Next Steps",
  "Critical Context",
] as const;

const CHUNK_HEADINGS = [
  "Chunk Range",
  "Goals / User Intent",
  "Constraints & Preferences",
  "Decisions",
  "Files / Commands / Tool Outcomes",
  "Progress",
  "Open Questions / Next Steps",
  "Key Continuity Facts",
] as const;

const REQUIRED_NON_EMPTY: Record<CompactionSummarySchema, readonly string[]> = {
  final: ["Goal", "Progress", "Critical Context"],
  chunk: ["Goals / User Intent", "Progress", "Key Continuity Facts"],
};

function failure(
  code: CompactionSummaryValidationFailure["code"],
  reason: string,
  stopReason: string,
  retryable = true,
): CompactionSummaryValidationFailure {
  return { ok: false, code, reason, retryable, stopReason };
}

function extractResponseText(response: any): string {
  if (!Array.isArray(response?.content)) return "";
  return response.content
    .filter((block: any) => block?.type === "text" && typeof block.text === "string")
    .map((block: any) => block.text)
    .join("\n")
    .trim();
}

function normalizeModelFileBlocks(
  rawText: string,
  schema: CompactionSummarySchema,
  stopReason: string,
): { ok: true; text: string } | CompactionSummaryValidationFailure {
  const tagLikeMatches = [...rawText.matchAll(/<\/?(?:read-files|modified-files)\b[^>\n]*(?:>|$)/gi)];
  if (tagLikeMatches.length === 0) return { ok: true, text: rawText };
  for (const match of tagLikeMatches) {
    if (!/^<\/?(?:read-files|modified-files)>$/i.test(match[0])) {
      return failure("invalid_file_sections", `malformed deterministic file tag: ${match[0]}`, stopReason);
    }
  }

  const terminalHeadingName = schema === "final" ? "Critical Context" : "Key Continuity Facts";
  const terminalHeading = new RegExp(`^##\\s+${terminalHeadingName}\\s*$`, "gm").exec(rawText);
  if (!terminalHeading) return { ok: true, text: rawText };
  const terminalBodyStart = (terminalHeading.index ?? 0) + terminalHeading[0].length;
  const ranges: Array<{ start: number; end: number }> = [];
  let active: { tag: "read-files" | "modified-files"; start: number; bodyStart: number } | null = null;

  for (const match of tagLikeMatches) {
    const token = match[0];
    const tagMatch = token.match(/^<\/?(read-files|modified-files)>$/i)!;
    const tag = tagMatch[1].toLowerCase() as "read-files" | "modified-files";
    const index = match.index ?? -1;
    const closing = token.startsWith("</");
    if (!closing) {
      if (active) {
        return failure("invalid_file_sections", "deterministic file blocks must not overlap or nest", stopReason);
      }
      active = { tag, start: index, bodyStart: index + token.length };
      continue;
    }
    if (!active || active.tag !== tag || index <= active.start) {
      return failure("invalid_file_sections", `${tag} must have balanced opening/closing pairs`, stopReason);
    }
    if (active.start < terminalBodyStart) {
      return failure("invalid_file_sections", `${tag} blocks must appear after ## ${terminalHeadingName}`, stopReason);
    }
    if (!rawText.slice(active.bodyStart, index).trim()) {
      return failure("invalid_file_sections", `${tag} block is empty`, stopReason);
    }
    ranges.push({ start: active.start, end: index + token.length });
    active = null;
  }
  if (active) {
    return failure("invalid_file_sections", `${active.tag} must have balanced opening/closing pairs`, stopReason);
  }

  for (let index = 1; index < ranges.length; index += 1) {
    if (rawText.slice(ranges[index - 1].end, ranges[index].start).trim()) {
      return failure("invalid_file_sections", "deterministic file blocks must form one trailing group", stopReason);
    }
  }
  if (ranges.length > 0 && rawText.slice(ranges.at(-1)!.end).trim()) {
    return failure("invalid_file_sections", "deterministic file blocks must be trailing", stopReason);
  }

  let text = rawText;
  for (const range of [...ranges].reverse()) {
    text = `${text.slice(0, range.start).trimEnd()}\n${text.slice(range.end).trimStart()}`;
  }
  return { ok: true, text: text.trim() };
}

function discardModelFileBlocks(rawText: string): string {
  const matches = [...rawText.matchAll(/<\/?(?:read-files|modified-files)\b[^>\n]*(?:>|$)/gi)];
  if (matches.length === 0) return rawText;

  const stack: Array<"read-files" | "modified-files"> = [];
  let cursor = 0;
  let text = "";
  for (const match of matches) {
    const index = match.index ?? cursor;
    if (stack.length === 0) text += rawText.slice(cursor, index);
    const tag = /modified-files/i.test(match[0]) ? "modified-files" : "read-files";
    const closing = /^<\//.test(match[0]);
    if (!closing) {
      stack.push(tag);
    } else if (stack.at(-1) === tag) {
      stack.pop();
    }
    // A mismatched close never pops another tag type. This keeps all content
    // inside the original opener disposable until its matching close or EOF.
    cursor = index + match[0].length;
  }
  // An unbalanced opening tag makes the remaining model-authored suffix
  // disposable. A dangling close outside a block removes only the tag token.
  if (stack.length === 0) text += rawText.slice(cursor);
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeChunkHeadingAliases(text: string): string {
  return text.replace(/^##\s+Key Decisions\s*$/gmi, "## Decisions");
}

function normalizeChunkProgressLabels(text: string): string {
  const progressMatch = /^##\s+Progress\s*$([\s\S]*?)(?=^##\s+|(?![\s\S]))/gmi.exec(text);
  if (!progressMatch) return text;
  const body = progressMatch[1].trim();
  const buckets: Record<"done" | "inProgress" | "blocked", string[]> = {
    done: [],
    inProgress: [],
    blocked: [],
  };
  const marker = /^(?:###\s+|[-*]\s*)?(Done|Completed|In progress|In-progress|Current|Ongoing|Blocked|Blockers)\s*:?[ \t]*(.*)$/i;
  let active: keyof typeof buckets | null = null;
  const prelude: string[] = [];
  for (const line of body.split("\n")) {
    const match = line.trim().match(marker);
    if (match) {
      const label = match[1].toLowerCase();
      active = label === "done" || label === "completed"
        ? "done"
        : label === "blocked" || label === "blockers"
          ? "blocked"
          : "inProgress";
      if (match[2].trim()) buckets[active].push(match[2].trim());
      continue;
    }
    (active ? buckets[active] : prelude).push(line);
  }
  if (prelude.some((line) => line.trim())) buckets.inProgress.unshift(...prelude);

  const render = (label: string, lines: string[]): string => {
    const meaningful = lines.map((line) => line.trimEnd()).filter((line) => line.trim());
    if (meaningful.length === 0) return `- ${label}: (none reported)`;
    return [`- ${label}: ${meaningful[0].trim()}`, ...meaningful.slice(1).map((line) => `  ${line.trim()}`)].join("\n");
  };
  const normalized = [
    render("Done", buckets.done),
    render("In progress", buckets.inProgress),
    render("Blocked", buckets.blocked),
  ].join("\n");
  const bodyOffset = progressMatch.index! + progressMatch[0].indexOf(progressMatch[1]);
  return `${text.slice(0, bodyOffset)}\n${normalized}\n\n${text.slice(bodyOffset + progressMatch[1].length).trimStart()}`.trim();
}

function hasSubstantiveSectionContent(content: string): boolean {
  return content
    .replace(/^###\s+.*$/gm, "")
    .replace(/^[-*]\s*(?:\[[ xX]\]\s*)?/gm, "")
    .replace(/^\d+\.\s*/gm, "")
    .trim().length > 0;
}

/** Validate both provider completion state and schema completeness before persistence. */
export function validateCompactionSummaryResponse(
  response: any,
  schema: CompactionSummarySchema,
  maxChars: number,
  options: CompactionSummaryValidationOptions = {},
): CompactionSummaryValidation {
  const stopReason = typeof response?.stopReason === "string" ? response.stopReason : "missing";
  if (stopReason !== "stop") {
    return failure(
      "stop_reason",
      `completion stop reason was ${stopReason}; expected stop`,
      stopReason,
      stopReason === "length",
    );
  }

  const rawText = extractResponseText(response);
  if (!rawText) return failure("missing_text", "completion contained no text", stopReason);
  if (options.modelFileBlocks !== "discard" && rawText.length > maxChars) {
    return failure("too_large", `summary was ${rawText.length} characters; maximum is ${maxChars}`, stopReason);
  }
  const normalizedFiles = options.modelFileBlocks === "discard"
    ? { ok: true as const, text: discardModelFileBlocks(rawText) }
    : normalizeModelFileBlocks(rawText, schema, stopReason);
  if (!normalizedFiles.ok) return normalizedFiles;
  const text = schema === "chunk"
    ? normalizeChunkProgressLabels(normalizeChunkHeadingAliases(normalizedFiles.text))
    : normalizedFiles.text;
  if (options.modelFileBlocks === "discard" && text.length > maxChars) {
    return failure("too_large", `summary was ${text.length} characters; maximum is ${maxChars}`, stopReason);
  }
  if (text.length < MIN_SUMMARY_CHARS) {
    return failure("too_short", `summary was ${text.length} characters; minimum is ${MIN_SUMMARY_CHARS}`, stopReason);
  }

  const expected = schema === "final" ? FINAL_HEADINGS : CHUNK_HEADINGS;
  const headingMatches = [...text.matchAll(/^##\s+([^\n]+?)\s*$/gm)].map((match) => ({
    heading: match[1].trim(),
    index: match.index ?? 0,
    bodyStart: (match.index ?? 0) + match[0].length,
  }));

  if (headingMatches.length > 0 && text.slice(0, headingMatches[0].index).trim()) {
    return failure("leading_content", "commentary appeared before the first required heading", stopReason);
  }
  for (const heading of expected) {
    const matches = headingMatches.filter((candidate) => candidate.heading === heading);
    if (matches.length === 0) {
      return failure("missing_heading", `missing required heading: ## ${heading}`, stopReason);
    }
    if (matches.length > 1) {
      return failure("duplicate_heading", `duplicated required heading: ## ${heading}`, stopReason);
    }
  }
  const unexpected = headingMatches.find((candidate) => !expected.includes(candidate.heading as any));
  if (unexpected) {
    return failure("unexpected_heading", `unexpected top-level heading: ## ${unexpected.heading}`, stopReason);
  }

  const expectedPositions = expected.map((heading) => headingMatches.findIndex((candidate) => candidate.heading === heading));
  for (let i = 1; i < expectedPositions.length; i++) {
    if (expectedPositions[i] <= expectedPositions[i - 1]) {
      return failure("heading_order", `required heading is out of order: ## ${expected[i]}`, stopReason);
    }
  }

  const sectionContent = new Map<string, string>();
  for (const heading of REQUIRED_NON_EMPTY[schema]) {
    const position = headingMatches.findIndex((candidate) => candidate.heading === heading);
    const match = headingMatches[position];
    const next = headingMatches[position + 1];
    const content = text.slice(match.bodyStart, next?.index ?? text.length);
    sectionContent.set(heading, content);
    if (!hasSubstantiveSectionContent(content)) {
      return failure("empty_section", `required section is empty: ## ${heading}`, stopReason);
    }
  }

  const progress = sectionContent.get("Progress") ?? "";
  if (schema === "final") {
    const progressHeadings = [...progress.matchAll(/^###\s+(Done|In Progress|Blocked)\s*$/gmi)].map((match) => match[1].toLowerCase());
    if (progressHeadings.join(",") !== "done,in progress,blocked") {
      return failure("invalid_progress_structure", "## Progress must contain ### Done, ### In Progress, and ### Blocked exactly once and in order", stopReason);
    }
  } else {
    const labels = [...progress.matchAll(/^[-*]\s*(Done|In progress|Blocked)\s*:/gmi)].map((match) => match[1].toLowerCase());
    if (labels.join(",") !== "done,in progress,blocked") {
      return failure("invalid_progress_structure", "chunk ## Progress must contain Done, In progress, and Blocked list items exactly once and in order", stopReason);
    }
  }

  const terminalHeading = schema === "final" ? "Critical Context" : "Key Continuity Facts";
  const terminal = sectionContent.get(terminalHeading) ?? "";
  const invalidTerminalLine = terminal
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !/^(?:[-*]\s+|\d+\.\s+|###\s+|<\/?(?:read-files|modified-files)>)/.test(line));
  if (invalidTerminalLine) {
    return failure("invalid_terminal_section", `unexpected commentary after ## ${terminalHeading}`, stopReason);
  }

  return { ok: true, text, stopReason: "stop" };
}

export function buildCompactionRepairInstruction(
  schema: CompactionSummarySchema,
  reason: string,
  maxTokens?: number,
): string {
  const format = schema === "final"
    ? FINAL_HEADINGS.map((heading) => `## ${heading}`).join("\n")
    : CHUNK_HEADINGS.map((heading) => `## ${heading}`).join("\n");
  const lengthCap = /stop reason was length/i.test(reason)
    ? ` The previous response hit the provider output limit; fit the complete summary within ${Math.max(1, Math.floor(maxTokens ?? 0))} output tokens by using only compact bullets and omitting narrative repetition.`
    : "";
  return `\n\n## Output Repair Requirement\nThe previous completion was rejected: ${reason}.${lengthCap} Return one concise, complete summary only. End normally with stopReason=stop. Include every heading exactly once and in this order:\n${format}\nDo not include commentary before or after the summary.`;
}
