import { Type } from 'typebox';

export const delegateDescription =
  'Delegate a task to a cheaper/faster model in a fresh context. ' +
  'The delegate has its own tool access (read, grep, bash, etc.) but no conversation history. ' +
  'Use for: summarizing files, quick questions, code generation, data extraction, codebase exploration, ' +
  "or any task that doesn't require the full conversation context. " +
  'Every automatic, explicit, and fallback attempt is restricted to the Settings-approved candidate list; ' +
  "automatic selection also never exceeds the current model's classified tier.";

export const delegateParameters = Type.Object({
  prompt: Type.String({ description: 'The task to delegate. Be specific — the delegate has no conversation history.' }),
  task_category: Type.Optional(Type.String({
    enum: ['quick', 'summarize', 'code', 'analyze', 'reason', 'judge'],
    description: 'Task category: quick, summarize, code, analyze, reason, or judge. Default: summarize.',
  })),
  model: Type.Optional(Type.String({ description: 'Exact approved provider/model selection. It must appear in Settings → Delegate → Approved delegate models. It can bypass automatic tier selection but cannot bypass provider approval, ordered model classification, exclusions, executability, or image-capability checks.' })),
  files: Type.Optional(Type.Array(Type.String(), { description: 'Workspace files to include. Text is inlined up to 100KB; only native PNG, JPEG, GIF, WebP, and BMP images are attached.' })),
  tools: Type.Optional(Type.String({ description: 'Tool profile (read_only, standard, full) or a comma-separated child Pi built-in list. MCP is available only when its explicit adapter is installed. Default: standard.' })),
  system_prompt: Type.Optional(Type.String({ description: 'Custom system prompt override.' })),
  timeout_sec: Type.Optional(Type.Integer({ description: 'Timeout in seconds. Default: 120', minimum: 10, maximum: 300 })),
});
