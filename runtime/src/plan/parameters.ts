import { Type } from "typebox";

export const planParameters = Type.Object({
  action: Type.String({
    enum: ["read", "write", "edit", "patch", "update"],
    description: "Use read to inspect the active session plan, patch for easy multi-item add/update/remove operations, update for structured full-plan updates, write for full Markdown replacement, or edit for exact atomic text replacements.",
  }),
  explanation: Type.Optional(Type.String({ description: "Optional concise explanation for action=update." })),
  plan: Type.Optional(Type.Array(Type.Object({
    step: Type.String({ description: "A concrete plan step for action=update." }),
    status: Type.String({
      enum: ["pending", "in_progress", "completed"],
      description: "One of: pending, in_progress, completed.",
    }),
  }), { description: "The full current structured plan for action=update. At most one step may be in_progress." })),
  markdown: Type.Optional(Type.String({ description: "Complete Markdown checklist to save when action is write." })),
  edits: Type.Optional(Type.Array(Type.Object({
    operation: Type.Optional(Type.String({
      enum: ["replace", "delete", "insert_after", "insert_before", "append", "prepend"],
      description: "Edit operation. Defaults to replace when oldText and newText are provided.",
    })),
    oldText: Type.Optional(Type.String({ description: "Legacy/exact text to replace or delete. Must occur exactly once for replace/delete." })),
    newText: Type.Optional(Type.String({ description: "Replacement text for replace, or alias for text on insert/append/prepend." })),
    anchorText: Type.Optional(Type.String({ description: "Exact anchor text for insert_after or insert_before. Must occur exactly once." })),
    text: Type.Optional(Type.String({ description: "Text to insert for insert_after, insert_before, append, or prepend." })),
  }), { description: "Batch edits to apply when action is edit. Supports replace/delete/insert_after/insert_before/append/prepend; multiple checklist items and multi-line text are allowed in one call." })),
  patches: Type.Optional(Type.Array(Type.Object({
    operation: Type.String({
      enum: ["add", "update", "remove"],
      description: "Patch operation for action=patch. Use add/update/remove to change multiple plan items without exact Markdown line edits.",
    }),
    index: Type.Optional(Type.Number({ description: "Optional 1-based checklist item index for update/remove." })),
    match: Type.Optional(Type.String({ description: "Optional unique exact-or-substring match against an existing step for update/remove." })),
    step: Type.Optional(Type.String({ description: "New step text for add, or replacement step text for update." })),
    status: Type.Optional(Type.String({
      enum: ["pending", "in_progress", "completed"],
      description: "Optional item status. Defaults to pending for add and current status for update.",
    })),
    position: Type.Optional(Type.String({
      enum: ["start", "end"],
      description: "Optional add position. Defaults to end.",
    })),
    before: Type.Optional(Type.String({ description: "For add, insert before the unique step matching this text." })),
    after: Type.Optional(Type.String({ description: "For add, insert after the unique step matching this text." })),
  }), { description: "Structured item patches for action=patch. Allows multiple add/update/remove operations in one call using indexes or step matches; normalized like all plan writes." })),
  chat_jid: Type.Optional(Type.String({ description: "Optional explicit chat/session JID. Defaults to the active session." })),
});
