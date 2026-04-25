import * as api from '../api.js';
import {
  paneRegistry,
  editorPaneExtension,
  preloadEditorBundle,
  terminalPaneExtension,
  terminalTabPaneExtension,
  vncPaneExtension,
  workspacePreviewPaneExtension,
  workspaceMarkdownPreviewPaneExtension,
  officeViewerPaneExtension,
  csvViewerPaneExtension,
  pdfViewerPaneExtension,
  imageViewerPaneExtension,
  htmlViewerPaneExtension,
  videoViewerPaneExtension,
  mindmapPaneExtension,
  kanbanPaneExtension,
} from '../panes/index.js';
import {
  installAddonWebApi,
  loadInstalledAddonWebEntries,
} from './addon-web-extensions.js';
import { resolveOptionalApi } from './optional-api.js';

interface AppApiSurface {
  [key: string]: any;
}

let initialized = false;
let browserNoiseFilterInstalled = false;
let serviceWorkerRegistrationStarted = false;

export function configureMarked(markedInstance: { setOptions?: (options: Record<string, unknown>) => void } | null | undefined): void {
  if (!markedInstance || typeof markedInstance.setOptions !== 'function') return;
  markedInstance.setOptions({
    breaks: true,
    gfm: true,
  });
}

export function installBrowserNoiseFilters(runtimeWindow: (Window & typeof globalThis) | null = typeof window !== 'undefined' ? window : null): void {
  if (!runtimeWindow || browserNoiseFilterInstalled) return;
  const handler = (event: ErrorEvent) => {
    const message = String(event?.message || event?.error?.message || '').trim();
    if (!/ResizeObserver loop (completed with undelivered notifications|limit exceeded)/i.test(message)) {
      // iOS fires opaque "Script error." at line 0 when the share sheet opens,
      // the app is backgrounded, or a cross-origin script triggers an exception.
      // These are not actionable and should be suppressed.
      const isOpaqueScriptError = message === 'Script error.' && (event?.lineno === 0 || !event?.filename);
      if (!isOpaqueScriptError) return;
    }
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
  };
  runtimeWindow.addEventListener('error', handler, true);
  browserNoiseFilterInstalled = true;
}

export function registerAppPaneExtensions(): void {
  paneRegistry.register(editorPaneExtension);
  paneRegistry.register(workspacePreviewPaneExtension);
  paneRegistry.register(workspaceMarkdownPreviewPaneExtension);
  paneRegistry.register(officeViewerPaneExtension);
  paneRegistry.register(csvViewerPaneExtension);
  paneRegistry.register(pdfViewerPaneExtension);
  paneRegistry.register(imageViewerPaneExtension);
  paneRegistry.register(htmlViewerPaneExtension);
  paneRegistry.register(videoViewerPaneExtension);
  paneRegistry.register(mindmapPaneExtension);
  paneRegistry.register(kanbanPaneExtension);
  paneRegistry.register(vncPaneExtension);
  preloadEditorBundle();
  paneRegistry.register(terminalPaneExtension);
  paneRegistry.register(terminalTabPaneExtension);
}

export function registerAppServiceWorker(runtimeWindow: (Window & typeof globalThis) | null = typeof window !== 'undefined' ? window : null): void {
  if (!runtimeWindow || serviceWorkerRegistrationStarted) return;
  if (!runtimeWindow.isSecureContext) return;
  if (!("serviceWorker" in runtimeWindow.navigator)) return;
  serviceWorkerRegistrationStarted = true;
  void runtimeWindow.navigator.serviceWorker.register('/sw.js').catch((error) => {
    console.warn('Failed to register app service worker:', error);
  });
}

export async function initializeAppShellRuntime(): Promise<void> {
  if (initialized) return;
  const runtimeWindow = typeof window !== 'undefined' ? window : null;
  const markedInstance = runtimeWindow
    ? (runtimeWindow as any)?.marked
    : null;
  configureMarked(markedInstance);
  installBrowserNoiseFilters(runtimeWindow);
  installAddonWebApi(runtimeWindow);
  registerAppPaneExtensions();
  await loadInstalledAddonWebEntries(runtimeWindow);
  registerAppServiceWorker(runtimeWindow);
  initialized = true;
}

export function resolveAppApiSurface(apiNamespace: Record<string, any> = api): AppApiSurface {
  return {
    searchPosts: apiNamespace.searchPosts,
    deletePost: apiNamespace.deletePost,
    getAgents: apiNamespace.getAgents,
    getAgentThought: apiNamespace.getAgentThought,
    setAgentThoughtVisibility: apiNamespace.setAgentThoughtVisibility,
    getAgentStatus: apiNamespace.getAgentStatus,
    getWorkspaceFile: apiNamespace.getWorkspaceFile,
    getThread: apiNamespace.getThread,
    getTimeline: apiNamespace.getTimeline,
    sendAgentMessage: apiNamespace.sendAgentMessage,
    forkChatBranch: apiNamespace.forkChatBranch,

    getAgentContext: resolveOptionalApi(apiNamespace, 'getAgentContext', null),
    getAutoresearchStatus: resolveOptionalApi(apiNamespace, 'getAutoresearchStatus', null),
    stopAutoresearch: resolveOptionalApi(apiNamespace, 'stopAutoresearch', { status: 'ok' }),
    dismissAutoresearch: resolveOptionalApi(apiNamespace, 'dismissAutoresearch', { status: 'ok' }),
    getAgentModels: resolveOptionalApi(apiNamespace, 'getAgentModels', { current: null, models: [] }),
    completeInstanceOobe: resolveOptionalApi(apiNamespace, 'completeInstanceOobe', { status: 'ok' }),
    getActiveChatAgents: resolveOptionalApi(apiNamespace, 'getActiveChatAgents', { chats: [] }),
    getChatBranches: resolveOptionalApi(apiNamespace, 'getChatBranches', { chats: [] }),
    renameChatBranch: resolveOptionalApi(apiNamespace, 'renameChatBranch', null),
    pruneChatBranch: resolveOptionalApi(apiNamespace, 'pruneChatBranch', null),
    restoreChatBranch: resolveOptionalApi(apiNamespace, 'restoreChatBranch', null),
    getAgentQueueState: resolveOptionalApi(apiNamespace, 'getAgentQueueState', { count: 0 }),
    steerAgentQueueItem: resolveOptionalApi(apiNamespace, 'steerAgentQueueItem', { removed: false, queued: 'steer' }),
    removeAgentQueueItem: resolveOptionalApi(apiNamespace, 'removeAgentQueueItem', { removed: false }),
    streamSidePrompt: resolveOptionalApi(apiNamespace, 'streamSidePrompt', null),
  };
}

export const appApi = resolveAppApiSurface(api);
