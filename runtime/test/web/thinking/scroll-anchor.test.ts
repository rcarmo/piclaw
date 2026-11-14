import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import { anchorTarget, ANCHOR_SIGN, scrollerNativelyAnchors, attachHeaderAnchor, isAnchorScrolling } from "../../../web/src/ui/scroll-anchor";

// The scroll anchor keeps a disclosure header fixed while the panel below it
// resizes, in browsers that lack native CSS scroll anchoring (Safari). The most
// important property is that a full expand/collapse cycle returns scrollTop to
// EXACTLY its starting value, with no accumulating drift over many cycles — which
// is why the height delta is quantised to device pixels before use.

describe("anchorTarget", () => {
  it("moves scrollTop opposite to the height growth (column-reverse sign)", () => {
    // Expanding (content grows below the header) must decrease scrollTop.
    const t = anchorTarget(1000, 5000, 5100, 2);
    expect(t).toBeLessThan(1000);
    expect(ANCHOR_SIGN).toBe(-1);
  });

  it("a full expand/collapse cycle returns scrollTop to the EXACT start (no drift)", () => {
    const dpr = 2;
    const start = 1000;
    const baseH = 5000;
    // Fractional panel heights are exactly what caused the original accumulation.
    for (const grow of [103.84, 217.13, 399.5, 12.01, 250.4999]) {
      const afterExpand = anchorTarget(start, baseH, baseH + grow, dpr);
      const afterCollapse = anchorTarget(afterExpand, baseH + grow, baseH, dpr);
      expect(afterCollapse).toBe(start);
    }
  });

  it("does not accumulate drift across many cycles at dpr=2 and dpr=1", () => {
    for (const dpr of [1, 2, 3]) {
      let top = 812.5;
      const baseH = 4321;
      const grow = 187.37; // fractional
      for (let i = 0; i < 50; i++) {
        top = anchorTarget(top, baseH, baseH + grow, dpr); // expand
        top = anchorTarget(top, baseH + grow, baseH, dpr); // collapse
      }
      expect(top).toBe(812.5); // exactly back to the start after 50 cycles
    }
  });

  it("quantises the delta to device pixels", () => {
    // grow by 100.9 at dpr=2 -> round(100.9*2)/2 = round(201.8)/2 = 202/2 = 101
    expect(anchorTarget(1000, 0, 100.9, 2)).toBe(1000 - 101);
    // grow by 100.9 at dpr=1 -> round(100.9)/1 = 101
    expect(anchorTarget(1000, 0, 100.9, 1)).toBe(1000 - 101);
  });

  it("treats a non-positive dpr as 1 (no divide-by-zero)", () => {
    expect(anchorTarget(1000, 0, 100.4, 0)).toBe(1000 - 100);
  });
});

describe("scrollerNativelyAnchors", () => {
  const originalCSS = (globalThis as { CSS?: unknown }).CSS;
  const originalGCS = (globalThis as { getComputedStyle?: unknown }).getComputedStyle;

  afterEach(() => {
    (globalThis as { CSS?: unknown }).CSS = originalCSS;
    (globalThis as { getComputedStyle?: unknown }).getComputedStyle = originalGCS;
    (globalThis as { window?: unknown }).window = globalThis;
  });

  function setup(supports: boolean, resolved: string) {
    (globalThis as { window?: unknown }).window = globalThis;
    (globalThis as { CSS?: unknown }).CSS = { supports: () => supports };
    (globalThis as { getComputedStyle?: unknown }).getComputedStyle = () => ({ overflowAnchor: resolved });
  }

  it("returns false when overflow-anchor is unsupported (Safari)", () => {
    setup(false, "auto");
    expect(scrollerNativelyAnchors({} as HTMLElement)).toBe(false);
  });

  it("returns true when supported and not disabled (Chrome/Firefox)", () => {
    setup(true, "auto");
    expect(scrollerNativelyAnchors({} as HTMLElement)).toBe(true);
  });

  it("returns false when an ancestor disabled anchoring (computed 'none')", () => {
    setup(true, "none");
    expect(scrollerNativelyAnchors({} as HTMLElement)).toBe(false);
  });
});

