import { expect, test } from "bun:test";

import type { AttachmentInfo } from "../../src/agent-pool/attachments.js";
import { AgentTurnCoordinator } from "../../src/agent-pool/turn-coordinator.js";

const sampleAttachment: AttachmentInfo = {
  id: 1,
  name: "note.txt",
  contentType: "text/plain",
  size: 4,
  kind: "file",
  sourcePath: "/tmp/note.txt",
};

test("AgentTurnCoordinator tracks streamed turns and fallback assistant text after a completed message boundary", () => {
  const attachmentBatches: AttachmentInfo[][] = [[sampleAttachment], []];
  const completed: Array<{ text: string; attachments: AttachmentInfo[] }> = [];

  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => attachmentBatches.shift() ?? [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const tracker = coordinator.createTracker("web:default", (turn) => completed.push(turn));

  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "hello",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_1", phase: "final_answer" }) }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hello", textSignature: JSON.stringify({ v: 1, id: "msg_1", phase: "final_answer" }) }],
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_start",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_2", phase: "final_answer" }) }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "fallback answer", textSignature: JSON.stringify({ v: 1, id: "msg_2", phase: "final_answer" }) }],
    },
  } as any);

  expect(completed).toEqual([{ text: "hello", attachments: [sampleAttachment] }]);
  expect(tracker.getTurnCount()).toBe(1);
  expect(tracker.getFinalText()).toBe("fallback answer");
});

test("AgentTurnCoordinator trusts finalized message_end text over streamed draft text", () => {
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const tracker = coordinator.createTracker("web:default");
  const signature = JSON.stringify({ v: 1, id: "msg_1", phase: "final_answer" });

  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "streamed draft",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: signature }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "final replacement", textSignature: signature }],
    },
  } as any);

  expect(tracker.getFinalText()).toBe("final replacement");
});

test("AgentTurnCoordinator preserves raw provider stop reasons for diagnostics", () => {
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });
  const tracker = coordinator.createTracker("web:default");

  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "error",
      rawStopReason: "content_filter_vendor_x",
      errorMessage: "Provider stopped with an unmapped terminal reason",
      content: [],
    },
  } as any);

  expect(tracker.getLastAssistantState()).toEqual(expect.objectContaining({
    stopReason: "error",
    rawStopReason: "content_filter_vendor_x",
  }));
  expect(tracker.getError()?.errorMessage).toContain("unmapped terminal reason");
});

test("AgentTurnCoordinator discards commentary-only text without exposing hidden thinking", () => {
  const discarded: Array<{ reason: string }> = [];
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const tracker = coordinator.createTracker("web:default", undefined, (discard) => discarded.push(discard));

  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_start",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_c", phase: "commentary" }) }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "progress update",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_c", phase: "commentary" }) }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private chain of thought" },
        { type: "text", text: "progress update", textSignature: JSON.stringify({ v: 1, id: "msg_c", phase: "commentary" }) },
      ],
    },
  } as any);

  expect(tracker.getFinalText()).toBe("");
  expect(discarded).toEqual([{ reason: "commentary_only" }]);
  expect(tracker.getTurnCount()).toBe(0);
});

test("AgentTurnCoordinator does not flush completed commentary before a later final answer", () => {
  const completed: Array<{ text: string; attachments: AttachmentInfo[] }> = [];
  const discarded: Array<{ reason: string }> = [];
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const tracker = coordinator.createTracker(
    "web:default",
    (turn) => completed.push(turn),
    (discard) => discarded.push(discard),
  );

  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_start",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_c", phase: "commentary" }) }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "progress",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_c", phase: "commentary" }) }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "progress", textSignature: JSON.stringify({ v: 1, id: "msg_c", phase: "commentary" }) }],
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_start",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_f", phase: "final_answer" }) }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "done",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_f", phase: "final_answer" }) }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "done", textSignature: JSON.stringify({ v: 1, id: "msg_f", phase: "final_answer" }) }],
    },
  } as any);

  expect(completed).toEqual([]);
  expect(discarded).toEqual([{ reason: "commentary_only" }]);
  expect(tracker.getTurnCount()).toBe(0);
  expect(tracker.getFinalText()).toBe("done");
});

test("AgentTurnCoordinator keeps only signed final-answer text from mixed-phase content", () => {
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });
  const tracker = coordinator.createTracker("web:default");
  const commentarySignature = JSON.stringify({ phase: "commentary" });
  const finalSignature = JSON.stringify({ phase: "final_answer" });

  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "text", text: "Searching saved output. ", textSignature: commentarySignature },
        { type: "text", text: "Inspecting nearby events. ", textSignature: commentarySignature },
        { type: "text", text: "The final result is ready.", textSignature: finalSignature },
      ],
    },
  } as any);

  expect(tracker.getFinalText()).toBe("The final result is ready.");
});

