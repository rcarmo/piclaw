// @ts-nocheck
import { html } from '../vendor/preact-htm.js';

export function OobePanel({
  kind = 'hidden',
  onSetupProvider,
  onShowModelPicker,
  onOpenWorkspace,
  onDismiss,
}) {
  if (kind === 'hidden') return null;

  const isProviderMissing = kind === 'provider-missing';
  const title = isProviderMissing ? 'Connect an AI provider' : 'You’re ready to chat';
  const body = isProviderMissing
    ? 'The workspace is running, but it needs an AI provider before it can answer requests. Use /login to connect a provider or add an API key — it configures AI access, not web-app sign-in.'
    : 'An AI provider is available. You can use /model to select a model to use or explore the workspace to decide what you want to work on.';

  return html`
    <section class=${`oobe-panel oobe-panel-${kind}`} aria-label="Getting started">
      <div class="oobe-panel-copy">
        <div class="oobe-panel-eyebrow">Getting started</div>
        <h2 class="oobe-panel-title">${title}</h2>
        <p class="oobe-panel-body">${body}</p>
      </div>
      <div class="oobe-panel-actions">
        ${isProviderMissing
          ? html`
              <button type="button" class="oobe-panel-btn oobe-panel-btn-primary" onClick=${() => onSetupProvider?.()}>
                Set up with /login
              </button>
            `
          : html`
              <button type="button" class="oobe-panel-btn oobe-panel-btn-primary" onClick=${() => onShowModelPicker?.()}>
                Try /model
              </button>
              <button type="button" class="oobe-panel-btn" onClick=${() => onOpenWorkspace?.()}>
                Open workspace
              </button>
            `}
        <button type="button" class="oobe-panel-btn" onClick=${() => onDismiss?.()}>
          ${isProviderMissing ? 'Dismiss' : 'Got it'}
        </button>
      </div>
    </section>
  `;
}
