import { initTheme, applyThemeFromEvent } from '../../../web/src/ui/theme';
import { selectLocalTheme } from './select-theme.js';

import { WEB_THEME_PRESETS } from '../../../src/core/ui-theme-catalogue';

Object.assign(window, { themeChromeFixture: { start: () => initTheme(), select: selectLocalTheme, applyEvent: applyThemeFromEvent, ids: WEB_THEME_PRESETS.map(p => p.id) } });