test("AgentTurnCoordinator preserves unphased text while filtering signed commentary", () => {
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });
  const tracker = coordinator.createTracker("web:default");

  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "text", text: "Transient planning. ", textSignature: JSON.stringify({ phase: "commentary" }) },
        { type: "text", text: "Legacy visible answer." },
      ],
    },
  } as any);

  expect(tracker.getFinalText()).toBe("Legacy visible answer.");
});

test("AgentTurnCoordinator discards dangling commentary when an attempt ends without message_end", () => {
  const discarded: Array<{ reason: string }> = [];
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });
  const tracker = coordinator.createTracker("web:default", undefined, (discard) => discarded.push(discard));
  const signature = JSON.stringify({ phase: "commentary" });

  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "Still investigating.",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: signature }] },
    },
  } as any);

  tracker.finalizeAttempt();

  expect(tracker.getFinalText()).toBe("");
  expect(discarded).toEqual([{ reason: "commentary_only" }]);
});

test("AgentTurnCoordinator subscribes and downgrades handler failures to warnings", () => {
  let listener: ((event: unknown) => void) | null = null;
  let touched = 0;
  const warns: string[] = [];

  const session = {
    subscribe(callback: (event: unknown) => void) {
      listener = callback;
      return () => {
        listener = null;
      };
    },
  };

  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {
      touched += 1;
    },
    onWarn: (message) => warns.push(message),
  });

  const tracker = coordinator.createTracker("web:default");
  const unsub = coordinator.subscribe(session as any, "web:default", tracker, () => {
    throw new Error("boom");
  });

  listener?.({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "done" }] },
  });

  expect(touched).toBe(1);
  expect(warns).toContain("Event handler error");

  unsub();
  expect(listener).toBeNull();
});

test("AgentTurnCoordinator does not flush an incomplete turn when a new text_start arrives before message_end", () => {
  const completed: Array<{ text: string; attachments: AttachmentInfo[] }> = [];
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const tracker = coordinator.createTracker("web:default", (turn) => completed.push(turn));

  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_start",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_1", phase: "final_answer" }) }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "hello",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_1", phase: "final_answer" }) }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_start",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_2", phase: "final_answer" }) }] },
    },
  } as any);

  expect(completed).toEqual([]);
  expect(tracker.getTurnCount()).toBe(0);

  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "fallback answer", textSignature: JSON.stringify({ v: 1, id: "msg_2", phase: "final_answer" }) }],
    },
  } as any);

  expect(completed).toEqual([]);
  expect(tracker.getTurnCount()).toBe(0);
  expect(tracker.getFinalText()).toBe("fallback answer");
});

test("AgentTurnCoordinator commits assistant text as soon as its tool-use message completes", () => {
  const completed: Array<{ text: string; attachments: AttachmentInfo[]; followedByToolUse?: boolean }> = [];
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const tracker = coordinator.createTracker("web:default", (turn) => completed.push(turn));

  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_start",
      contentIndex: 0,
      partial: { content: [{ type: "text" }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "Now let me inspect that file:",
      contentIndex: 0,
      partial: { content: [{ type: "text" }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "text", text: "Now let me inspect that file:" },
        { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "/tmp/x" } },
      ],
    },
  } as any);

  expect(completed).toEqual([{
    text: "Now let me inspect that file:",
    attachments: [],
    followedByToolUse: true,
  }]);
  expect(tracker.getTurnCount()).toBe(1);
  expect(tracker.getFinalText()).toBe("");

  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_start",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: JSON.stringify({ v: 1, id: "msg_f", phase: "final_answer" }) }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "done", textSignature: JSON.stringify({ v: 1, id: "msg_f", phase: "final_answer" }) }],
    },
  } as any);

  expect(completed).toEqual([{
    text: "Now let me inspect that file:",
    attachments: [],
    followedByToolUse: true,
  }]);
  expect(tracker.getTurnCount()).toBe(1);
  expect(tracker.getFinalText()).toBe("done");
  expect(tracker.getLastAssistantState()).toEqual(expect.objectContaining({
    stopReason: null,
    hadToolCallContent: false,
  }));
});

test("AgentTurnCoordinator discards signed commentary at a tool-use boundary", () => {
  const completed: Array<{ text: string; attachments: AttachmentInfo[]; followedByToolUse?: boolean }> = [];
  const discarded: Array<{ reason: string }> = [];
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });
  const tracker = coordinator.createTracker(
    "web:default",
    (turn) => completed.push(turn),
    (discard) => discarded.push(discard),
  );

  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_start",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: JSON.stringify({ phase: "commentary" }) }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "The review is complete; I will now apply the patch.",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: JSON.stringify({ phase: "commentary" }) }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "text", text: "Need inspect logs then retry.", textSignature: JSON.stringify({ phase: "commentary" }) },
        { type: "toolCall", id: "tool-1", name: "edit", arguments: {} },
      ],
    },
  } as any);
  expect(completed).toEqual([]);
  expect(discarded).toEqual([{ reason: "tool_use_commentary" }]);
  expect(tracker.getFinalText()).toBe("");

  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: { type: "text_start", contentIndex: 0, partial: { content: [{ type: "text" }] } },
  } as any);

  expect(completed).toHaveLength(0);
  expect(tracker.getTurnCount()).toBe(0);
});

