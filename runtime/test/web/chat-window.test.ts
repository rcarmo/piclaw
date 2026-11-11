import { expect, test } from "bun:test";

import {
  buildBranchLoaderUrl,
  buildChatWindowUrl,
  buildPanePopoutUrl,
  closeProvisionalChatWindow,
  describeBranchOpenError,
  getChatWindowOpenOptions,
  getChatWindowTarget,
  getPaneWindowOpenOptions,
  getPaneWindowTarget,
  isMobileBrowserMode,
  isStandaloneWebAppMode,
  navigateProvisionalChatWindow,
  openProvisionalChatWindow,
  primeProvisionalChatWindow,
} from "../../web/src/ui/chat-window.js";

function createFakeElement(tagName = "div") {
  return {
    tagName,
    textContent: "",
    attributes: {} as Record<string, string>,
    children: [] as any[],
    innerHTML: "",
    setAttribute(name: string, value: string) {
      this.attributes[name] = value;
    },
    appendChild(child: any) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...children: any[]) {
      this.children = [...children];
    },
  };
}

test("isStandaloneWebAppMode detects iOS standalone mode", () => {
  expect(isStandaloneWebAppMode({ navigator: { standalone: true } })).toBe(true);
});

test("isStandaloneWebAppMode detects standalone display modes", () => {
  expect(isStandaloneWebAppMode({
    window: {
      matchMedia: (query: string) => ({ matches: query === '(display-mode: standalone)' }),
    },
  })).toBe(true);
});

test("isStandaloneWebAppMode stays false for regular browser tabs", () => {
  expect(isStandaloneWebAppMode({
    navigator: { standalone: false },
    window: { matchMedia: () => ({ matches: false }) },
  })).toBe(false);
});

test("isMobileBrowserMode detects mobile browsers", () => {
  expect(isMobileBrowserMode({
    navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", maxTouchPoints: 5 },
    window: { matchMedia: () => ({ matches: true }) },
  })).toBe(true);
});

test("isMobileBrowserMode stays false for desktop browsers", () => {
  expect(isMobileBrowserMode({
    navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", maxTouchPoints: 0 },
    window: { matchMedia: () => ({ matches: false }) },
  })).toBe(false);
});

test("getChatWindowOpenOptions returns popup settings for desktop browser tabs", () => {
  expect(getChatWindowOpenOptions("web:research", {
    navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", maxTouchPoints: 0, standalone: false },
    window: { matchMedia: () => ({ matches: false }) },
  })).toEqual({
    target: "piclaw-chat-web-research",
    features: "popup=yes,width=900,height=960,resizable=yes,scrollbars=yes",
    mode: "popup",
  });
});

