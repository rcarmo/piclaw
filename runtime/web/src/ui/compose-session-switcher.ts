export interface ComposeSessionSwitcherKeyEventLike {
  isComposing?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  key?: string;
}

export interface ComposeSessionSwitcherOptions {
  searchMode?: boolean;
  showSessionSwitcherButton?: boolean;
}

export function canUseComposeSessionSwitcher(
  options: ComposeSessionSwitcherOptions = {},
): boolean {
  if (options.searchMode) return false;
  return Boolean(options.showSessionSwitcherButton);
}

export function shouldOpenSessionSwitcherFromBlankCompose(
  event: ComposeSessionSwitcherKeyEventLike | null | undefined,
  value: string | null | undefined,
  options: ComposeSessionSwitcherOptions = {},
): boolean {
  if (!event || event.isComposing) return false;
  if (!canUseComposeSessionSwitcher(options)) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key !== '@') return false;
  return String(value || '') === '';
}

export function shouldRouteComposeValueToSessionSwitcher(
  value: string | null | undefined,
  options: ComposeSessionSwitcherOptions = {},
): boolean {
  if (!canUseComposeSessionSwitcher(options)) return false;
  return String(value || '') === '@';
}