test("AgentTurnCoordinator commits explicit final-answer text at a tool-use boundary", () => {
  const completed: Array<{ text: string; attachments: AttachmentInfo[]; followedByToolUse?: boolean }> = [];
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });
  const tracker = coordinator.createTracker("web:default", (turn) => completed.push(turn));
  const signature = JSON.stringify({ phase: "final_answer" });

  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta: "I have finished the requested action.",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: signature }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "text", text: "I have finished the requested action.", textSignature: signature },
        { type: "toolCall", id: "tool-1", name: "send_message", arguments: {} },
      ],
    },
  } as any);

  expect(completed).toEqual([{
    text: "I have finished the requested action.",
    attachments: [],
    followedByToolUse: true,
  }]);
  expect(tracker.getFinalText()).toBe("");
});

test("AgentTurnCoordinator clears a completed tool-use lead-in even without a turn callback", () => {
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });
  const tracker = coordinator.createTracker("web:default");

  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "I will inspect that." },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "text", text: "I will inspect that." },
        { type: "toolCall", id: "tool-1", name: "read", arguments: {} },
      ],
    },
  } as any);

  expect(tracker.getFinalText()).toBe("");
  expect(tracker.getTurnCount()).toBe(0);
});

test("AgentTurnCoordinator does not commit a tool-call block without a toolUse stop", () => {
  const completed: Array<{ text: string; attachments: AttachmentInfo[] }> = [];
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });
  const tracker = coordinator.createTracker("web:default", (turn) => completed.push(turn));

  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "Final answer" },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "text", text: "Final answer" },
        { type: "toolCall", id: "malformed-tool", name: "read", arguments: {} },
      ],
    },
  } as any);

  expect(completed).toEqual([]);
  expect(tracker.getFinalText()).toBe("Final answer");
});

test("AgentTurnCoordinator captures provider error from assistant message_end", () => {
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const tracker = coordinator.createTracker("web:default");

  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "error",
      errorMessage:
        'Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"You\'re out of extra usage. Add more at claude.ai/settings/usage and keep going."},"request_id":"req_011Ca3hFFk6E3FKGv1Hv52K9"}',
      content: [],
    },
  } as any);

  expect(tracker.getFinalText()).toBe("");
  expect(tracker.getError()).not.toBeNull();
  expect(tracker.getError()?.stopReason).toBe("error");
  expect(tracker.getError()?.errorMessage).toContain("invalid_request_error");
  expect(tracker.getError()?.errorMessage).toContain("extra usage");
});

test("AgentTurnCoordinator discards commentary on error and lets a later final answer supersede it", () => {
  const completed: Array<{ text: string }> = [];
  const discarded: Array<{ reason: string }> = [];
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });
  const tracker = coordinator.createTracker(
    "web:default",
    (turn) => completed.push({ text: turn.text }),
    (discard) => discarded.push(discard),
  );
  const commentarySignature = JSON.stringify({ phase: "commentary" });
  const finalSignature = JSON.stringify({ phase: "final_answer" });

  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "error",
      errorMessage: "Temporary provider error; try again.",
      content: [
        { type: "text", text: "Searching logs.", textSignature: commentarySignature },
      ],
    },
  } as any);

  expect(tracker.getError()?.errorMessage).toContain("Temporary provider error");
  expect(tracker.getFinalText()).toBe("");
  expect(completed).toEqual([]);
  expect(discarded).toEqual([{ reason: "commentary_only" }]);

  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: {
      type: "text_start",
      contentIndex: 0,
      partial: { content: [{ type: "text", textSignature: finalSignature }] },
    },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "text", text: "Checking one last detail. ", textSignature: commentarySignature },
        { type: "text", text: "The request completed successfully.", textSignature: finalSignature },
      ],
    },
  } as any);

  expect(completed).toEqual([]);
  expect(tracker.getError()).toBeNull();
  expect(tracker.getFinalText()).toBe("The request completed successfully.");
});

test("AgentTurnCoordinator does not set error for normal assistant messages", () => {
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const tracker = coordinator.createTracker("web:default");

  tracker.handleMessageUpdate({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "hello" },
  } as any);
  tracker.handleMessageUpdate({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
    },
  } as any);

  expect(tracker.getFinalText()).toBe("hello");
  expect(tracker.getError()).toBeNull();
});

