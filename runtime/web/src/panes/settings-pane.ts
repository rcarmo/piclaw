// @ts-nocheck
/**
 * settings-pane.ts — Settings as a work-area tab in the Classic workbench.
 *
 * Mounts the same Settings content as the dialog (all sections, add-on
 * panes, filters and status bar) without the modal chrome. Requests to open
 * Settings, including a specific section, are routed here by
 * SettingsTabBridge; an open tab follows later section requests.
 */
import { html, render, useEffect, useState } from '../vendor/preact-htm.js';
import type { PaneContext, PaneInstance, WebPaneExtension } from './pane-types.js';

export const SETTINGS_TAB_PATH = 'piclaw://settings';

/** Loads the Settings content component; supplied by the app so panes do not import UI components. */
export type SettingsContentLoader = () => Promise<any>;

function SettingsTab({ loadContent }) {
    const [Content, setContent] = useState(null);
    useEffect(() => {
        let cancelled = false;
        loadContent().then((component) => {
            if (!cancelled) setContent(() => component);
        });
        return () => { cancelled = true; };
    }, [loadContent]);
    if (!Content) {
        return html`<div class="settings-tab-loading"><span class="settings-spinner"></span><span>Loading settings…</span></div>`;
    }
    return html`<${Content} variant="tab" />`;
}

class SettingsPaneInstance implements PaneInstance {
    private host: HTMLElement;

    constructor(container: HTMLElement, loadContent: SettingsContentLoader) {
        this.host = document.createElement('div');
        this.host.className = 'settings-tab-host';
        container.appendChild(this.host);
        render(html`<${SettingsTab} loadContent=${loadContent} />`, this.host);
    }

    getContent() { return undefined; }
    isDirty() { return false; }
    focus() { (this.host.querySelector('.settings-nav-item.active, button') as HTMLElement | null)?.focus(); }
    dispose() {
        render(null, this.host);
        this.host.remove();
    }
}

export function createSettingsPane(loadContent: SettingsContentLoader): WebPaneExtension {
    return {
        id: 'settings',
        label: 'Settings',
        capabilities: ['readonly'],
        placement: 'tabs',
        canHandle(context: PaneContext) {
            return context.path === SETTINGS_TAB_PATH ? 9000 : false;
        },
        mount(container: HTMLElement) {
            return new SettingsPaneInstance(container, loadContent);
        },
    };
}