test("getChatWindowOpenOptions returns new-tab behavior for mobile browser tabs", () => {
  expect(getChatWindowOpenOptions("web:research", {
    navigator: { userAgent: "Mozilla/5.0 (Linux; Android 14)", maxTouchPoints: 5, standalone: false },
    window: { matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' }) },
  })).toEqual({
    target: "_blank",
    features: undefined,
    mode: "tab",
  });
});

test("getChatWindowOpenOptions disables opening in standalone mode", () => {
  expect(getChatWindowOpenOptions("web:research", {
    navigator: { standalone: true },
  })).toBeNull();
});

test("getPaneWindowOpenOptions returns popup settings for desktop browser tabs", () => {
  expect(getPaneWindowOpenOptions("piclaw://terminal", {
    navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", maxTouchPoints: 0, standalone: false },
    window: { matchMedia: () => ({ matches: false }) },
  })).toEqual({
    target: "piclaw-pane-piclaw-terminal",
    features: "popup=yes,width=1200,height=960,resizable=yes,scrollbars=yes",
    mode: "popup",
  });
});


test("openProvisionalChatWindow opens about:blank synchronously with popup features", () => {
  const calls: any[] = [];
  const handle = { location: { replace: () => {} }, document: { title: "", body: { innerHTML: "" } }, close: () => {} };
  const result = openProvisionalChatWindow(
    { target: "piclaw-chat-web-research", features: "popup=yes", mode: "popup" },
    { window: { open: (...args: any[]) => { calls.push(args); return handle; } } },
  );
  expect(result).toBe(handle);
  expect(calls).toEqual([["about:blank", "piclaw-chat-web-research", "popup=yes"]]);
});

test("openProvisionalChatWindow opens about:blank in a new tab on mobile", () => {
  const calls: any[] = [];
  const handle = { location: { replace: () => {} }, document: { title: "", body: { innerHTML: "" } }, close: () => {} };
  const result = openProvisionalChatWindow(
    { target: "_blank", features: undefined, mode: "tab" },
    { window: { open: (...args: any[]) => { calls.push(args); return handle; } } },
  );
  expect(result).toBe(handle);
  expect(calls).toEqual([["about:blank", "_blank"]]);
});

test("prime/navigate/close provisional chat window are safe helper operations", () => {
  const calls: string[] = [];
  const body = createFakeElement("body");
  const handle: any = {
    location: { replace: (url: string) => calls.push(`replace:${url}`) },
    document: { title: "", body, createElement: (tag: string) => createFakeElement(tag) },
    close: () => calls.push("close"),
  };

  primeProvisionalChatWindow(handle, { title: "Opening branch…", message: "Preparing…" });
  expect(handle.document.title).toBe("Opening branch…");
  expect(body.children).toHaveLength(1);
  expect(body.children[0].children[0].textContent).toBe("Opening branch…");
  expect(body.children[0].children[1].textContent).toBe("Preparing…");

  navigateProvisionalChatWindow(handle, "https://example.com/chat");
  closeProvisionalChatWindow(handle);
  expect(calls).toEqual(["replace:https://example.com/chat", "close"]);
});

test("primeProvisionalChatWindow renders labels as text instead of parsing HTML", () => {
  const body = createFakeElement("body");
  const handle: any = {
    document: { title: "", body, createElement: (tag: string) => createFakeElement(tag) },
  };

  primeProvisionalChatWindow(handle, {
    title: 'Opening <img src=x onerror=alert(1)>…',
    message: 'Preparing <script>alert(1)</script>',
  });

  expect(body.children).toHaveLength(1);
  expect(body.children[0].children[0].textContent).toBe('Opening <img src=x onerror=alert(1)>…');
  expect(body.children[0].children[1].textContent).toBe('Preparing <script>alert(1)</script>');
  expect(body.innerHTML).toBe("");
});

test("prime/navigate/close provisional chat window tolerate disappearing popup handles", () => {
  const brokenHandle: any = {
    location: {
      replace: () => {
        throw new Error('closed');
      },
    },
    document: {
      set title(_value: string) {
        throw new Error('closed');
      },
      body: {
        set innerHTML(_value: string) {
          throw new Error('closed');
        },
      },
    },
    close: () => {
      throw new Error('closed');
    },
  };

  expect(() => primeProvisionalChatWindow(brokenHandle, { title: 'Opening…', message: 'Preparing…' })).not.toThrow();
  expect(() => navigateProvisionalChatWindow(brokenHandle, 'https://example.com/chat')).not.toThrow();
  expect(() => closeProvisionalChatWindow(brokenHandle)).not.toThrow();
});

test("buildChatWindowUrl preserves origin/path and adds branch params", () => {
  const url = buildChatWindowUrl("https://example.com/app?foo=1", "web:research");
  const parsed = new URL(url);

  expect(parsed.origin).toBe("https://example.com");
  expect(parsed.pathname).toBe("/app");
  expect(parsed.searchParams.get("foo")).toBe("1");
  expect(parsed.searchParams.get("chat_jid")).toBe("web:research");
  expect(parsed.searchParams.get("chat_only")).toBeNull();
});

test("buildChatWindowUrl clears pane popout params from inherited URLs", () => {
  const url = buildChatWindowUrl("https://example.com/app?pane_popout=1&pane_path=piclaw://terminal&pane_label=Terminal", "web:research");
  const parsed = new URL(url);

  expect(parsed.searchParams.get("chat_jid")).toBe("web:research");
  expect(parsed.searchParams.get("pane_popout")).toBeNull();
  expect(parsed.searchParams.get("pane_path")).toBeNull();
  expect(parsed.searchParams.get("pane_label")).toBeNull();
});

test("buildChatWindowUrl adds the uncluttered pop-out hint only when asked", () => {
  const url = buildChatWindowUrl("https://example.com/", "web:default", { chatOnly: true });
  const parsed = new URL(url);

  expect(parsed.searchParams.get("chat_jid")).toBe("web:default");
  expect(parsed.searchParams.get("chat_only")).toBe("1");
});

test("buildBranchLoaderUrl preserves origin/path and adds loader params", () => {
  const url = buildBranchLoaderUrl("https://example.com/app?foo=1", "web:research");
  const parsed = new URL(url);

  expect(parsed.origin).toBe("https://example.com");
  expect(parsed.pathname).toBe("/app");
  expect(parsed.searchParams.get("foo")).toBe("1");
  expect(parsed.searchParams.get("branch_loader")).toBe("1");
  expect(parsed.searchParams.get("branch_source_chat_jid")).toBe("web:research");
  expect(parsed.searchParams.get("chat_only")).toBeNull();
  expect(parsed.searchParams.get("chat_jid")).toBeNull();
});

test("buildBranchLoaderUrl clears inherited chat and pane params", () => {
  const url = buildBranchLoaderUrl("https://example.com/app?chat_jid=web:default&pane_popout=1&pane_path=piclaw://vnc/lab&pane_label=Lab", "web:research");
  const parsed = new URL(url);

  expect(parsed.searchParams.get("branch_loader")).toBe("1");
  expect(parsed.searchParams.get("branch_source_chat_jid")).toBe("web:research");
  expect(parsed.searchParams.get("chat_jid")).toBeNull();
  expect(parsed.searchParams.get("pane_popout")).toBeNull();
  expect(parsed.searchParams.get("pane_path")).toBeNull();
  expect(parsed.searchParams.get("pane_label")).toBeNull();
});

test("buildPanePopoutUrl preserves origin/path and adds pane params", () => {
  const url = buildPanePopoutUrl("https://example.com/app?foo=1&chat_only=1", "piclaw://terminal", {
    label: "Terminal",
    chatJid: "web:default",
  });
  const parsed = new URL(url);

  expect(parsed.origin).toBe("https://example.com");
  expect(parsed.pathname).toBe("/app");
  expect(parsed.searchParams.get("foo")).toBe("1");
  expect(parsed.searchParams.get("pane_popout")).toBe("1");
  expect(parsed.searchParams.get("pane_path")).toBe("piclaw://terminal");
  expect(parsed.searchParams.get("pane_label")).toBe("Terminal");
  expect(parsed.searchParams.get("chat_jid")).toBe("web:default");
  expect(parsed.searchParams.get("chat_only")).toBeNull();
  expect(parsed.searchParams.get("branch_loader")).toBeNull();
});

test("buildPanePopoutUrl clears stale inherited pane labels when omitted", () => {
  const url = buildPanePopoutUrl("https://example.com/app?pane_label=Old+Label&branch_loader=1&branch_source_chat_jid=web:default", "piclaw://vnc/lab");
  const parsed = new URL(url);

  expect(parsed.searchParams.get("pane_popout")).toBe("1");
  expect(parsed.searchParams.get("pane_path")).toBe("piclaw://vnc/lab");
  expect(parsed.searchParams.get("pane_label")).toBeNull();
  expect(parsed.searchParams.get("branch_loader")).toBeNull();
  expect(parsed.searchParams.get("branch_source_chat_jid")).toBeNull();
});

test("getChatWindowTarget derives a stable safe window name", () => {
  expect(getChatWindowTarget("web:Research/Branch 1")).toBe("piclaw-chat-web-research-branch-1");
});

test("getPaneWindowTarget derives a stable safe window name", () => {
  expect(getPaneWindowTarget("piclaw://vnc/Lab Desktop")).toBe("piclaw-pane-piclaw-vnc-lab-desktop");
});


test("describeBranchOpenError explains stable-boundary failures clearly", () => {
  expect(describeBranchOpenError(new Error("Cannot fork this branch yet because no stable turn boundary is available.")))
    .toContain("stable turn boundary");
});

test("describeBranchOpenError explains generic fork failures cleanly", () => {
  expect(describeBranchOpenError(new Error("Failed to fork branch.")))
    .toBe("PiClaw could not create the new branch. Please try again.");
});
