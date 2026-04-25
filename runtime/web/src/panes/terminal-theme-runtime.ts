function runBestEffort(run: () => void): boolean {
  try {
    run();
    return true;
  } catch (_error) {
    return false;
  }
}

export function applyTerminalThemeBestEffort(options: {
  termEl: { style?: Record<string, unknown> | null } | null | undefined;
  bodyEl: { style?: Record<string, unknown> | null; querySelector?: (selector: string) => unknown } | null | undefined;
  terminal: any;
  theme: { background?: string; foreground?: string };
  themeChanged?: boolean;
  socket?: { readyState?: number; send?: (payload: string) => void } | null;
  resize?: (() => void) | null;
}): void {
  const { termEl, bodyEl, terminal, theme, themeChanged = false, socket, resize } = options;

  runBestEffort(() => {
    if (termEl?.style) {
      termEl.style.backgroundColor = theme.background;
      termEl.style.color = theme.foreground;
    }
    if (bodyEl?.style) {
      bodyEl.style.backgroundColor = theme.background;
      bodyEl.style.color = theme.foreground;
    }
    const host = bodyEl?.querySelector?.('.terminal-live-host');
    if (host && typeof host === 'object' && 'style' in (host as any)) {
      (host as any).style.backgroundColor = theme.background;
      (host as any).style.color = theme.foreground;
    }
    const canvas = bodyEl?.querySelector?.('canvas');
    if (canvas && typeof canvas === 'object' && 'style' in (canvas as any)) {
      (canvas as any).style.backgroundColor = theme.background;
      (canvas as any).style.color = theme.foreground;
    }
  });

  runBestEffort(() => {
    if (terminal?.options) {
      terminal.options.theme = theme;
    }
  });

  if (themeChanged) {
    runBestEffort(() => {
      terminal?.reset?.();
    });
  }

  runBestEffort(() => {
    terminal?.renderer?.setTheme?.(theme);
    terminal?.renderer?.clear?.();
  });
  runBestEffort(() => {
    terminal?.loadFonts?.();
  });
  runBestEffort(() => {
    terminal?.renderer?.remeasureFont?.();
  });
  runBestEffort(() => {
    if (terminal?.wasmTerm && terminal?.renderer?.render) {
      terminal.renderer.render(terminal.wasmTerm, true, terminal.viewportY || 0, terminal);
      terminal.renderer.render(terminal.wasmTerm, false, terminal.viewportY || 0, terminal);
    }
  });
  runBestEffort(() => {
    resize?.();
  });
  runBestEffort(() => {
    if (themeChanged && socket?.readyState === 1) {
      socket.send?.(JSON.stringify({ type: 'input', data: '\f' }));
    }
  });
  runBestEffort(() => {
    terminal?.refresh?.();
  });
}
