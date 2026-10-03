import { html, render } from '../../../web/src/vendor/preact-htm.js';
import { TimelineQuickActions } from '../../../web/src/components/timeline-quick-actions.js';
import { initTheme, selectLocalTheme, setThemeModePreference } from '../../../web/src/ui/theme.js';
import { WEB_THEME_PRESETS } from '../../../src/core/ui-theme-catalogue.js';

window.fetch = async () => Response.json({ items: [], enabled: true });
(window as any).quickActionsFixture = { selectLocalTheme, setThemeModePreference, presets: WEB_THEME_PRESETS };
initTheme();
render(html`<main class="timeline" tabindex="-1">
  <${TimelineQuickActions}
    activeChatAgents=${[]}
    workspaceOpen=${false}
    onToggleWorkspace=${() => { (window as any).selectedQuickAction = 'workspace'; }}
    commands=${[{name:'theme',description:'Change theme'}]}
    onCommand=${(name:string) => { (window as any).selectedQuickAction = name; }}
    onSwitchChat=${() => {}}
  />
</main>`, document.getElementById('app'));