test("AgentTurnCoordinator aborts timed-out prompts", async () => {
  let abortCalls = 0;
  const errors: string[] = [];
  const session = {
    abort: async () => {
      abortCalls += 1;
    },
  };

  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
    onError: (message) => errors.push(message),
  });

  const { timedOutRef } = coordinator.startPromptTimeout(session as any, "web:default", 5);
  await Bun.sleep(20);

  expect(timedOutRef.value).toBe(true);
  expect(abortCalls).toBe(1);
  expect(errors).toContain("Prompt timed out; aborting session");
});

test("AgentTurnCoordinator does not await a hung abort on the legacy timeout path", async () => {
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });
  const state = coordinator.startPromptTimeout({
    abort: async () => await new Promise<void>(() => {}),
  } as any, "web:default", 5);
  await Bun.sleep(15);
  const startedAt = Date.now();
  expect(await state.finish()).toBeNull();
  expect(Date.now() - startedAt).toBeLessThan(50);
  expect(state.timedOutRef.value).toBe(true);
});

test("AgentTurnCoordinator ignores late timeout callbacks after completion", async () => {
  let abortCalls = 0;
  const errors: string[] = [];
  const session = {
    abort: async () => {
      abortCalls += 1;
    },
  };

  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
    onError: (message) => errors.push(message),
  });

  const { timedOutRef, completedRef } = coordinator.startPromptTimeout(session as any, "web:default", 5);
  completedRef.value = true;
  await Bun.sleep(20);

  expect(timedOutRef.value).toBe(false);
  expect(abortCalls).toBe(0);
  expect(errors).toEqual([]);
});

test("AgentTurnCoordinator latches a Goal checkpoint before abort and reports only after abort resolves", async () => {
  const order: string[] = [];
  let releaseAbort!: () => void;
  const abortSettled = new Promise<void>((resolve) => { releaseAbort = resolve; });
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });
  const session = {
    abort: async () => {
      order.push("abort");
      await abortSettled;
      order.push("idle");
    },
  };
  const state = coordinator.startPromptTimeout(session as any, "web:goal", 40, {
    reserveMs: 20,
    oldTurnId: "turn-old",
    tryLatch: () => {
      order.push("latch");
      return true;
    },
  });

  await Bun.sleep(25);
  expect(order).toEqual(["latch", "abort"]);
  let finished = false;
  const finish = state.finish().then((evidence) => { finished = true; return evidence; });
  await Bun.sleep(1);
  expect(finished).toBe(false);
  releaseAbort();
  const evidence = await finish;
  expect(order).toEqual(["latch", "abort", "idle"]);
  expect(evidence?.settlement).toBe("abort_requested");
  expect(evidence?.oldTurnId).toBe("turn-old");
  expect(state.timedOutRef.value).toBe(false);
});

test("AgentTurnCoordinator bounds a Goal checkpoint when session.abort never resolves", async () => {
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [], touchSession: () => {}, recordMessageUsage: () => {},
  });
  const state = coordinator.startPromptTimeout({ abort: async () => await new Promise<void>(() => {}) } as any, "web:goal", 40, {
    reserveMs: 20,
    oldTurnId: "turn-hung-abort",
    tryLatch: () => true,
  });
  await Bun.sleep(25);
  const startedFinishAt = Date.now();
  const evidence = await state.finish();
  expect(Date.now() - startedFinishAt).toBeLessThan(100);
  expect(evidence).toMatchObject({
    settlement: "abort_failed",
    oldTurnId: "turn-hung-abort",
    abortError: expect.stringContaining("hard prompt deadline"),
  });
  expect(state.timedOutRef.value).toBe(true);
});

test("AgentTurnCoordinator falls through to the ordinary deadline when Goal latching is suppressed", async () => {
  let abortCalls = 0;
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });
  const state = coordinator.startPromptTimeout({ abort: async () => { abortCalls += 1; } } as any, "web:goal", 30, {
    reserveMs: 20,
    oldTurnId: "turn-old",
    tryLatch: () => false,
  });

  await Bun.sleep(40);
  expect(abortCalls).toBe(1);
  expect(state.timedOutRef.value).toBe(true);
  expect(await state.finish()).toBeNull();
});

test("AgentTurnCoordinator reports timed-out abort failures without leaking rejections", async () => {
  const warns: string[] = [];
  const session = {
    abort: async () => {
      throw new Error("abort failed");
    },
  };

  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
    onWarn: (message) => warns.push(message),
  });

  const { timedOutRef } = coordinator.startPromptTimeout(session as any, "web:default", 5);
  await Bun.sleep(20);

  expect(timedOutRef.value).toBe(true);
  expect(warns).toContain("Failed to abort timed-out prompt");
});
