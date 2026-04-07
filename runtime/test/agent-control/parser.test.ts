/**
 * test/agent-control/parser.test.ts – Unit tests for parseControlCommand().
 *
 * Covers parsing of every command type: /model, /thinking, /compact, /abort,
 * /tree, /label, /session, /fork, /export, /search-workspace, etc.
 * Verifies correct extraction of arguments, aliases, and edge cases.
 */

import { describe, test, expect } from "bun:test";
import "../helpers.js";

import { parseControlCommand } from "../../src/agent-control/agent-control-parser.js";

describe("parseControlCommand", () => {
  test("returns null for empty input", () => {
    expect(parseControlCommand("")).toBeNull();
    expect(parseControlCommand("hello")).toBeNull();
  });

  test("returns null for non-command text", () => {
    expect(parseControlCommand("just some text")).toBeNull();
    expect(parseControlCommand("no slash here")).toBeNull();
  });

  test("strips trigger before parsing", () => {
    const trigger = /(?:^|\s)@PiClaw\b/i;
    const cmd = parseControlCommand("@PiClaw /model gpt-4", trigger);
    expect(cmd).not.toBeNull();
    expect(cmd!.type).toBe("model");
  });

  // /model
  test("/model with no args", () => {
    const cmd = parseControlCommand("/model");
    expect(cmd).toEqual({ type: "model", raw: "/model" });
  });

  test("/model with provider/id", () => {
    const cmd = parseControlCommand("/model openai/gpt-4");
    expect(cmd).toEqual({ type: "model", provider: "openai", modelId: "gpt-4", raw: "/model openai/gpt-4" });
  });

  test("/model with just id", () => {
    const cmd = parseControlCommand("/model gpt-4");
    expect(cmd).toEqual({ type: "model", modelId: "gpt-4", raw: "/model gpt-4" });
  });

  test("/model with provider and separate id", () => {
    const cmd = parseControlCommand("/model openai gpt-4o");
    expect(cmd).toEqual({ type: "model", provider: "openai", modelId: "gpt-4o", raw: "/model openai gpt-4o" });
  });

  // /thinking
  test("/thinking with no args", () => {
    const cmd = parseControlCommand("/thinking");
    expect(cmd).toEqual({ type: "thinking", level: undefined, raw: "/thinking" });
  });

  test("/thinking with level", () => {
    const cmd = parseControlCommand("/thinking high");
    expect(cmd).toEqual({ type: "thinking", level: "high", raw: "/thinking high" });
  });

  // Simple commands
  test("/commands", () => {
    expect(parseControlCommand("/commands")).toEqual({ type: "commands", raw: "/commands" });
  });

  test("/login", () => {
    expect(parseControlCommand("/login")).toEqual({ type: "login", provider: undefined, raw: "/login" });
  });

  test("/login with provider", () => {
    expect(parseControlCommand("/login github-copilot")).toEqual({ type: "login", provider: "github-copilot", raw: "/login github-copilot" });
  });

  test("/logout", () => {
    expect(parseControlCommand("/logout")).toEqual({ type: "logout", provider: undefined, raw: "/logout" });
  });

  test("/logout with provider", () => {
    expect(parseControlCommand("/logout openai")).toEqual({ type: "logout", provider: "openai", raw: "/logout openai" });
  });

  test("/restart", () => {
    expect(parseControlCommand("/restart")).toEqual({ type: "restart", raw: "/restart" });
  });

  test("/exit", () => {
    expect(parseControlCommand("/exit")).toEqual({ type: "exit", raw: "/exit" });
  });

  test("/state", () => {
    expect(parseControlCommand("/state")).toEqual({ type: "state", raw: "/state" });
  });

  test("/stats", () => {
    expect(parseControlCommand("/stats")).toEqual({ type: "stats", raw: "/stats" });
  });

  test("/context", () => {
    expect(parseControlCommand("/context")).toEqual({ type: "context", raw: "/context" });
  });

  test("/last", () => {
    expect(parseControlCommand("/last")).toEqual({ type: "last", raw: "/last" });
  });

  test("/abort", () => {
    expect(parseControlCommand("/abort")).toEqual({ type: "abort", raw: "/abort" });
  });

  test("/abort-retry", () => {
    expect(parseControlCommand("/abort-retry")).toEqual({ type: "abort_retry", raw: "/abort-retry" });
  });

  test("/abort-bash", () => {
    expect(parseControlCommand("/abort-bash")).toEqual({ type: "abort_bash", raw: "/abort-bash" });
  });

  test("/forks", () => {
    expect(parseControlCommand("/forks")).toEqual({ type: "forks", raw: "/forks" });
  });

  test("/labels", () => {
    expect(parseControlCommand("/labels")).toEqual({ type: "labels", raw: "/labels" });
  });

  // /shell and /bash
  test("/shell with command", () => {
    const cmd = parseControlCommand("/shell ls -la");
    expect(cmd).toEqual({ type: "shell", command: "ls -la", raw: "/shell ls -la" });
  });

  test("/shell with no command", () => {
    const cmd = parseControlCommand("/shell");
    expect(cmd).toEqual({ type: "shell", command: undefined, raw: "/shell" });
  });

  test("/shell strips appended Files footer", () => {
    const raw = "/shell ls\n\nFiles:\n- tmp/doc-log.txt";
    const cmd = parseControlCommand(raw);
    expect(cmd).toEqual({ type: "shell", command: "ls", raw });
  });

  test("/bash with command", () => {
    const cmd = parseControlCommand("/bash echo hello");
    expect(cmd).toEqual({ type: "bash", command: "echo hello", raw: "/bash echo hello" });
  });

  test("/bash strips inline attachment footer after whitespace normalization", () => {
    const raw = "/bash pwd\n\nAttachments:\n- notes/today.md";
    const cmd = parseControlCommand(raw);
    expect(cmd).toEqual({ type: "bash", command: "pwd", raw });
  });

  // /queue
  test("/queue with message", () => {
    const cmd = parseControlCommand("/queue do something");
    expect(cmd).toEqual({ type: "queue", message: "do something", raw: "/queue do something" });
  });

  test("/queue-all with message", () => {
    const cmd = parseControlCommand("/queue-all do this");
    expect(cmd).toEqual({ type: "queue_all", message: "do this", raw: "/queue-all do this" });
  });

  test("/steer with message", () => {
    const cmd = parseControlCommand("/steer focus on pricing");
    expect(cmd).toEqual({ type: "steer", message: "focus on pricing", raw: "/steer focus on pricing" });
  });

  // /compact
  test("/compact with instructions", () => {
    const cmd = parseControlCommand("/compact keep the important stuff");
    expect(cmd).toEqual({ type: "compact", instructions: "keep the important stuff", raw: "/compact keep the important stuff" });
  });

  test("/compact with no instructions", () => {
    const cmd = parseControlCommand("/compact");
    expect(cmd).toEqual({ type: "compact", instructions: undefined, raw: "/compact" });
  });

  // /auto-compact
  test("/auto-compact on", () => {
    const cmd = parseControlCommand("/auto-compact on");
    expect(cmd).toEqual({ type: "auto_compact", enabled: true, raw: "/auto-compact on" });
  });

  test("/auto-compact off", () => {
    const cmd = parseControlCommand("/auto-compact off");
    expect(cmd).toEqual({ type: "auto_compact", enabled: false, raw: "/auto-compact off" });
  });

  test("/auto-compact no args", () => {
    const cmd = parseControlCommand("/auto-compact");
    expect(cmd).toEqual({ type: "auto_compact", enabled: undefined, raw: "/auto-compact" });
  });

  // /auto-retry
  test("/auto-retry on", () => {
    expect(parseControlCommand("/auto-retry on")).toEqual({ type: "auto_retry", enabled: true, raw: "/auto-retry on" });
  });

  // /cycle-model
  test("/cycle-model forward", () => {
    const cmd = parseControlCommand("/cycle-model");
    expect(cmd?.type).toBe("cycle_model");
    expect(cmd?.direction).toBe("forward");
  });

  test("/cycle-model backward", () => {
    const cmd = parseControlCommand("/cycle-model back");
    expect(cmd?.direction).toBe("backward");
  });

  test("/cycle-model prev", () => {
    const cmd = parseControlCommand("/cycle-model prev");
    expect(cmd?.direction).toBe("backward");
  });

  // /cycle-thinking
  test("/cycle-thinking", () => {
    expect(parseControlCommand("/cycle-thinking")).toEqual({ type: "cycle_thinking", raw: "/cycle-thinking" });
  });

  // /steering-mode and /followup-mode
  test("/steering-mode all", () => {
    const cmd = parseControlCommand("/steering-mode all");
    expect(cmd?.mode).toBe("all");
  });

  test("/followup-mode one-at-a-time", () => {
    const cmd = parseControlCommand("/followup-mode one-at-a-time");
    expect(cmd?.mode).toBe("one-at-a-time");
  });

  // Session commands
  test("/session-name with name", () => {
    const cmd = parseControlCommand("/session-name my-session");
    expect(cmd).toEqual({ type: "session_name", name: "my-session", raw: "/session-name my-session" });
  });

  test("/new-session", () => {
    const cmd = parseControlCommand("/new-session");
    expect(cmd).toEqual({ type: "new_session", parent: undefined, raw: "/new-session" });
  });

  test("/switch-session with path", () => {
    const cmd = parseControlCommand("/switch-session other");
    expect(cmd).toEqual({ type: "switch_session", path: "other", raw: "/switch-session other" });
  });

  test("/session-rotate with instructions", () => {
    const cmd = parseControlCommand("/session-rotate keep active work only");
    expect(cmd).toEqual({ type: "session_rotate", instructions: "keep active work only", raw: "/session-rotate keep active work only" });
  });

  test("/fork with entryId", () => {
    const cmd = parseControlCommand("/fork abc123");
    expect(cmd).toEqual({ type: "fork", entryId: "abc123", raw: "/fork abc123" });
  });

  test("/export-html with path", () => {
    const cmd = parseControlCommand("/export-html /tmp/export.html");
    expect(cmd).toEqual({ type: "export_html", path: "/tmp/export.html", raw: "/export-html /tmp/export.html" });
  });

  // /tree
  test("/tree basic", () => {
    const cmd = parseControlCommand("/tree");
    expect(cmd?.type).toBe("tree");
  });

  test("/tree with target", () => {
    const cmd = parseControlCommand("/tree abc");
    expect(cmd?.targetId).toBe("abc");
  });

  test("/tree --head 5", () => {
    const cmd = parseControlCommand("/tree --head 5");
    expect(cmd?.mode).toBe("head");
    expect(cmd?.limit).toBe(5);
  });

  test("/tree --summarize", () => {
    const cmd = parseControlCommand("/tree --summarize");
    expect(cmd?.summarize).toBe(true);
  });

  // /label
  test("/label with target and text", () => {
    const cmd = parseControlCommand("/label abc my label");
    expect(cmd?.type).toBe("label");
    expect(cmd?.targetId).toBe("abc");
    expect(cmd?.label).toBe("my label");
  });

  // /agent-name and /agent-avatar
  test("/agent-name", () => {
    const cmd = parseControlCommand("/agent-name MyBot");
    expect(cmd).toEqual({ type: "agent_name", name: "MyBot", raw: "/agent-name MyBot" });
  });

  test("/agent-avatar", () => {
    const cmd = parseControlCommand("/agent-avatar https://example.com/avatar.png");
    expect(cmd).toEqual({ type: "agent_avatar", avatar: "https://example.com/avatar.png", raw: "/agent-avatar https://example.com/avatar.png" });
  });

  test("/user-github accepts @handle", () => {
    expect(parseControlCommand("/user-github @octocat")).toEqual({
      type: "user_github",
      profile: "@octocat",
      raw: "/user-github @octocat",
    });
  });

  test("/user-github accepts bare handle", () => {
    expect(parseControlCommand("/user-github octocat")).toEqual({
      type: "user_github",
      profile: "octocat",
      raw: "/user-github octocat",
    });
  });

  test("/user-github accepts GitHub URL", () => {
    expect(parseControlCommand("/user-github https://github.com/octocat?tab=repositories")).toEqual({
      type: "user_github",
      profile: "https://github.com/octocat?tab=repositories",
      raw: "/user-github https://github.com/octocat?tab=repositories",
    });
  });

  test("/totp without args shows QR flow when configured", () => {
    expect(parseControlCommand("/totp")).toEqual({
      type: "totp",
      action: undefined,
      raw: "/totp",
    });
  });

  test("/totp reset is parsed as reset action", () => {
    expect(parseControlCommand("/totp reset")).toEqual({
      type: "totp",
      action: "reset",
      code: undefined,
      raw: "/totp reset",
    });
  });

  test("/totp reset with confirmation code is parsed", () => {
    expect(parseControlCommand("/totp reset 123456")).toEqual({
      type: "totp",
      action: "reset",
      code: "123456",
      raw: "/totp reset 123456",
    });
  });

  test("/totp invalid action stays known command for handler validation", () => {
    expect(parseControlCommand("/totp nope")).toEqual({
      type: "totp",
      action: undefined,
      raw: "/totp nope",
    });
  });

  test("normalizes underscore aliases and mixed case command names", () => {
    expect(parseControlCommand("/queue_all queued once")).toEqual({
      type: "queue_all",
      message: "queued once",
      raw: "/queue_all queued once",
    });
    expect(parseControlCommand("/CTX")).toEqual({
      type: "context",
      raw: "/CTX",
    });
  });

  test("preserves unicode-heavy arguments after trigger stripping", () => {
    const trigger = /(?:^|\s)@PiClaw\b/i;
    expect(parseControlCommand("@PiClaw /search --scope notes café 你好 👩🏽‍💻", trigger)).toEqual({
      type: "search_workspace",
      query: "café 你好 👩🏽‍💻",
      scope: "notes",
      limit: undefined,
      offset: undefined,
      refresh: undefined,
      max_kb: undefined,
      raw: "/search --scope notes café 你好 👩🏽‍💻",
    });
    expect(parseControlCommand("  @PiClaw\n/queue مرحبا بالعالم", trigger)).toEqual({
      type: "queue",
      message: "مرحبا بالعالم",
      raw: "/queue مرحبا بالعالم",
    });
  });

  // Unknown commands return null
  test("unknown command returns null", () => {
    expect(parseControlCommand("/unknowncommand")).toBeNull();
  });
});
