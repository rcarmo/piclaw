import { initTheme, setThemeModePreference } from '../../../web/src/ui/theme.js';
import './workbench-layout.js';

// Apply the production palette, including chart tokens used by meter sparklines.
initTheme();
(window as any).setThemeModePreference = setThemeModePreference;
