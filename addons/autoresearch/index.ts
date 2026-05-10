import type { PluginServices } from '../../types/plugin';

let researchRunning = false;

function createAutoresearchWidget(isRunning: boolean): string {
  const status = isRunning ? 'Research running' : 'Research idle';
  const buttonLabel = isRunning ? 'Stop Research' : 'Launch Research';
  const intent = isRunning ? 'autoresearch-stop' : 'autoresearch-launch';
  return `
    <div class="autoresearch-widget">
      <div class="status">${status}</div>
      <button data-intent="${intent}">${buttonLabel}</button>
    </div>
  `;
}

export default function register(services: PluginServices) {
  const { nativeWidgetService, sendDashboardWidget, researchController } = services;

  async function sendWidget() {
    const widgetHtml = createAutoresearchWidget(researchRunning);
    await sendDashboardWidget(widgetHtml);
  }

  services.registerIntentHandler('autoresearch-launch', async () => {
    if (researchRunning) return;
    researchRunning = true;
    await researchController.start();
    await sendWidget();
  });

  services.registerIntentHandler('autoresearch-stop', async () => {
    if (!researchRunning) return;
    researchRunning = false;
    await researchController.stop();
    await sendWidget();
  });

  // Initial widget send
  sendWidget();
}
