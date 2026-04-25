import { expect, test } from "bun:test";

import { applyTerminalThemeBestEffort } from "../../web/src/panes/terminal-theme-runtime.js";

test("applyTerminalThemeBestEffort updates terminal surfaces and runtime hooks", () => {
  const host = { style: {} as Record<string, string> };
  const canvas = { style: {} as Record<string, string> };
  const termEl = { style: {} as Record<string, string> };
  const bodyEl = {
    style: {} as Record<string, string>,
    querySelector: (selector: string) => selector === '.terminal-live-host' ? host : canvas,
  };
  const calls: string[] = [];
  const terminal = {
    options: {},
    reset: () => calls.push('reset'),
    loadFonts: () => calls.push('loadFonts'),
    refresh: () => calls.push('refresh'),
    wasmTerm: { id: 'wasm' },
    viewportY: 3,
    renderer: {
      setTheme: () => calls.push('setTheme'),
      clear: () => calls.push('clear'),
      remeasureFont: () => calls.push('remeasureFont'),
      render: (_wasm: unknown, force: boolean) => calls.push(`render:${force}`),
    },
  };
  const socketPayloads: string[] = [];

  applyTerminalThemeBestEffort({
    termEl,
    bodyEl,
    terminal,
    theme: { background: '#111111', foreground: '#eeeeee' },
    themeChanged: true,
    socket: { readyState: 1, send: (payload: string) => socketPayloads.push(payload) },
    resize: () => calls.push('resize'),
  });

  expect(termEl.style.backgroundColor).toBe('#111111');
  expect(termEl.style.color).toBe('#eeeeee');
  expect(bodyEl.style.backgroundColor).toBe('#111111');
  expect(bodyEl.style.color).toBe('#eeeeee');
  expect(host.style.color).toBe('#eeeeee');
  expect(canvas.style.backgroundColor).toBe('#111111');
  expect((terminal.options as any).theme).toEqual({ background: '#111111', foreground: '#eeeeee' });
  expect(calls).toEqual(['reset', 'setTheme', 'clear', 'loadFonts', 'remeasureFont', 'render:true', 'render:false', 'resize', 'refresh']);
  expect(socketPayloads).toEqual([JSON.stringify({ type: 'input', data: '\f' })]);
});

test("applyTerminalThemeBestEffort tolerates theme operations that throw", () => {
  const brokenStyle = {
    set backgroundColor(_value: string) {
      throw new Error('detached');
    },
    set color(_value: string) {
      throw new Error('detached');
    },
  };
  const terminal = {
    options: {
      set theme(_value: unknown) {
        throw new Error('blocked');
      },
    },
    reset: () => { throw new Error('blocked'); },
    loadFonts: () => { throw new Error('blocked'); },
    refresh: () => { throw new Error('blocked'); },
    wasmTerm: { id: 'wasm' },
    renderer: {
      setTheme: () => { throw new Error('blocked'); },
      clear: () => { throw new Error('blocked'); },
      remeasureFont: () => { throw new Error('blocked'); },
      render: () => { throw new Error('blocked'); },
    },
  };

  expect(() => applyTerminalThemeBestEffort({
    termEl: { style: brokenStyle } as any,
    bodyEl: { style: brokenStyle, querySelector: () => ({ style: brokenStyle }) } as any,
    terminal,
    theme: { background: '#111111', foreground: '#eeeeee' },
    themeChanged: true,
    socket: { readyState: 1, send: () => { throw new Error('blocked'); } },
    resize: () => { throw new Error('blocked'); },
  })).not.toThrow();
});
