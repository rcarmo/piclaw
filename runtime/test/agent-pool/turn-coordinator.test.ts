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

test("AgentTurnCoordinator tracks streamed turns and fallback assistant text", () => {
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

 test("AgentTurnCoordinator ignores commentary-only assistant text", () => {
  const coordinator = new AgentTurnCoordinator({
    takeAttachments: () => [],
    touchSession: () => {},
    recordMessageUsage: () => {},
  });

  const tracker = coordinator.createTracker("web:default");

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
      content: [{ type: "text", text: "progress update", textSignature: JSON.stringify({ v: 1, id: "msg_c", phase: "commentary" }) }],
    },
  } as any);

  expect(tracker.getFinalText()).toBe("");
  expect(tracker.getTurnCount()).toBe(0);
});

 test("AgentTurnCoordinator drops commentary and keeps later final answers", () => {
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
  expect(tracker.getFinalText()).toBe("done");
});

test("AgentTurnCoordinator subscribes, records usage, and downgrades handler failures to warnings", () => {
  let listener: ((event: unknown) => void) | null = null;
  let touched = 0;
  const usage: Array<{ chatJid: string; message: unknown }> = [];
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
    recordMessageUsage: (chatJid, message) => {
      usage.push({ chatJid, message });
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
  expect(usage).toHaveLength(1);
  expect(usage[0]?.chatJid).toBe("web:default");
  expect(warns).toContain("Event handler error");

  unsub();
  expect(listener).toBeNull();
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
