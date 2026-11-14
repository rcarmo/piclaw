import { applyThemeFromEvent } from '../../../web/src/ui/theme.js';
/** Select a palette in an isolated fixture through the same event API as Classic. */
export function selectLocalTheme(theme: string): void {
  applyThemeFromEvent({ theme, tint: null });
}