describe("attachHeaderAnchor", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = {
    window: g.window,
    CSS: g.CSS,
    getComputedStyle: g.getComputedStyle,
    ResizeObserver: g.ResizeObserver,
    devicePixelRatio: g.devicePixelRatio,
  };
  let roCallbacks: Array<() => void>;

  function makeScroller(opts: {
    overflowAnchor?: string;
    flexDirection?: string;
    scrollHeight?: number;
    clientWidth?: number;
    scrollTop?: number;
  } = {}) {
    const listeners = { add: 0, remove: 0 };
    const scrollHandlers = new Set<() => void>();
    return {
      _overflowAnchor: opts.overflowAnchor ?? "auto",
      _flexDirection: opts.flexDirection ?? "column-reverse",
      scrollHeight: opts.scrollHeight ?? 5000,
      clientWidth: opts.clientWidth ?? 300,
      scrollTop: opts.scrollTop ?? 1000,
      listeners, scrollHandlers,
      addEventListener(_event: string, handler: () => void) { listeners.add++; scrollHandlers.add(handler); },
      removeEventListener(_event: string, handler: () => void) { listeners.remove++; scrollHandlers.delete(handler); },
    };
  }
  const asEl = (s: unknown) => s as unknown as HTMLElement;

  beforeEach(() => {
    roCallbacks = [];
    g.window = globalThis;
    g.devicePixelRatio = 2;
    // Safari path: engine has no overflow-anchor support -> JS anchoring engages.
    g.CSS = { supports: () => false };
    g.getComputedStyle = (el: { _overflowAnchor?: string; _flexDirection?: string }) => ({
      overflowAnchor: el._overflowAnchor ?? "auto",
      flexDirection: el._flexDirection ?? "column-reverse",
    });
    class RO {
      constructor(public cb: () => void) { roCallbacks.push(cb); }
      observe() {}
      disconnect() {}
    }
    g.ResizeObserver = RO as unknown;
  });

  afterEach(() => {
    Object.assign(g, saved);
  });

  it("returns an inert handle when inputs are missing", () => {
    const s = makeScroller();
    const h = attachHeaderAnchor(null, asEl({}));
    h.mark(); h.compensate(); h.dispose(); // must not throw
    expect(attachHeaderAnchor(asEl(s), null)).toBeDefined();
    expect(s.listeners.add).toBe(0); // no listener wired for an inert anchor
  });

  it("returns an inert handle when ResizeObserver is unavailable", () => {
    delete g.ResizeObserver;
    const s = makeScroller();
    attachHeaderAnchor(asEl(s), asEl({}));
    expect(s.listeners.add).toBe(0);
  });

  it("returns an inert handle when the scroller anchors natively", () => {
    g.CSS = { supports: () => true }; // engine supports overflow-anchor
    const s = makeScroller({ overflowAnchor: "auto" });
    attachHeaderAnchor(asEl(s), asEl({}));
    expect(s.listeners.add).toBe(0);
  });

  it("compensates on resize in a column-reverse scroller and flags isAnchorScrolling", () => {
    const s = makeScroller({ flexDirection: "column-reverse", scrollTop: 1000, scrollHeight: 5000 });
    const h = attachHeaderAnchor(asEl(s), asEl({}));
    expect(s.listeners.add).toBe(1);
    h.mark();
    s.scrollHeight = 5120; // panel grew by 120
    roCallbacks[0](); // ResizeObserver fires compensate
    expect(s.scrollTop).toBe(1000 - 120); // -delta (column-reverse sign)
    expect(isAnchorScrolling(asEl(s))).toBe(true);
    expect(isAnchorScrolling(null)).toBe(false);
    h.dispose();
    expect(s.listeners.remove).toBe(1);
  });

  it("does NOT compensate in a top-pinned column scroller (search/hashtag mode)", () => {
    const s = makeScroller({ flexDirection: "column", scrollTop: 1000, scrollHeight: 5000 });
    const h = attachHeaderAnchor(asEl(s), asEl({}));
    h.mark(); // gated off because flex-direction is not column-reverse
    s.scrollHeight = 5120;
    roCallbacks[0]();
    expect(s.scrollTop).toBe(1000); // untouched
  });

  it("bails when the scroller width changed since mark (reflow/orientation)", () => {
    const s = makeScroller({ flexDirection: "column-reverse", clientWidth: 300, scrollTop: 1000, scrollHeight: 5000 });
    const h = attachHeaderAnchor(asEl(s), asEl({}));
    h.mark();
    s.clientWidth = 320; // orientation change re-wrapped unrelated messages
    s.scrollHeight = 5200;
    roCallbacks[0]();
    expect(s.scrollTop).toBe(1000); // stale target not applied
  });

  it("multiple anchors share user-scroll cancellation and one disposal lifecycle", () => {
    const s = makeScroller();
    const a = attachHeaderAnchor(asEl(s), asEl({}));
    const b = attachHeaderAnchor(asEl(s), asEl({}));
    expect(s.listeners.add).toBe(1);
    a.mark(); b.mark();
    for (const handler of s.scrollHandlers) handler();
    s.scrollHeight = 5300;
    for (const callback of roCallbacks) callback();
    expect(s.scrollTop).toBe(1000); // A user scroll abandons both anchors.
    a.dispose(); expect(s.listeners.remove).toBe(0);
    b.dispose(); expect(s.listeners.remove).toBe(1);
    expect(s.scrollHandlers.size).toBe(0);
  });

  it("shares one scroll listener across pills and removes it only on last dispose", () => {
    const s = makeScroller();
    const a = attachHeaderAnchor(asEl(s), asEl({}));
    const b = attachHeaderAnchor(asEl(s), asEl({}));
    expect(s.listeners.add).toBe(1); // single shared listener
    a.dispose();
    expect(s.listeners.remove).toBe(0); // still one anchor left
    b.dispose();
    expect(s.listeners.remove).toBe(1); // removed once the last anchor detaches
  });
});
