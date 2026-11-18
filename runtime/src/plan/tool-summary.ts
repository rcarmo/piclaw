const quoted = (text: string) => `‘${text.replace(/\s+/g, " ").trim()}’`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** One line for a plan tool call: what it read or changed. */
export function summarisePlanCall(input: unknown): string | null {
  const record = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const action = typeof record.action === "string" ? record.action : "";
  if (action === "read") return "read the checklist";
  if (action === "update" && Array.isArray(record.plan)) {
    const steps = record.plan.filter((item): item is { step?: unknown; status?: unknown } => Boolean(item) && typeof item === "object");
    const done = steps.filter((item) => item.status === "completed").length;
    const current = steps.find((item) => item.status === "in_progress" && typeof item.step === "string");
    return `${done}/${steps.length} done${current ? `, now ${quoted(String(current.step))}` : ""}`;
  }
  if (action === "patch" && Array.isArray(record.patches)) {
    const parts = record.patches.flatMap((patch) => {
      if (!patch || typeof patch !== "object") return [];
      const item = patch as { operation?: unknown; index?: unknown; match?: unknown; step?: unknown; status?: unknown };
      const target = typeof item.match === "string" && item.match.trim() ? quoted(item.match)
        : typeof item.index === "number" ? `step ${item.index}`
          : typeof item.step === "string" && item.step.trim() ? quoted(item.step) : "a step";
      if (item.operation === "add") return [`added ${typeof item.step === "string" && item.step.trim() ? quoted(item.step) : "a step"}`];
      if (item.operation === "remove") return [`removed ${target}`];
      if (item.operation !== "update") return [];
      if (item.status === "completed") return [`completed ${target}`];
      if (item.status === "in_progress") return [`started ${target}`];
      if (item.status === "pending") return [`reopened ${target}`];
      return typeof item.step === "string" ? [`reworded ${target}`] : [];
    });
    return parts.length ? parts.join(", ") : null;
  }
  if (action === "write" && typeof record.markdown === "string") {
    return `wrote ${plural(record.markdown.split("\n").filter((line) => /^\s*[-*]\s+\[[ xX-]\]/.test(line)).length, "step")}`;
  }
  if (action === "edit" && Array.isArray(record.edits)) return `edited the checklist (${plural(record.edits.length, "change")})`;
  return null;
}
