// Web-client internationalization (i18n) substrate.
//
// Slice 1 foundation for issue #392:
// - English is the default and fallback locale.
// - An explicit locale override is persisted in localStorage (`piclaw_locale`).
// - Browser language is used only as a default *hint* when nothing is stored.
// - A shared `t()` helper plus Preact hooks (`useLocale` / `useTranslation`)
//   resolve web-chrome strings with safe fallback to English, then to the key.
//
// Locale-code scheme is locked here so Chinese and Japanese land as peer
// locales on the same key set:
//   - `en`    English (default / fallback)
//   - `zh-CN` Simplified Chinese
//   - `ja`    Japanese
// Legacy/loose inputs (`zh`, `zh_cn`, `ja-JP`, ...) normalize into the above.

import { getLocalStorageItem, setLocalStorageItem } from './storage.js';
import { useEffect, useState } from '../vendor/preact-htm.js';

export type Locale = 'en' | 'zh-CN' | 'ja';

export const DEFAULT_LOCALE: Locale = 'en';
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'zh-CN', 'ja'];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  ja: '日本語',
};

const LOCALE_STORAGE_KEY = 'piclaw_locale';
const LOCALE_CHANGE_EVENT = 'piclaw-locale-change';

// English is the source-of-truth key set. Other locales are partial and fall
// back to English per key, so an untranslated key never breaks the UI.
type MessageKey =
  | 'compose.placeholder'
  | 'compose.send'
  | 'compose.stop'
  | 'compose.searchPlaceholder'
  | 'compose.clearAll'
  | 'compose.clearAllTitle'
  | 'compose.scope'
  | 'compose.searchScope'
  | 'compose.scopeCurrent'
  | 'compose.scopeBranchFamily'
  | 'compose.scopeAll'
  | 'compose.filterImages'
  | 'compose.filterAttachments'
  | 'compose.search'
  | 'compose.closeSearch'
  | 'compose.shareLocation'
  | 'compose.attachFile'
  | 'compose.queueControls'
  | 'compose.moveUp'
  | 'compose.moveUpQueue'
  | 'compose.moveDown'
  | 'compose.moveDownQueue'
  | 'compose.editInCompose'
  | 'compose.returnToEditor'
  | 'compose.injectSteer'
  | 'compose.steer'
  | 'compose.cancelQueued'
  | 'compose.resizeInput'
  | 'compose.resizeInputHint'
  | 'compose.modelPicker'
  | 'compose.sessionsAndAgents'
  | 'compose.openModelPicker'
  | 'compose.newBranchTitle'
  | 'compose.newRootTitle'
  | 'compose.renameSessionTitle'
  | 'compose.pruneSessionTitle'
  | 'compose.filterImagesTitle'
  | 'compose.filterAttachmentsTitle'
  | 'compose.selectModel'
  | 'compose.loadingModels'
  | 'compose.noModels'
  | 'compose.nextModel'
  | 'compose.manageSessions'
  | 'compose.noSessions'
  | 'compose.newBranch'
  | 'compose.newRoot'
  | 'compose.mergeCurrent'
  | 'compose.renameCurrent'
  | 'compose.deleteCurrent'
  | 'compose.mergeInto'
  | 'compose.mergeBlocked'
  | 'workspace.title'
  | 'workspace.moveConfirm'
  | 'workspace.root'
  | 'workspace.file'
  | 'workspace.folder'
  | 'workspace.newFile'
  | 'workspace.refresh'
  | 'workspace.actions'
  | 'workspace.uploadFiles'
  | 'workspace.reindexing'
  | 'workspace.deleteFile'
  | 'workspace.download'
  | 'workspace.uploadToFolder'
  | 'workspace.addFolderHint'
  | 'workspace.downloadZip'
  | 'workspace.openInTab'
  | 'workspace.openInEditor'
  | 'workspace.renameSelected'
  | 'workspace.downloadSelectedFile'
  | 'workspace.downloadSelectedFolder'
  | 'workspace.deleteSelectedFile'
  | 'shell.settings'
  | 'shell.newChat'
  | 'shell.connecting'
  | 'shell.connected'
  | 'language.label'
  // Settings dialog chrome (nav labels, header, search placeholders).
  | 'settings.title'
  | 'settings.close'
  | 'settings.filter'
  | 'settings.loading'
  | 'settings.section.general'
  | 'settings.section.sessions'
  | 'settings.section.recordings'
  | 'settings.section.compaction'
  | 'settings.section.keyboard'
  | 'settings.section.workspace'
  | 'settings.section.environment'
  | 'settings.section.providers'
  | 'settings.section.models'
  | 'settings.section.theme'
  | 'settings.section.scheduled-tasks'
  | 'settings.section.quick-actions'
  | 'settings.section.keychain'
  | 'settings.section.tools'
  | 'settings.section.addons'
  | 'settings.placeholder.recordings'
  | 'settings.placeholder.keyboard'
  | 'settings.placeholder.environment'
  | 'settings.placeholder.models'
  | 'settings.placeholder.scheduled-tasks'
  | 'settings.placeholder.quick-actions'
  | 'settings.placeholder.keychain'
  | 'settings.placeholder.tools'
  | 'settings.placeholder.addons'
  // Other top-level surfaces (post, tabs, status, annotator, tree, preview).
  | 'preview.close'
  | 'preview.loading'
  | 'preview.files'
  | 'preview.folders'
  | 'preview.compressed'
  | 'preview.uncompressed'
  | 'preview.name'
  | 'preview.type'
  | 'preview.method'
  | 'preview.size'
  | 'post.deleteMessage'
  | 'post.tooLarge'
  | 'post.previewTruncated'
  | 'post.submitted'
  | 'post.discard'
  | 'post.save'
  | 'post.cancel'
  | 'post.addNote'
  | 'post.addNotePlaceholder'
  | 'post.restartNotice'
  | 'post.restartCompleted'
  | 'post.agentSelfResume'
  | 'tab.close'
  | 'tab.closeOthers'
  | 'tab.closeAll'
  | 'tab.reattach'
  | 'tab.openInWindow'
  | 'tab.openInNewTab'
  | 'tab.pinned'
  | 'tab.detached'
  | 'tab.openSeparateWindow'
  | 'status.trackedVariables'
  | 'status.attachToSession'
  | 'status.files'
  | 'status.proposedDiff'
  | 'status.copyTmux'
  | 'status.experimentDuration'
  | 'status.sinceLastActivity'
  | 'annotator.title'
  | 'annotator.typeLabel'
  | 'annotator.undo'
  | 'annotator.resetZoom'
  | 'tree.filter'
  | 'tree.sessionTree'
  | 'btw.label'
  | 'btw.close'
  | 'btw.thinking'
  | 'mdpreview.close'
  | 'mdpreview.unavailable'
  | 'widget.close'
  | 'oobe.gettingStarted'
  | 'oobe.needsSetupTitle'
  | 'oobe.configuredTitle'
  | 'oobe.needsSetupBody'
  | 'oobe.configuredBody'
  | 'oobe.openSettings'
  | 'oobe.dismiss'
  | 'oobe.done'
  | 'palette.placeholder'
  | 'palette.hideWorkspace'
  | 'palette.showWorkspace'
  | 'palette.hideWorkspaceDesc'
  | 'palette.showWorkspaceDesc'
  | 'palette.exitChatOnly'
  | 'palette.chatOnly'
  | 'palette.exitChatOnlyDesc'
  | 'palette.chatOnlyDesc'
  | 'palette.groupAgents'
  | 'palette.groupWorkspace'
  | 'palette.groupSlash'
  | 'palette.hintMove'
  | 'palette.hintSelect'
  | 'palette.hintPopOut'
  | 'palette.hintClose'
  // Settings sub-panes (slice 1: sessions, editor, appearance).
  | 'settings.appliedNotice'
  | 'settings.sessions.lifecycle'
  | 'settings.sessions.autoRotate'
  | 'settings.sessions.maxSize'
  | 'settings.sessions.maxSizeAria'
  | 'settings.sessions.agentBehaviour'
  | 'settings.sessions.toolBudget'
  | 'settings.sessions.toolBudgetAria'
  | 'settings.sessions.toolBudgetHint'
  | 'settings.sessions.isolation'
  | 'settings.sessions.isolationNone'
  | 'settings.sessions.isolationSummary'
  | 'settings.sessions.isolationFull'
  | 'settings.editor.heading'
  | 'settings.editor.vimMode'
  | 'settings.editor.showWhitespace'
  | 'settings.editor.livePreview'
  | 'settings.editor.fontSize'
  | 'settings.editor.fontSizeAria'
  | 'settings.editor.fontFamily'
  | 'settings.editor.fontFamilyPlaceholder'
  | 'settings.editor.localOnlyHint'
  | 'settings.appearance.syncing'
  | 'settings.appearance.default'
  | 'settings.appearance.autoLightDark'
  | 'settings.appearance.tint'
  | 'settings.appearance.clearTint'
  | 'settings.appearance.none'
  | 'settings.appearance.outputPadding'
  | 'settings.appearance.outputPaddingHint'
  // Settings slice 2: keyboard, workspace, models, tools.
  | 'settings.keyboard.heading'
  | 'settings.keyboard.hint1'
  | 'settings.keyboard.hint1b'
  | 'settings.keyboard.hint2mid'
  | 'settings.keyboard.hint2end'
  | 'settings.keyboard.resetAll'
  | 'settings.keyboard.defaultColon'
  | 'settings.keyboard.save'
  | 'settings.keyboard.defaultBtn'
  | 'settings.keyboard.noMatch'
  | 'settings.keyboard.invalidShortcut'
  | 'settings.keyboard.saved'
  | 'settings.keyboard.resetOne'
  | 'settings.keyboard.resetAllDone'
  | 'settings.workspace.serverApplied'
  | 'settings.workspace.browserApplied'
  | 'settings.workspace.access'
  | 'settings.workspace.enableTerminal'
  | 'settings.workspace.allowVnc'
  | 'settings.workspace.accessHint'
  | 'settings.workspace.guardrails'
  | 'settings.workspace.maxDepth'
  | 'settings.workspace.maxDepthAria'
  | 'settings.workspace.maxDepthHintPre'
  | 'settings.workspace.maxDepthHintPost'
  | 'settings.workspace.maxEntries'
  | 'settings.workspace.maxEntriesAria'
  | 'settings.workspace.maxEntriesHint'
  | 'settings.workspace.thisBrowser'
  | 'settings.workspace.refreshInterval'
  | 'settings.workspace.refreshIntervalAria'
  | 'settings.workspace.folderDepth'
  | 'settings.workspace.folderDepthAria'
  | 'settings.workspace.folderDepthHintPre'
  | 'settings.workspace.folderDepthHintPost'
  | 'settings.workspace.footerHint'
  | 'settings.models.thinkingLevel'
  | 'settings.models.noThinking'
  | 'settings.models.thinkingLevelLabel'
  | 'settings.models.loading'
  | 'settings.models.summary'
  | 'settings.models.scopedOnly'
  | 'settings.models.scopedCheckboxPre'
  | 'settings.models.scopedCheckboxPost'
  | 'settings.models.scopedHintPre'
  | 'settings.models.scopedHintPost'
  | 'settings.models.colModel'
  | 'settings.models.colProvider'
  | 'settings.models.colContext'
  | 'settings.models.colReasoning'
  | 'settings.models.noMatch'
  | 'settings.tools.unavailable'
  | 'settings.tools.search'
  | 'settings.tools.matchMode'
  | 'settings.tools.orMode'
  | 'settings.tools.andMode'
  | 'settings.tools.colEnabled'
  | 'settings.tools.colTool'
  | 'settings.tools.colCompact'
  | 'settings.tools.colKind'
  | 'settings.tools.colSummary'
  | 'settings.tools.colSource'
  | 'settings.tools.disableCompaction'
  | 'settings.tools.enableCompaction'
  | 'settings.tools.noMatch'
  | 'settings.tools.footer'
  // Settings slice 3: environment, quick-actions, providers.
  | 'settings.environment.heading'
  | 'settings.environment.introPre'
  | 'settings.environment.introPost'
  | 'settings.environment.refresh'
  | 'settings.environment.addOverride'
  | 'settings.environment.valuePlaceholder'
  | 'settings.environment.save'
  | 'settings.environment.countLine'
  | 'settings.environment.overridden'
  | 'settings.environment.inherited'
  | 'settings.environment.kindOverride'
  | 'settings.environment.kindProcess'
  | 'settings.environment.clear'
  | 'settings.environment.noMatch'
  | 'settings.environment.refreshedToast'
  | 'settings.environment.savedToast'
  | 'settings.environment.clearedToast'
  | 'settings.quickActions.loading'
  | 'settings.quickActions.heading'
  | 'settings.quickActions.intro'
  | 'settings.quickActions.enableAll'
  | 'settings.quickActions.saving'
  | 'settings.quickActions.saveApply'
  | 'settings.quickActions.workspaceCommands'
  | 'settings.quickActions.noWorkspaceMatch'
  | 'settings.quickActions.slashCommands'
  | 'settings.quickActions.slashFallback'
  | 'settings.quickActions.noSlashMatch'
  | 'settings.quickActions.savingToast'
  | 'settings.quickActions.savedToast'
  | 'settings.providers.authApiKey'
  | 'settings.providers.authConfigured'
  | 'settings.providers.heading'
  | 'settings.providers.tagCustom'
  | 'settings.providers.logout'
  | 'settings.providers.reconfigure'
  | 'settings.providers.setUp'
  | 'settings.providers.setupHint'
  | 'settings.providers.starting'
  | 'settings.providers.signInOAuth'
  | 'settings.providers.apiKeyLabel'
  | 'settings.providers.apiKeyPlaceholder'
  | 'settings.providers.save'
  | 'settings.providers.configuring'
  | 'settings.providers.saveConfig'
  | 'settings.providers.apiKeyEmpty'
  | 'settings.providers.configuringToast'
  | 'settings.providers.configured'
  | 'settings.providers.startingOAuth'
  | 'settings.providers.oauthOpened'
  | 'settings.providers.oauthStarted'
  | 'settings.providers.loggingOut'
  | 'settings.providers.loggedOut'
  // Settings slice 4: general.
  | 'settings.general.identity'
  | 'settings.general.userLabel'
  | 'settings.general.yourName'
  | 'settings.general.agentLabel'
  | 'settings.general.agentName'
  | 'settings.general.notifications'
  | 'settings.general.browserNotifications'
  | 'settings.general.notifSecureHint'
  | 'settings.general.notifInsecureHint'
  | 'settings.general.display'
  | 'settings.general.systemMeters'
  | 'settings.general.systemMetersHint'
  | 'settings.general.instanceConfig'
  | 'settings.general.composeUpload'
  | 'settings.general.composeUploadAria'
  | 'settings.general.composeUploadHint'
  | 'settings.general.workspaceUpload'
  | 'settings.general.workspaceUploadAria'
  | 'settings.general.workspaceUploadHint'
  | 'settings.general.agentRecovery'
  | 'settings.general.automaticRecovery'
  | 'settings.general.automaticRecoveryHint'
  | 'settings.general.recoveryMaxAttempts'
  | 'settings.general.recoveryMaxAttemptsAria'
  | 'settings.general.recoveryMaxAttemptsHint'
  | 'settings.general.recoveryTotalBudget'
  | 'settings.general.recoveryTotalBudgetAria'
  | 'settings.general.recoveryTotalBudgetHint'
  | 'settings.general.authentication'
  | 'settings.general.widgetToken'
  | 'settings.general.token'
  | 'settings.general.hideToken'
  | 'settings.general.revealToken'
  | 'settings.general.copyToken'
  | 'settings.general.copied'
  | 'settings.general.regenerating'
  | 'settings.general.regenerate'
  | 'settings.general.tokenHintPre'
  | 'settings.general.tokenHintMid'
  | 'settings.general.tokenHintPost'
  | 'settings.general.tokenHintEnd'
  | 'settings.general.copyFailed'
  | 'settings.general.regenConfirm'
  | 'settings.general.totpTitle'
  | 'settings.general.totpConfiguredHint'
  | 'settings.general.totpUnconfiguredHint'
  | 'settings.general.issuer'
  | 'settings.general.label'
  | 'settings.general.secret'
  | 'settings.general.avatarUpload'
  // Settings slice 5: developer, addons.
  | 'settings.developer.heading'
  | 'settings.developer.devMode'
  | 'settings.developer.localHint'
  | 'settings.developer.addonSources'
  | 'settings.developer.catalogUrl'
  | 'settings.developer.catalogHint'
  | 'settings.developer.additionalCatalogs'
  | 'settings.developer.additionalHint'
  | 'settings.developer.repoUrl'
  | 'settings.developer.repoHintPre'
  | 'settings.developer.repoHintPost'
  | 'settings.developer.debug'
  | 'settings.developer.logSse'
  | 'settings.developer.logToolCalls'
  | 'settings.developer.debugHint'
  | 'settings.addons.installing'
  | 'settings.addons.removing'
  | 'settings.addons.installedToast'
  | 'settings.addons.removedToast'
  | 'settings.addons.restarting'
  | 'settings.addons.restartComplete'
  | 'settings.addons.restartTimeout'
  | 'settings.addons.fetching'
  | 'settings.addons.loadFailed'
  | 'settings.addons.catalogFromPre'
  | 'settings.addons.catalogMerged'
  | 'settings.addons.installNote'
  | 'settings.addons.failedFetchSingular'
  | 'settings.addons.failedFetchPlural'
  | 'settings.addons.activeSources'
  | 'settings.addons.windowsWarning'
  | 'settings.addons.typeExtSkill'
  | 'settings.addons.typeSkill'
  | 'settings.addons.typeExt'
  | 'settings.addons.update'
  | 'settings.addons.remove'
  | 'settings.addons.install'
  | 'settings.addons.noMatch'
  | 'settings.addons.restartNotice'
  | 'settings.addons.restartNow'
  | 'settings.recordings.modeFull'
  | 'settings.recordings.modeMetadata'
  | 'settings.recordings.modeRedacted'
  | 'settings.recordings.selectPrompt'
  | 'settings.recordings.playback'
  | 'settings.recordings.refresh'
  | 'settings.recordings.delete'
  | 'settings.recordings.status'
  | 'settings.recordings.mode'
  | 'settings.recordings.chat'
  | 'settings.recordings.started'
  | 'settings.recordings.ended'
  | 'settings.recordings.events'
  | 'settings.recordings.redactions'
  | 'settings.recordings.exportJson'
  | 'settings.recordings.exportJsonl'
  | 'settings.recordings.exportHtml'
  | 'settings.recordings.eventSummary'
  | 'settings.recordings.inspectHint'
  | 'settings.recordings.firstEvents'
  | 'settings.recordings.heading'
  | 'settings.recordings.intro'
  | 'settings.recordings.chatJid'
  | 'settings.recordings.title'
  | 'settings.recordings.titlePlaceholder'
  | 'settings.recordings.modeLabelField'
  | 'settings.recordings.optRedacted'
  | 'settings.recordings.optMetadata'
  | 'settings.recordings.optFull'
  | 'settings.recordings.includeSnapshot'
  | 'settings.recordings.extraKeys'
  | 'settings.recordings.extraPatterns'
  | 'settings.recordings.stopCurrent'
  | 'settings.recordings.start'
  | 'settings.recordings.redactionPreview'
  | 'settings.recordings.previewRedaction'
  | 'settings.recordings.loading'
  | 'settings.recordings.noneYet'
  | 'settings.recordings.noneYetHint'
  | 'settings.recordings.listLabel'
  | 'settings.recordings.eventsCount'
  | 'settings.recordings.noMatch'
  | 'settings.recordings.startedToast'
  | 'settings.recordings.startFailed'
  | 'settings.recordings.stoppedToast'
  | 'settings.recordings.stopFailed'
  | 'settings.recordings.deleteConfirm'
  | 'settings.recordings.deletedToast'
  | 'settings.recordings.deleteFailed'
  | 'settings.recordings.loadOneFailed'
  | 'settings.recordings.loadFailed'
  | 'settings.recordings.previewFailed'
  | 'settings.keychain.loadFailed'
  | 'settings.keychain.addFailed'
  | 'settings.keychain.deleteFailed'
  | 'settings.keychain.saveNotesFailed'
  | 'settings.keychain.revealFailed'
  | 'settings.keychain.loading'
  | 'settings.keychain.entryCountSingular'
  | 'settings.keychain.entryCountPlural'
  | 'settings.keychain.matchingFilter'
  | 'settings.keychain.encryptedSuffix'
  | 'settings.keychain.clickPrefix'
  | 'settings.keychain.revealSuffix'
  | 'settings.keychain.cancel'
  | 'settings.keychain.addEntry'
  | 'settings.keychain.namePlaceholder'
  | 'settings.keychain.secretPlaceholder'
  | 'settings.keychain.usernamePlaceholder'
  | 'settings.keychain.saving'
  | 'settings.keychain.save'
  | 'settings.keychain.userNotePlaceholder'
  | 'settings.keychain.agentNotePlaceholder'
  | 'settings.keychain.noMatchFilter'
  | 'settings.keychain.noEntries'
  | 'settings.keychain.hideSecret'
  | 'settings.keychain.revealSecret'
  | 'settings.keychain.deleteQ'
  | 'settings.keychain.yes'
  | 'settings.keychain.no'
  | 'settings.keychain.deleteTitle'
  | 'settings.keychain.userNote'
  | 'settings.keychain.agentNote'
  | 'settings.keychain.userNoteHint'
  | 'settings.keychain.agentNoteHint'
  | 'settings.keychain.saveNotes'
  | 'settings.keychain.masterPassword'
  | 'settings.keychain.masterPasswordPlaceholder'
  | 'settings.keychain.unlock'
  | 'settings.keychain.totpCode'
  | 'settings.keychain.verify'
  | 'settings.keychain.username'
  | 'settings.keychain.copyUsername'
  | 'settings.keychain.secret'
  | 'settings.keychain.copySecret'
  | 'settings.tasks.internalProtected'
  | 'settings.tasks.noRunLogs'
  | 'settings.tasks.noSummary'
  | 'settings.tasks.selectPrompt'
  | 'settings.tasks.pause'
  | 'settings.tasks.resume'
  | 'settings.tasks.delete'
  | 'settings.tasks.status'
  | 'settings.tasks.kind'
  | 'settings.tasks.schedule'
  | 'settings.tasks.nextRun'
  | 'settings.tasks.lastRun'
  | 'settings.tasks.lastResult'
  | 'settings.tasks.chat'
  | 'settings.tasks.model'
  | 'settings.tasks.cwd'
  | 'settings.tasks.timeout'
  | 'settings.tasks.protection'
  | 'settings.tasks.protectionHint'
  | 'settings.tasks.command'
  | 'settings.tasks.prompt'
  | 'settings.tasks.recentRuns'
  | 'settings.tasks.activeLabel'
  | 'settings.tasks.pausedLabel'
  | 'settings.tasks.completedLabel'
  | 'settings.tasks.allStatuses'
  | 'settings.tasks.filterChatPlaceholder'
  | 'settings.tasks.refresh'
  | 'settings.tasks.loading'
  | 'settings.tasks.noneFound'
  | 'settings.tasks.noneFoundHint'
  | 'settings.tasks.listLabel'
  | 'settings.tasks.next'
  | 'settings.tasks.last'
  | 'settings.tasks.noMatch'
  | 'settings.tasks.confirmDelete'
  | 'settings.tasks.confirmPause'
  | 'settings.tasks.confirmResume'
  | 'settings.tasks.confirmProtected'
  | 'settings.tasks.deleting'
  | 'settings.tasks.pausing'
  | 'settings.tasks.resuming'
  | 'settings.tasks.deletedToast'
  | 'settings.tasks.pausedToast'
  | 'settings.tasks.resumedToast'
  | 'settings.tasks.actionFailed'
  | 'settings.tasks.loadFailed'
  | 'settings.compaction.appliedNotice'
  | 'settings.compaction.saving'
  | 'settings.compaction.saveFailed'
  | 'settings.compaction.saved'
  | 'settings.compaction.clearing'
  | 'settings.compaction.clearFailed'
  | 'settings.compaction.cleared'
  | 'settings.compaction.autoHeading'
  | 'settings.compaction.enableAutomatic'
  | 'settings.compaction.enableAutomaticHint'
  | 'settings.compaction.processingMethod'
  | 'settings.compaction.model'
  | 'settings.compaction.modelHint'
  | 'settings.compaction.modelPlaceholder'
  | 'settings.compaction.methodSelective'
  | 'settings.compaction.methodSelectiveHint'
  | 'settings.compaction.methodPipelined'
  | 'settings.compaction.methodPipelinedHint'
  | 'settings.compaction.remoteNative'
  | 'settings.compaction.remoteNativeHint'
  | 'settings.compaction.remoteTimeout'
  | 'settings.compaction.remoteTimeoutAria'
  | 'settings.compaction.remoteTimeoutHint'
  | 'settings.compaction.enableToolResult'
  | 'settings.compaction.enableToolResultHint'
  | 'settings.compaction.semanticSummaries'
  | 'settings.compaction.semanticSummariesHint'
  | 'settings.compaction.inputLimit'
  | 'settings.compaction.inputLimitAria'
  | 'settings.compaction.inputLimitHint'
  | 'settings.compaction.maxTokens'
  | 'settings.compaction.maxTokensAria'
  | 'settings.compaction.maxTokensHint'
  | 'settings.compaction.summaryTimeout'
  | 'settings.compaction.summaryTimeoutAria'
  | 'settings.compaction.summaryTimeoutHint'
  | 'settings.compaction.threshold'
  | 'settings.compaction.thresholdAria'
  | 'settings.compaction.thresholdHint'
  | 'settings.compaction.timeout'
  | 'settings.compaction.timeoutAria'
  | 'settings.compaction.timeoutHint'
  | 'settings.compaction.backoffBase'
  | 'settings.compaction.backoffBaseAria'
  | 'settings.compaction.backoffBaseHint'
  | 'settings.compaction.backoffMax'
  | 'settings.compaction.backoffMaxAria'
  | 'settings.compaction.backoffMaxHint'
  | 'settings.compaction.decayFactor'
  | 'settings.compaction.decayFactorAria'
  | 'settings.compaction.decayFactorHint'
  | 'settings.compaction.watchdogHeading'
  | 'settings.compaction.enableWatchdog'
  | 'settings.compaction.enableWatchdogHint'
  | 'settings.compaction.watchdogTimeout'
  | 'settings.compaction.watchdogTimeoutAria'
  | 'settings.compaction.watchdogTimeoutHint'
  | 'settings.compaction.suppressionsHeading'
  | 'settings.compaction.noBackoff'
  | 'settings.compaction.clear'
  | 'settings.compaction.phasesHeading'
  | 'settings.compaction.noPhases'
  // Timeline / workspace hamburger menu (first localized v1 surface).
  | 'menu.title'
  | 'menu.showWorkspace'
  | 'menu.hideWorkspace'
  | 'menu.openExplorer'
  | 'menu.chatOnly'
  | 'menu.exitChatOnly'
  | 'menu.openTerminal'
  | 'menu.openVnc'
  | 'menu.newFile'
  | 'menu.openRecent'
  | 'menu.refreshTree'
  | 'menu.reindex'
  | 'menu.showHidden'
  | 'menu.hideHidden'
  | 'menu.scale'
  | 'menu.settings';

const EN: Record<MessageKey, string> = {
  'compose.placeholder': 'Message (Enter to send, Shift+Enter for newline)...',
  'compose.send': 'Send',
  'compose.stop': 'Stop',
  'compose.searchPlaceholder': 'Search (Enter to run)...',
  'compose.clearAll': 'Clear all',
  'compose.clearAllTitle': 'Clear all attachments and references',
  'compose.scope': 'Scope',
  'compose.searchScope': 'Search scope',
  'compose.scopeCurrent': 'Current',
  'compose.scopeBranchFamily': 'Branch family',
  'compose.scopeAll': 'All chats',
  'compose.filterImages': 'Images',
  'compose.filterAttachments': 'Attachments',
  'compose.search': 'Search',
  'compose.closeSearch': 'Close search',
  'compose.shareLocation': 'Share location',
  'compose.attachFile': 'Attach file',
  'compose.queueControls': 'Queued follow-up controls',
  'compose.moveUp': 'Move up',
  'compose.moveUpQueue': 'Move up in queue',
  'compose.moveDown': 'Move down',
  'compose.moveDownQueue': 'Move down in queue',
  'compose.editInCompose': 'Edit in compose',
  'compose.returnToEditor': 'Return queued message to editor',
  'compose.injectSteer': 'Inject queued follow-up as steer',
  'compose.steer': 'Steer',
  'compose.cancelQueued': 'Cancel queued message',
  'compose.resizeInput': 'Resize message input',
  'compose.resizeInputHint': 'Drag to resize message input',
  'compose.modelPicker': 'Model picker',
  'compose.sessionsAndAgents': 'Sessions and agents',
  'compose.openModelPicker': 'Open model picker',
  'compose.newBranchTitle': 'Create a new branch from this chat',
  'compose.newRootTitle': 'Create a clean root session such as web:ops',
  'compose.renameSessionTitle': 'Rename the current session',
  'compose.pruneSessionTitle': 'Delete (prune) current agent/session branch',
  'compose.filterImagesTitle': 'Only show messages with images',
  'compose.filterAttachmentsTitle': 'Only show messages with attachments',
  'compose.selectModel': 'Select model',
  'compose.loadingModels': 'Loading models…',
  'compose.noModels': 'No models available.',
  'compose.nextModel': 'Next model',
  'compose.manageSessions': 'Manage sessions & agents',
  'compose.noSessions': 'No other sessions yet.',
  'compose.newBranch': 'New branch',
  'compose.newRoot': 'New root…',
  'compose.mergeCurrent': 'Merge current w/ parent',
  'compose.renameCurrent': 'Rename current…',
  'compose.deleteCurrent': 'Delete current…',
  'compose.mergeInto': 'Merge this branch into {target}',
  'compose.mergeBlocked': 'This branch cannot be merged while active or while it has children',
  'workspace.title': 'Workspace',
  'workspace.moveConfirm': 'Move {entry} "{name}" from {source} to {target}?',
  'workspace.root': 'the workspace root',
  'workspace.file': 'file',
  'workspace.folder': 'folder',
  'workspace.newFile': 'New file',
  'workspace.refresh': 'Refresh',
  'workspace.actions': 'Workspace actions',
  'workspace.uploadFiles': 'Upload files',
  'workspace.reindexing': 'Reindexing workspace…',
  'workspace.deleteFile': 'Delete file',
  'workspace.download': 'Download',
  'workspace.uploadToFolder': 'Upload files to this folder',
  'workspace.addFolderHint': 'Add folder hint to compose',
  'workspace.downloadZip': 'Download folder as zip',
  'workspace.openInTab': 'Open in tab',
  'workspace.openInEditor': 'Open in editor',
  'workspace.renameSelected': 'Rename selected',
  'workspace.downloadSelectedFile': 'Download selected file',
  'workspace.downloadSelectedFolder': 'Download selected folder (zip)',
  'workspace.deleteSelectedFile': 'Delete selected file',
  'shell.settings': 'Settings',
  'shell.newChat': 'New chat',
  'shell.connecting': 'Connecting…',
  'shell.connected': 'Connected',
  'language.label': 'Language',
  'settings.title': 'Settings',
  'settings.close': 'Close (Esc)',
  'settings.filter': 'Filter…',
  'settings.loading': 'Loading settings…',
  'settings.section.general': 'General',
  'settings.section.sessions': 'Sessions',
  'settings.section.recordings': 'Recordings',
  'settings.section.compaction': 'Compaction',
  'settings.section.keyboard': 'Keyboard',
  'settings.section.workspace': 'Workspace',
  'settings.section.environment': 'Environment',
  'settings.section.providers': 'Providers',
  'settings.section.models': 'Models',
  'settings.section.theme': 'Appearance',
  'settings.section.scheduled-tasks': 'Scheduled Tasks',
  'settings.section.quick-actions': 'Quick Actions',
  'settings.section.keychain': 'Keychain',
  'settings.section.tools': 'Tools',
  'settings.section.addons': 'Add-ons',
  'settings.placeholder.recordings': 'Filter recordings…',
  'settings.placeholder.keyboard': 'Filter shortcuts…',
  'settings.placeholder.environment': 'Filter environment…',
  'settings.placeholder.models': 'Filter models…',
  'settings.placeholder.scheduled-tasks': 'Filter scheduled tasks…',
  'settings.placeholder.quick-actions': 'Filter quick actions…',
  'settings.placeholder.keychain': 'Filter entries…',
  'settings.placeholder.tools': 'Filter tools…',
  'settings.placeholder.addons': 'Filter add-ons…',
  'preview.close': 'Close',
  'preview.loading': 'Loading preview…',
  'preview.files': 'Files',
  'preview.folders': 'Folders',
  'preview.compressed': 'Compressed',
  'preview.uncompressed': 'Uncompressed',
  'preview.name': 'Name',
  'preview.type': 'Type',
  'preview.method': 'Method',
  'preview.size': 'Size',
  'post.deleteMessage': 'Delete message',
  'post.tooLarge': 'Message too large to display.',
  'post.previewTruncated': 'Preview truncated.',
  'post.submitted': 'Submitted',
  'post.discard': 'Discard',
  'post.save': 'Save',
  'post.cancel': 'Cancel',
  'post.addNote': 'Add note',
  'post.addNotePlaceholder': 'Add a note…',
  'post.restartNotice': 'Restarting now — Reason: {reason}',
  'post.restartCompleted': 'Restart completed.',
  'post.agentSelfResume': 'Agent self-resume',
  'tab.close': 'Close',
  'tab.closeOthers': 'Close Others',
  'tab.closeAll': 'Close All',
  'tab.reattach': 'Reattach',
  'tab.openInWindow': 'Open in Window',
  'tab.openInNewTab': 'Open in New Tab',
  'tab.pinned': 'Pinned',
  'tab.detached': 'Detached',
  'tab.openSeparateWindow': 'Open in separate window',
  'status.trackedVariables': 'Tracked variables',
  'status.attachToSession': 'Attach to session',
  'status.files': 'Files',
  'status.proposedDiff': 'Proposed diff',
  'status.copyTmux': 'Copy tmux command',
  'status.experimentDuration': 'Experiment duration',
  'status.sinceLastActivity': 'Since last activity',
  'annotator.title': 'Annotate image',
  'annotator.typeLabel': 'Type label…',
  'annotator.undo': 'Undo',
  'annotator.resetZoom': 'Reset zoom',
  'tree.filter': 'Filter…',
  'tree.sessionTree': 'Session tree',
  'btw.label': 'BTW side conversation',
  'btw.close': 'Close BTW',
  'btw.thinking': 'Thinking',
  'mdpreview.close': 'Close preview',
  'mdpreview.unavailable': 'Preview unavailable',
  'widget.close': 'Close widget',
  'oobe.gettingStarted': 'Getting started',
  'oobe.needsSetupTitle': 'Instance needs setup',
  'oobe.configuredTitle': 'Instance is configured',
  'oobe.needsSetupBody': 'This instance is not yet configured. Open Settings and set up AI providers/models to start sending requests.',
  'oobe.configuredBody': 'This instance looks configured. Review or update provider and model settings in Settings.',
  'oobe.openSettings': 'Open Settings',
  'oobe.dismiss': 'Dismiss',
  'oobe.done': 'Done',
  'palette.placeholder': 'Type to jump to an agent, workspace action, or slash command…',
  'palette.hideWorkspace': 'Hide workspace',
  'palette.showWorkspace': 'Show workspace',
  'palette.hideWorkspaceDesc': 'Hide the workspace sidebar.',
  'palette.showWorkspaceDesc': 'Show the workspace sidebar.',
  'palette.exitChatOnly': 'Exit chat-only mode',
  'palette.chatOnly': 'Chat-only mode',
  'palette.exitChatOnlyDesc': 'Return to the split workspace layout.',
  'palette.chatOnlyDesc': 'Switch to the chat-only layout.',
  'palette.groupAgents': 'Agents',
  'palette.groupWorkspace': 'Workspace',
  'palette.groupSlash': 'Slash commands',
  'palette.hintMove': 'Move',
  'palette.hintSelect': 'Select',
  'palette.hintPopOut': 'Pop out',
  'palette.hintClose': 'Close',
  'settings.appliedNotice': 'Settings applied. Changes take effect on the next turn.',
  'settings.sessions.lifecycle': 'Session Lifecycle',
  'settings.sessions.autoRotate': 'Auto-rotate sessions',
  'settings.sessions.maxSize': 'Max session size (MB)',
  'settings.sessions.maxSizeAria': 'max session size',
  'settings.sessions.agentBehaviour': 'Agent Behaviour',
  'settings.sessions.toolBudget': 'Tool use budget',
  'settings.sessions.toolBudgetAria': 'tool use budget',
  'settings.sessions.toolBudgetHint': 'max completed tool executions per turn',
  'settings.sessions.isolation': 'Session isolation',
  'settings.sessions.isolationNone': 'None — full cross-session visibility',
  'settings.sessions.isolationSummary': 'Summary — tools visible, no arguments',
  'settings.sessions.isolationFull': 'Full — sessions cannot see each other',
  'settings.editor.heading': 'Editor',
  'settings.editor.vimMode': 'Vim mode',
  'settings.editor.showWhitespace': 'Show whitespace',
  'settings.editor.livePreview': 'Markdown live preview',
  'settings.editor.fontSize': 'Font size (px)',
  'settings.editor.fontSizeAria': 'editor font size',
  'settings.editor.fontFamily': 'Font family',
  'settings.editor.fontFamilyPlaceholder': 'monospace (default)',
  'settings.editor.localOnlyHint': 'This browser only. Editor changes are stored in local browser storage and take effect when you next open or reload a file tab.',
  'settings.appearance.syncing': 'Syncing appearance…',
  'settings.appearance.default': 'Default',
  'settings.appearance.autoLightDark': 'auto (light/dark)',
  'settings.appearance.tint': 'Tint:',
  'settings.appearance.clearTint': 'Clear tint',
  'settings.appearance.none': 'none',
  'settings.appearance.outputPadding': 'Output padding',
  'settings.appearance.outputPaddingHint': 'Extra space around messages and thinking panels.',
  'settings.keyboard.heading': 'Keyboard',
  'settings.keyboard.hint1': 'Customize app-wide shortcuts as comma-separated bindings. Changes apply immediately.',
  'settings.keyboard.hint1b': 'is reserved for dismiss/abort and cannot be rebound.',
  'settings.keyboard.hint2mid': 'and typing',
  'settings.keyboard.hint2end': 'outside the compose box open this pane.',
  'settings.keyboard.resetAll': 'Reset all to defaults',
  'settings.keyboard.defaultColon': 'Default:',
  'settings.keyboard.save': 'Save',
  'settings.keyboard.defaultBtn': 'Default',
  'settings.keyboard.noMatch': 'No shortcuts match this filter.',
  'settings.keyboard.invalidShortcut': 'Invalid shortcut: {token}. Escape is reserved and cannot be rebound.',
  'settings.keyboard.saved': 'Keyboard shortcuts saved.',
  'settings.keyboard.resetOne': 'Keyboard shortcut reset to default.',
  'settings.keyboard.resetAllDone': 'Keyboard shortcuts reset to defaults.',
  'settings.workspace.serverApplied': 'Workspace settings applied. Server-side limits affect new workspace requests immediately.',
  'settings.workspace.browserApplied': 'Browser workspace settings applied immediately in this tab.',
  'settings.workspace.access': 'Access',
  'settings.workspace.enableTerminal': 'Enable web terminal',
  'settings.workspace.allowVnc': 'Allow direct VNC targets',
  'settings.workspace.accessHint': 'Terminal access updates immediately. Direct VNC target policy applies to new VNC requests.',
  'settings.workspace.guardrails': 'Server scan guardrails',
  'settings.workspace.maxDepth': 'Max tree depth',
  'settings.workspace.maxDepthAria': 'workspace tree max depth',
  'settings.workspace.maxDepthHintPre': 'caps all',
  'settings.workspace.maxDepthHintPost': 'requests',
  'settings.workspace.maxEntries': 'Max entries per scan',
  'settings.workspace.maxEntriesAria': 'workspace tree max entries',
  'settings.workspace.maxEntriesHint': 'truncate oversized tree walks earlier',
  'settings.workspace.thisBrowser': 'This browser',
  'settings.workspace.refreshInterval': 'Refresh interval (seconds)',
  'settings.workspace.refreshIntervalAria': 'workspace refresh interval',
  'settings.workspace.folderDepth': 'Folder preview scan depth',
  'settings.workspace.folderDepthAria': 'folder preview scan depth',
  'settings.workspace.folderDepthHintPre': 'set to',
  'settings.workspace.folderDepthHintPost': 'to disable folder size preview scans',
  'settings.workspace.footerHint': 'Root and folder-expansion tree loads remain shallow; the folder size preview is the deepest workspace scan in the UI.',
  'settings.models.thinkingLevel': 'Thinking level',
  'settings.models.noThinking': 'Current model does not support thinking.',
  'settings.models.thinkingLevelLabel': 'Thinking level:',
  'settings.models.loading': 'Loading models…',
  'settings.models.summary': 'Model and provider names may wrap in narrow panes to avoid clipping.',
  'settings.models.scopedOnly': 'Scoped models only',
  'settings.models.scopedCheckboxPre': 'Use Pi',
  'settings.models.scopedCheckboxPost': 'for Piclaw model lists',
  'settings.models.scopedHintPre': 'Filters this picker and the',
  'settings.models.scopedHintPost': 'tool. TUI model selection remains unchanged.',
  'settings.models.colModel': 'Model',
  'settings.models.colProvider': 'Provider',
  'settings.models.colContext': 'Context',
  'settings.models.colReasoning': 'Reasoning',
  'settings.models.noMatch': 'No models match "{filter}"',
  'settings.tools.unavailable': 'Tool data not available.',
  'settings.tools.search': 'Search',
  'settings.tools.matchMode': 'Match mode',
  'settings.tools.orMode': 'Any keyword (OR) — results match at least one search term',
  'settings.tools.andMode': 'All keywords (AND) — results must match every search term',
  'settings.tools.colEnabled': 'Enabled',
  'settings.tools.colTool': 'Tool',
  'settings.tools.colCompact': 'Result compaction',
  'settings.tools.colKind': 'Kind',
  'settings.tools.colSummary': 'Summary',
  'settings.tools.colSource': 'Source',
  'settings.tools.disableCompaction': 'Disable tool-result compaction for this tool',
  'settings.tools.enableCompaction': 'Enable tool-result compaction for this tool',
  'settings.tools.noMatch': 'No tools match "{filter}"',
  'settings.tools.footer': 'Tool activation is managed by the agent runtime. Group checkboxes collapse/expand; the “Compact” column controls tool-result compaction eligibility.',
  'settings.environment.heading': 'Environment',
  'settings.environment.introPre': 'Showing non-keychain environment variables only. Overrides are stored in extension KV and applied to',
  'settings.environment.introPost': ', so subsequent tool calls inherit them.',
  'settings.environment.refresh': 'Refresh',
  'settings.environment.addOverride': 'Add override',
  'settings.environment.valuePlaceholder': 'value',
  'settings.environment.save': 'Save',
  'settings.environment.countLine': '{count} variables visible • {overrides} overrides active • {keychain} keychain-injected variables hidden',
  'settings.environment.overridden': 'Overridden in KV',
  'settings.environment.inherited': 'Inherited from process environment',
  'settings.environment.kindOverride': 'override',
  'settings.environment.kindProcess': 'process',
  'settings.environment.clear': 'Clear',
  'settings.environment.noMatch': 'No environment variables match "{filter}".',
  'settings.environment.refreshedToast': 'Environment refreshed.',
  'settings.environment.savedToast': 'Saved environment override for {name}.',
  'settings.environment.clearedToast': 'Cleared environment override for {name}.',
  'settings.quickActions.loading': 'Loading…',
  'settings.quickActions.heading': 'Timeline Quick Actions',
  'settings.quickActions.intro': 'Choose which actions appear in the timeline typeahead. Agents are always pinned first, then workspace commands, then slash commands.',
  'settings.quickActions.enableAll': 'Enable all',
  'settings.quickActions.saving': 'Saving…',
  'settings.quickActions.saveApply': 'Save & apply',
  'settings.quickActions.workspaceCommands': 'Workspace commands',
  'settings.quickActions.noWorkspaceMatch': 'No workspace commands match this filter.',
  'settings.quickActions.slashCommands': 'Slash commands',
  'settings.quickActions.slashFallback': 'slash command',
  'settings.quickActions.noSlashMatch': 'No slash commands match this filter.',
  'settings.quickActions.savingToast': 'Saving quick actions…',
  'settings.quickActions.savedToast': 'Quick Actions saved.',
  'settings.providers.authApiKey': 'API key',
  'settings.providers.authConfigured': 'Configured',
  'settings.providers.heading': 'Providers',
  'settings.providers.tagCustom': 'Custom',
  'settings.providers.logout': 'Logout',
  'settings.providers.reconfigure': 'Reconfigure',
  'settings.providers.setUp': 'Set up',
  'settings.providers.setupHint': 'Sign-in flows open in the browser. In narrow panes the setup form stacks vertically to avoid clipping.',
  'settings.providers.starting': 'Starting…',
  'settings.providers.signInOAuth': 'Sign in with OAuth',
  'settings.providers.apiKeyLabel': 'API Key',
  'settings.providers.apiKeyPlaceholder': 'Enter API key',
  'settings.providers.save': 'Save',
  'settings.providers.configuring': 'Configuring…',
  'settings.providers.saveConfig': 'Save configuration',
  'settings.providers.apiKeyEmpty': 'API key cannot be empty.',
  'settings.providers.configuringToast': 'Configuring {provider}…',
  'settings.providers.configured': '{provider} configured.',
  'settings.providers.startingOAuth': 'Starting OAuth for {provider}…',
  'settings.providers.oauthOpened': 'OAuth window opened. Complete the sign-in flow, then close this message.',
  'settings.providers.oauthStarted': 'OAuth flow started for {provider}. Check the chat.',
  'settings.providers.loggingOut': 'Logging out {provider}…',
  'settings.providers.loggedOut': 'Logged out {provider}. Restart may be needed.',
  'settings.general.identity': 'Identity',
  'settings.general.userLabel': 'User',
  'settings.general.yourName': 'Your name',
  'settings.general.agentLabel': 'Agent',
  'settings.general.agentName': 'Agent name',
  'settings.general.notifications': 'Notifications',
  'settings.general.browserNotifications': 'Browser notifications',
  'settings.general.notifSecureHint': 'Use the 🔔 bell button in the compose bar to enable/disable notifications. Web Push requires HTTPS or localhost.',
  'settings.general.notifInsecureHint': '⚠ Not available — requires a secure context (HTTPS or localhost). Access via SSH tunnel or reverse proxy with TLS to enable.',
  'settings.general.display': 'Display',
  'settings.general.systemMeters': 'System meters',
  'settings.general.systemMetersHint': 'CPU/memory/network meters in the status bar. This browser only.',
  'settings.general.instanceConfig': 'Instance Configuration',
  'settings.general.composeUpload': 'Compose upload (MB)',
  'settings.general.composeUploadAria': 'compose upload limit',
  'settings.general.composeUploadHint': 'chat/media attachments',
  'settings.general.workspaceUpload': 'Workspace upload (MB)',
  'settings.general.workspaceUploadAria': 'workspace upload limit',
  'settings.general.workspaceUploadHint': 'defaults to 256 MB; chunked uploads allow up to 1 GB',
  'settings.general.agentRecovery': 'Advanced · Agent recovery',
  'settings.general.automaticRecovery': 'Automatic recovery',
  'settings.general.automaticRecoveryHint': 'Retry recoverable failed turns automatically.',
  'settings.general.recoveryMaxAttempts': 'Maximum attempts',
  'settings.general.recoveryMaxAttemptsAria': 'automatic recovery maximum attempts',
  'settings.general.recoveryMaxAttemptsHint': '0 inherits the normal retry limit.',
  'settings.general.recoveryTotalBudget': 'Total budget (ms)',
  'settings.general.recoveryTotalBudgetAria': 'automatic recovery total budget in milliseconds',
  'settings.general.recoveryTotalBudgetHint': 'Caps all automatic recovery work for one turn.',
  'settings.general.authentication': 'Authentication',
  'settings.general.widgetToken': 'Widget bearer token',
  'settings.general.token': 'Token',
  'settings.general.hideToken': 'Hide token',
  'settings.general.revealToken': 'Reveal token',
  'settings.general.copyToken': 'Copy token',
  'settings.general.copied': 'Copied',
  'settings.general.regenerating': 'Regenerating…',
  'settings.general.regenerate': 'Regenerate',
  'settings.general.tokenHintPre': 'Read-only token for',
  'settings.general.tokenHintMid': 'and',
  'settings.general.tokenHintPost': '. Use as',
  'settings.general.tokenHintEnd': '.',
  'settings.general.copyFailed': 'Could not copy widget token. Select the token field and copy manually.',
  'settings.general.regenConfirm': 'Regenerate the widget token? Existing macOS widgets using the old token will stop updating.',
  'settings.general.totpTitle': 'TOTP setup QR',
  'settings.general.totpConfiguredHint': 'Current web-login authenticator secret. Scan this QR to add another authenticator device.',
  'settings.general.totpUnconfiguredHint': 'TOTP is not configured for this instance yet, so no setup QR is available.',
  'settings.general.issuer': 'Issuer',
  'settings.general.label': 'Label',
  'settings.general.secret': 'Secret',
  'settings.general.avatarUpload': 'Click to upload',
  'settings.developer.heading': 'Developer',
  'settings.developer.devMode': 'Developer mode',
  'settings.developer.localHint': 'This browser only. Developer-mode toggles and add-on catalog overrides are stored in local browser storage.',
  'settings.developer.addonSources': 'Add-on Sources',
  'settings.developer.catalogUrl': 'Catalog URL',
  'settings.developer.catalogHint': 'Primary add-on catalog URL. Leave empty to use the default',
  'settings.developer.additionalCatalogs': 'Additional catalog URLs',
  'settings.developer.additionalHint': 'Fetched in addition to the primary/default catalog. One URL per line.',
  'settings.developer.repoUrl': 'Repo URL',
  'settings.developer.repoHintPre': 'Override the git repo used for',
  'settings.developer.repoHintPost': 'installs. Leave empty for default.',
  'settings.developer.debug': 'Debug',
  'settings.developer.logSse': 'Log SSE events',
  'settings.developer.logToolCalls': 'Log tool calls',
  'settings.developer.debugHint': 'Debug flags take effect on next page reload.',
  'settings.addons.installing': 'Installing {slug}…',
  'settings.addons.removing': 'Removing {slug}…',
  'settings.addons.installedToast': 'Add-on installed.',
  'settings.addons.removedToast': 'Add-on removed.',
  'settings.addons.restarting': 'Restarting piclaw…',
  'settings.addons.restartComplete': 'Restart complete — add-ons refreshed.',
  'settings.addons.restartTimeout': 'Backend did not return in time. Reload the page manually.',
  'settings.addons.fetching': 'Fetching add-ons…',
  'settings.addons.loadFailed': 'Could not load add-ons.',
  'settings.addons.catalogFromPre': 'Catalog from',
  'settings.addons.catalogMerged': '{count} catalog sources merged.',
  'settings.addons.installNote': 'Package-first install via Bun; restart required after install/uninstall.',
  'settings.addons.failedFetchSingular': 'Failed to fetch {count} catalog source:',
  'settings.addons.failedFetchPlural': 'Failed to fetch {count} catalog sources:',
  'settings.addons.activeSources': 'Active catalog sources ({count})',
  'settings.addons.windowsWarning': 'Native Windows add-on installs are higher risk: Bun package installs, symlink cleanup, locked files, and restart timing can all be less predictable than in Linux/WSL. Prefer WSL or a container when possible.',
  'settings.addons.typeExtSkill': 'extension + skill',
  'settings.addons.typeSkill': 'skill',
  'settings.addons.typeExt': 'extension',
  'settings.addons.update': 'Update',
  'settings.addons.remove': 'Remove',
  'settings.addons.install': 'Install',
  'settings.addons.noMatch': 'No add-ons match "{filter}"',
  'settings.addons.restartNotice': 'Extension changes are installed but inactive until piclaw restarts.',
  'settings.addons.restartNow': 'Restart Now',
  'settings.recordings.modeFull': 'full / trusted',
  'settings.recordings.modeMetadata': 'metadata only',
  'settings.recordings.modeRedacted': 'redacted',
  'settings.recordings.selectPrompt': 'Select a recording to inspect, replay, export, or delete it.',
  'settings.recordings.playback': 'Playback',
  'settings.recordings.refresh': 'Refresh',
  'settings.recordings.delete': 'Delete',
  'settings.recordings.status': 'Status',
  'settings.recordings.mode': 'Mode',
  'settings.recordings.chat': 'Chat',
  'settings.recordings.started': 'Started',
  'settings.recordings.ended': 'Ended',
  'settings.recordings.events': 'Events',
  'settings.recordings.redactions': 'Redactions',
  'settings.recordings.exportJson': 'Export JSON',
  'settings.recordings.exportJsonl': 'Export JSONL',
  'settings.recordings.exportHtml': 'Export standalone HTML',
  'settings.recordings.eventSummary': 'Event summary',
  'settings.recordings.inspectHint': 'Open or refresh details to inspect trace events.',
  'settings.recordings.firstEvents': 'First events',
  'settings.recordings.heading': 'Session Recording',
  'settings.recordings.intro': 'Opt-in trace capture for deterministic playback and screen-recording exports. Playback never calls live agent or tool endpoints.',
  'settings.recordings.chatJid': 'Chat JID',
  'settings.recordings.title': 'Title',
  'settings.recordings.titlePlaceholder': 'Demo recording',
  'settings.recordings.modeLabelField': 'Mode',
  'settings.recordings.optRedacted': 'Redacted',
  'settings.recordings.optMetadata': 'Metadata only',
  'settings.recordings.optFull': 'Full / trusted local',
  'settings.recordings.includeSnapshot': 'Include timeline snapshot',
  'settings.recordings.extraKeys': 'Extra redacted keys',
  'settings.recordings.extraPatterns': 'Extra regex patterns',
  'settings.recordings.stopCurrent': 'Stop current chat recording',
  'settings.recordings.start': 'Start recording',
  'settings.recordings.redactionPreview': 'Redaction preview',
  'settings.recordings.previewRedaction': 'Preview redaction',
  'settings.recordings.loading': 'Loading recordings…',
  'settings.recordings.noneYet': 'No recordings yet.',
  'settings.recordings.noneYetHint': 'Start a recording above, then use playback/export for deterministic screen capture.',
  'settings.recordings.listLabel': 'Session recordings',
  'settings.recordings.eventsCount': '{count} events',
  'settings.recordings.noMatch': 'No recordings match “{filter}”.',
  'settings.recordings.startedToast': 'Recording started for {chat}.',
  'settings.recordings.startFailed': 'Failed to start recording.',
  'settings.recordings.stoppedToast': 'Recording stopped for {chat}.',
  'settings.recordings.stopFailed': 'Failed to stop recording.',
  'settings.recordings.deleteConfirm': 'Delete recording {id}?',
  'settings.recordings.deletedToast': 'Recording deleted.',
  'settings.recordings.deleteFailed': 'Failed to delete recording.',
  'settings.recordings.loadOneFailed': 'Failed to load recording.',
  'settings.recordings.loadFailed': 'Failed to load recordings.',
  'settings.recordings.previewFailed': 'Preview failed.',
  'settings.keychain.loadFailed': 'Failed to load keychain.',
  'settings.keychain.addFailed': 'Failed to add entry.',
  'settings.keychain.deleteFailed': 'Failed to delete entry.',
  'settings.keychain.saveNotesFailed': 'Failed to save notes.',
  'settings.keychain.revealFailed': 'Failed to reveal.',
  'settings.keychain.loading': 'Loading keychain…',
  'settings.keychain.entryCountSingular': '{count} entry',
  'settings.keychain.entryCountPlural': '{count} entries',
  'settings.keychain.matchingFilter': ' matching "{filter}"',
  'settings.keychain.encryptedSuffix': ', encrypted at rest.',
  'settings.keychain.clickPrefix': 'Click',
  'settings.keychain.revealSuffix': 'to reveal.',
  'settings.keychain.cancel': 'Cancel',
  'settings.keychain.addEntry': '+ Add entry',
  'settings.keychain.namePlaceholder': 'Entry name (e.g. github/my-token)',
  'settings.keychain.secretPlaceholder': 'Secret value',
  'settings.keychain.usernamePlaceholder': 'Username (optional)',
  'settings.keychain.saving': 'Saving…',
  'settings.keychain.save': 'Save',
  'settings.keychain.userNotePlaceholder': 'User note (visible in this UI only)',
  'settings.keychain.agentNotePlaceholder': 'Agent note (safe to expose to agents)',
  'settings.keychain.noMatchFilter': 'No entries match the filter.',
  'settings.keychain.noEntries': 'No keychain entries.',
  'settings.keychain.hideSecret': 'Hide secret',
  'settings.keychain.revealSecret': 'Reveal secret',
  'settings.keychain.deleteQ': 'Delete?',
  'settings.keychain.yes': 'Yes',
  'settings.keychain.no': 'No',
  'settings.keychain.deleteTitle': 'Delete',
  'settings.keychain.userNote': 'User note',
  'settings.keychain.agentNote': 'Agent-readable note',
  'settings.keychain.userNoteHint': 'Human/UI note only',
  'settings.keychain.agentNoteHint': 'Safe guidance for agents',
  'settings.keychain.saveNotes': 'Save notes',
  'settings.keychain.masterPassword': 'Master password:',
  'settings.keychain.masterPasswordPlaceholder': 'Enter keychain master password',
  'settings.keychain.unlock': 'Unlock',
  'settings.keychain.totpCode': 'TOTP code:',
  'settings.keychain.verify': 'Verify',
  'settings.keychain.username': 'Username',
  'settings.keychain.copyUsername': 'Copy username',
  'settings.keychain.secret': 'Secret',
  'settings.keychain.copySecret': 'Copy secret',
  'settings.tasks.internalProtected': 'internal/protected',
  'settings.tasks.noRunLogs': 'No run logs recorded yet.',
  'settings.tasks.noSummary': 'No summary',
  'settings.tasks.selectPrompt': 'Select a task to inspect schedule, status, and run history.',
  'settings.tasks.pause': 'Pause',
  'settings.tasks.resume': 'Resume',
  'settings.tasks.delete': 'Delete',
  'settings.tasks.status': 'Status',
  'settings.tasks.kind': 'Kind',
  'settings.tasks.schedule': 'Schedule',
  'settings.tasks.nextRun': 'Next run',
  'settings.tasks.lastRun': 'Last run',
  'settings.tasks.lastResult': 'Last result',
  'settings.tasks.chat': 'Chat',
  'settings.tasks.model': 'Model',
  'settings.tasks.cwd': 'CWD',
  'settings.tasks.timeout': 'Timeout',
  'settings.tasks.protection': 'Protection',
  'settings.tasks.protectionHint': 'Internal task actions require explicit confirmation.',
  'settings.tasks.command': 'Command',
  'settings.tasks.prompt': 'Prompt',
  'settings.tasks.recentRuns': 'Recent runs',
  'settings.tasks.activeLabel': 'Active',
  'settings.tasks.pausedLabel': 'Paused',
  'settings.tasks.completedLabel': 'Completed',
  'settings.tasks.allStatuses': 'All statuses',
  'settings.tasks.filterChatPlaceholder': 'Filter chat JID…',
  'settings.tasks.refresh': 'Refresh',
  'settings.tasks.loading': 'Loading scheduled tasks…',
  'settings.tasks.noneFound': 'No scheduled tasks found.',
  'settings.tasks.noneFoundHint': 'Tasks created with reminders, `/tasks`, or the scheduler tool will appear here.',
  'settings.tasks.listLabel': 'Scheduled tasks',
  'settings.tasks.next': 'Next',
  'settings.tasks.last': 'Last',
  'settings.tasks.noMatch': 'No tasks match “{filter}”.',
  'settings.tasks.confirmDelete': 'Delete scheduled task {id}?',
  'settings.tasks.confirmPause': 'Pause scheduled task {id}?',
  'settings.tasks.confirmResume': 'Resume scheduled task {id}?',
  'settings.tasks.confirmProtected': 'Task {id} is internal/protected. Continue with {action}?',
  'settings.tasks.deleting': 'Deleting {id}…',
  'settings.tasks.pausing': 'Pausing {id}…',
  'settings.tasks.resuming': 'Resuming {id}…',
  'settings.tasks.deletedToast': 'Scheduled task {id} deleted.',
  'settings.tasks.pausedToast': 'Scheduled task {id} paused.',
  'settings.tasks.resumedToast': 'Scheduled task {id} resumed.',
  'settings.tasks.actionFailed': 'Failed to {action} task.',
  'settings.tasks.loadFailed': 'Failed to load scheduled tasks.',
  'settings.compaction.appliedNotice': 'Compaction settings applied. Existing turns keep their current timers; new turns use the updated values.',
  'settings.compaction.saving': 'Saving compaction settings…',
  'settings.compaction.saveFailed': 'Failed to save compaction settings.',
  'settings.compaction.saved': 'Compaction settings saved.',
  'settings.compaction.clearing': 'Clearing compaction suppression for {chat}…',
  'settings.compaction.clearFailed': 'Failed to clear compaction suppression.',
  'settings.compaction.cleared': 'Cleared compaction suppression for {chat}.',
  'settings.compaction.autoHeading': 'Automatic compaction',
  'settings.compaction.enableAutomatic': 'Enable automatic compaction',
  'settings.compaction.enableAutomaticHint': 'Piclaw-managed pre-prompt/idle compaction. The upstream agent auto-compactor stays suppressed internally.',
  'settings.compaction.processingMethod': 'Processing method',
  'settings.compaction.model': 'Compaction model',
  'settings.compaction.modelHint': 'Strict local smart-compaction model. If configured but unavailable, compaction stops and preserves the session instead of falling back.',
  'settings.compaction.modelPlaceholder': 'provider/model (empty uses active model)',
  'settings.compaction.methodSelective': 'Selective',
  'settings.compaction.methodSelectiveHint': 'Extract high-value continuity excerpts, using complete progressive coverage whenever a bounded prompt cannot represent every discarded source event.',
  'settings.compaction.methodPipelined': 'Pipelined',
  'settings.compaction.methodPipelinedHint': 'Canonicalize and classify every discarded source event with an auditable coverage ledger before summarizing.',
  'settings.compaction.remoteNative': 'Provider-native compaction',
  'settings.compaction.remoteNativeHint': 'Opt-in for explicitly supported providers only ({providers}). Any failure falls back atomically to the selected local method.',
  'settings.compaction.remoteTimeout': 'Provider-native timeout (sec)',
  'settings.compaction.remoteTimeoutAria': 'provider-native compaction timeout',
  'settings.compaction.remoteTimeoutHint': 'Deadline for the remote pre-pass before local fallback.',
  'settings.compaction.enableToolResult': 'Enable tool-result compaction',
  'settings.compaction.enableToolResultHint': 'When disabled, large tool results stay inline and are not externalized into searchable tool-output handles.',
  'settings.compaction.semanticSummaries': 'Semantic summaries for compacted tool results',
  'settings.compaction.semanticSummariesHint': 'When enabled, compacted outputs include a semantic summary generated with the active model (preview fallback on failure).',
  'settings.compaction.inputLimit': 'Semantic summary input limit (chars)',
  'settings.compaction.inputLimitAria': 'semantic summary input limit',
  'settings.compaction.inputLimitHint': 'Maximum characters sampled from full tool output for semantic summarization.',
  'settings.compaction.maxTokens': 'Semantic summary output max tokens',
  'settings.compaction.maxTokensAria': 'semantic summary max tokens',
  'settings.compaction.maxTokensHint': 'Upper bound for generated summary length.',
  'settings.compaction.summaryTimeout': 'Semantic summary timeout (sec)',
  'settings.compaction.summaryTimeoutAria': 'semantic summary timeout',
  'settings.compaction.summaryTimeoutHint': 'Abort semantic summary generation after this timeout and fall back to preview compaction.',
  'settings.compaction.threshold': 'Compaction threshold (%)',
  'settings.compaction.thresholdAria': 'compaction threshold',
  'settings.compaction.thresholdHint': 'auto-compact when context exceeds this % of window',
  'settings.compaction.timeout': 'Compaction timeout (sec)',
  'settings.compaction.timeoutAria': 'compaction timeout',
  'settings.compaction.timeoutHint': 'Single wall-clock deadline for deterministic preparation, provider prefill/streaming, and settlement. Local provider requests inherit the remaining time.',
  'settings.compaction.backoffBase': 'Failure backoff base (min)',
  'settings.compaction.backoffBaseAria': 'compaction backoff base',
  'settings.compaction.backoffBaseHint': 'First suppression window after a compaction failure.',
  'settings.compaction.backoffMax': 'Failure backoff max (min)',
  'settings.compaction.backoffMaxAria': 'compaction backoff max',
  'settings.compaction.backoffMaxHint': 'Upper bound for exponential suppression after repeated failures.',
  'settings.compaction.decayFactor': 'Backoff decay factor',
  'settings.compaction.decayFactorAria': 'backoff decay factor',
  'settings.compaction.decayFactorHint': '% — halves backoff after each successful compaction',
  'settings.compaction.watchdogHeading': 'Stall watchdog',
  'settings.compaction.enableWatchdog': 'Enable watchdog',
  'settings.compaction.enableWatchdogHint': 'Disabled by default. When enabled, a helper process terminates the runtime if an active phase stops heartbeating.',
  'settings.compaction.watchdogTimeout': 'Watchdog timeout (sec)',
  'settings.compaction.watchdogTimeoutAria': 'watchdog timeout',
  'settings.compaction.watchdogTimeoutHint': 'How long an active phase can go without a heartbeat before the watchdog kills the runtime.',
  'settings.compaction.suppressionsHeading': 'Active compaction suppressions',
  'settings.compaction.noBackoff': 'No chats are currently under compaction backoff.',
  'settings.compaction.clear': 'Clear',
  'settings.compaction.phasesHeading': 'Live watchdog phases',
  'settings.compaction.noPhases': 'No active tracked phases right now.',
  'menu.title': 'Menu',
  'menu.showWorkspace': 'Show workspace',
  'menu.hideWorkspace': 'Hide workspace',
  'menu.openExplorer': 'Open explorer',
  'menu.chatOnly': 'Chat-only mode',
  'menu.exitChatOnly': 'Exit chat-only mode',
  'menu.openTerminal': 'Open terminal in tab',
  'menu.openVnc': 'Open VNC in tab',
  'menu.newFile': 'New file',
  'menu.openRecent': 'Open Recent',
  'menu.refreshTree': 'Refresh tree',
  'menu.reindex': 'Reindex workspace',
  'menu.showHidden': 'Show hidden files',
  'menu.hideHidden': 'Hide hidden files',
  'menu.scale': 'Scale',
  'menu.settings': 'Settings',
};

const ZH_CN: Partial<Record<MessageKey, string>> = {
  'compose.placeholder': '输入消息（回车发送，Shift+回车换行）...',
  'compose.send': '发送',
  'compose.stop': '停止',
  'compose.searchPlaceholder': '搜索（回车运行）...',
  'compose.clearAll': '清除全部',
  'compose.clearAllTitle': '清除所有附件和引用',
  'compose.scope': '范围',
  'compose.searchScope': '搜索范围',
  'compose.scopeCurrent': '当前',
  'compose.scopeBranchFamily': '分支系列',
  'compose.scopeAll': '所有聊天',
  'compose.filterImages': '图片',
  'compose.filterAttachments': '附件',
  'compose.search': '搜索',
  'compose.closeSearch': '关闭搜索',
  'compose.shareLocation': '分享位置',
  'compose.attachFile': '附加文件',
  'compose.queueControls': '排队后续消息控制',
  'compose.moveUp': '上移',
  'compose.moveUpQueue': '在队列中上移',
  'compose.moveDown': '下移',
  'compose.moveDownQueue': '在队列中下移',
  'compose.editInCompose': '在输入框中编辑',
  'compose.returnToEditor': '将排队消息返回编辑器',
  'compose.injectSteer': '作为引导插入排队的后续消息',
  'compose.steer': '引导',
  'compose.cancelQueued': '取消排队消息',
  'compose.resizeInput': '调整消息输入框大小',
  'compose.resizeInputHint': '拖动以调整消息输入框大小',
  'compose.modelPicker': '模型选择器',
  'compose.sessionsAndAgents': '会话与代理',
  'compose.openModelPicker': '打开模型选择器',
  'compose.newBranchTitle': '从此聊天创建新分支',
  'compose.newRootTitle': '创建一个干净的根会话，例如 web:ops',
  'compose.renameSessionTitle': '重命名当前会话',
  'compose.pruneSessionTitle': '删除（修剪）当前代理/会话分支',
  'compose.filterImagesTitle': '仅显示含图片的消息',
  'compose.filterAttachmentsTitle': '仅显示含附件的消息',
  'compose.selectModel': '选择模型',
  'compose.loadingModels': '正在加载模型…',
  'compose.noModels': '没有可用的模型。',
  'compose.nextModel': '下一个模型',
  'compose.manageSessions': '管理会话与代理',
  'compose.noSessions': '暂无其他会话。',
  'compose.newBranch': '新建分支',
  'compose.newRoot': '新建根会话…',
  'compose.mergeCurrent': '将当前合并到父级',
  'compose.renameCurrent': '重命名当前…',
  'compose.deleteCurrent': '删除当前…',
  'compose.mergeInto': '将此分支合并到 {target}',
  'compose.mergeBlocked': '当此分支处于活动状态或有子分支时无法合并',
  'workspace.title': '工作区',
  'workspace.moveConfirm': '将{entry}“{name}”从{source}移动到{target}？',
  'workspace.root': '工作区根目录',
  'workspace.file': '文件',
  'workspace.folder': '文件夹',
  'workspace.newFile': '新建文件',
  'workspace.refresh': '刷新',
  'workspace.actions': '工作区操作',
  'workspace.uploadFiles': '上传文件',
  'workspace.reindexing': '正在重建索引…',
  'workspace.deleteFile': '删除文件',
  'workspace.download': '下载',
  'workspace.uploadToFolder': '上传文件到此文件夹',
  'workspace.addFolderHint': '将文件夹提示添加到输入框',
  'workspace.downloadZip': '将文件夹下载为 zip',
  'workspace.openInTab': '在标签页打开',
  'workspace.openInEditor': '在编辑器打开',
  'workspace.renameSelected': '重命名所选',
  'workspace.downloadSelectedFile': '下载所选文件',
  'workspace.downloadSelectedFolder': '下载所选文件夹（zip）',
  'workspace.deleteSelectedFile': '删除所选文件',
  'shell.settings': '设置',
  'shell.newChat': '新建对话',
  'shell.connecting': '连接中…',
  'shell.connected': '已连接',
  'language.label': '语言',
  'settings.title': '设置',
  'settings.close': '关闭（Esc）',
  'settings.filter': '筛选…',
  'settings.loading': '加载设置中…',
  'settings.section.general': '常规',
  'settings.section.sessions': '会话',
  'settings.section.recordings': '录制',
  'settings.section.compaction': '压缩',
  'settings.section.keyboard': '键盘',
  'settings.section.workspace': '工作区',
  'settings.section.environment': '环境',
  'settings.section.providers': '提供商',
  'settings.section.models': '模型',
  'settings.section.theme': '外观',
  'settings.section.scheduled-tasks': '计划任务',
  'settings.section.quick-actions': '快捷操作',
  'settings.section.keychain': '密钥串',
  'settings.section.tools': '工具',
  'settings.section.addons': '插件',
  'settings.placeholder.recordings': '筛选录制…',
  'settings.placeholder.keyboard': '筛选快捷键…',
  'settings.placeholder.environment': '筛选环境…',
  'settings.placeholder.models': '筛选模型…',
  'settings.placeholder.scheduled-tasks': '筛选计划任务…',
  'settings.placeholder.quick-actions': '筛选快捷操作…',
  'settings.placeholder.keychain': '筛选条目…',
  'settings.placeholder.tools': '筛选工具…',
  'settings.placeholder.addons': '筛选插件…',
  'preview.close': '关闭',
  'preview.loading': '正在加载预览…',
  'preview.files': '文件',
  'preview.folders': '文件夹',
  'preview.compressed': '压缩后',
  'preview.uncompressed': '未压缩',
  'preview.name': '名称',
  'preview.type': '类型',
  'preview.method': '方法',
  'preview.size': '大小',
  'post.deleteMessage': '删除消息',
  'post.tooLarge': '消息过大，无法显示。',
  'post.previewTruncated': '预览已截断。',
  'post.submitted': '已提交',
  'post.discard': '丢弃',
  'post.save': '保存',
  'post.cancel': '取消',
  'post.addNote': '添加备注',
  'post.addNotePlaceholder': '添加备注…',
  'post.restartNotice': '正在重启 — 原因：{reason}',
  'post.restartCompleted': '重启完成。',
  'post.agentSelfResume': '代理自行恢复',
  'tab.close': '关闭',
  'tab.closeOthers': '关闭其他',
  'tab.closeAll': '全部关闭',
  'tab.reattach': '重新附加',
  'tab.openInWindow': '在窗口中打开',
  'tab.openInNewTab': '在新标签页打开',
  'tab.pinned': '已固定',
  'tab.detached': '已分离',
  'tab.openSeparateWindow': '在独立窗口中打开',
  'status.trackedVariables': '跟踪的变量',
  'status.attachToSession': '附加到会话',
  'status.files': '文件',
  'status.proposedDiff': '建议的差异',
  'status.copyTmux': '复制 tmux 命令',
  'status.experimentDuration': '实验时长',
  'status.sinceLastActivity': '自上次活动以来',
  'annotator.title': '标注图片',
  'annotator.typeLabel': '输入标签…',
  'annotator.undo': '撤销',
  'annotator.resetZoom': '重置缩放',
  'tree.filter': '筛选…',
  'tree.sessionTree': '会话树',
  'btw.label': 'BTW 附加对话',
  'btw.close': '关闭 BTW',
  'btw.thinking': '思考中',
  'mdpreview.close': '关闭预览',
  'mdpreview.unavailable': '预览不可用',
  'widget.close': '关闭小部件',
  'oobe.gettingStarted': '入门指南',
  'oobe.needsSetupTitle': '实例需要设置',
  'oobe.configuredTitle': '实例已配置',
  'oobe.needsSetupBody': '此实例尚未配置。请打开“设置”并设置 AI 提供商/模型以开始发送请求。',
  'oobe.configuredBody': '此实例看起来已配置。请在“设置”中查看或更新提供商和模型设置。',
  'oobe.openSettings': '打开设置',
  'oobe.dismiss': '忽略',
  'oobe.done': '完成',
  'palette.placeholder': '输入以跳转到代理、工作区操作或斜杠命令…',
  'palette.hideWorkspace': '隐藏工作区',
  'palette.showWorkspace': '显示工作区',
  'palette.hideWorkspaceDesc': '隐藏工作区侧边栏。',
  'palette.showWorkspaceDesc': '显示工作区侧边栏。',
  'palette.exitChatOnly': '退出仅聊天模式',
  'palette.chatOnly': '仅聊天模式',
  'palette.exitChatOnlyDesc': '返回分屏工作区布局。',
  'palette.chatOnlyDesc': '切换到仅聊天布局。',
  'palette.groupAgents': '代理',
  'palette.groupWorkspace': '工作区',
  'palette.groupSlash': '斜杠命令',
  'palette.hintMove': '移动',
  'palette.hintSelect': '选择',
  'palette.hintPopOut': '弹出',
  'palette.hintClose': '关闭',
  'settings.appliedNotice': '设置已应用。更改将在下一回合生效。',
  'settings.sessions.lifecycle': '会话生命周期',
  'settings.sessions.autoRotate': '自动轮换会话',
  'settings.sessions.maxSize': '最大会话大小（MB）',
  'settings.sessions.maxSizeAria': '最大会话大小',
  'settings.sessions.agentBehaviour': '代理行为',
  'settings.sessions.toolBudget': '工具使用预算',
  'settings.sessions.toolBudgetAria': '工具使用预算',
  'settings.sessions.toolBudgetHint': '每回合最大已完成工具执行次数',
  'settings.sessions.isolation': '会话隔离',
  'settings.sessions.isolationNone': '无 — 完全跨会话可见',
  'settings.sessions.isolationSummary': '摘要 — 工具可见，无参数',
  'settings.sessions.isolationFull': '完全 — 会话之间不可见',
  'settings.editor.heading': '编辑器',
  'settings.editor.vimMode': 'Vim 模式',
  'settings.editor.showWhitespace': '显示空白字符',
  'settings.editor.livePreview': 'Markdown 实时预览',
  'settings.editor.fontSize': '字号（px）',
  'settings.editor.fontSizeAria': '编辑器字号',
  'settings.editor.fontFamily': '字体',
  'settings.editor.fontFamilyPlaceholder': 'monospace（默认）',
  'settings.editor.localOnlyHint': '仅限此浏览器。编辑器更改存储在本地浏览器中，并在下次打开或重新加载文件标签页时生效。',
  'settings.appearance.syncing': '正在同步外观…',
  'settings.appearance.default': '默认',
  'settings.appearance.autoLightDark': '自动（浅色/深色）',
  'settings.appearance.tint': '色调：',
  'settings.appearance.clearTint': '清除色调',
  'settings.appearance.none': '无',
  'settings.appearance.outputPadding': '输出内边距',
  'settings.appearance.outputPaddingHint': '消息和思考面板周围的额外空间。',
  'settings.keyboard.heading': '键盘',
  'settings.keyboard.hint1': '将应用级快捷键自定义为逗号分隔的绑定。更改立即生效。',
  'settings.keyboard.hint1b': '已保留用于关闭/中止，无法重新绑定。',
  'settings.keyboard.hint2mid': '以及键入',
  'settings.keyboard.hint2end': '（在输入框外）可打开此面板。',
  'settings.keyboard.resetAll': '全部重置为默认',
  'settings.keyboard.defaultColon': '默认：',
  'settings.keyboard.save': '保存',
  'settings.keyboard.defaultBtn': '默认',
  'settings.keyboard.noMatch': '没有匹配此筛选的快捷键。',
  'settings.keyboard.invalidShortcut': '无效快捷键：{token}。Escape 已保留，无法重新绑定。',
  'settings.keyboard.saved': '快捷键已保存。',
  'settings.keyboard.resetOne': '快捷键已重置为默认。',
  'settings.keyboard.resetAllDone': '快捷键已全部重置为默认。',
  'settings.workspace.serverApplied': '工作区设置已应用。服务器端限制立即影响新的工作区请求。',
  'settings.workspace.browserApplied': '浏览器工作区设置已在此标签页立即应用。',
  'settings.workspace.access': '访问',
  'settings.workspace.enableTerminal': '启用 Web 终端',
  'settings.workspace.allowVnc': '允许直接 VNC 目标',
  'settings.workspace.accessHint': '终端访问立即更新。直接 VNC 目标策略适用于新的 VNC 请求。',
  'settings.workspace.guardrails': '服务器扫描防护',
  'settings.workspace.maxDepth': '最大树深度',
  'settings.workspace.maxDepthAria': '工作区树最大深度',
  'settings.workspace.maxDepthHintPre': '限制所有',
  'settings.workspace.maxDepthHintPost': '请求',
  'settings.workspace.maxEntries': '每次扫描最大条目数',
  'settings.workspace.maxEntriesAria': '工作区树最大条目数',
  'settings.workspace.maxEntriesHint': '更早截断超大的树遍历',
  'settings.workspace.thisBrowser': '此浏览器',
  'settings.workspace.refreshInterval': '刷新间隔（秒）',
  'settings.workspace.refreshIntervalAria': '工作区刷新间隔',
  'settings.workspace.folderDepth': '文件夹预览扫描深度',
  'settings.workspace.folderDepthAria': '文件夹预览扫描深度',
  'settings.workspace.folderDepthHintPre': '设为',
  'settings.workspace.folderDepthHintPost': '以禁用文件夹大小预览扫描',
  'settings.workspace.footerHint': '根目录和文件夹展开的树加载保持较浅；文件夹大小预览是 UI 中最深的工作区扫描。',
  'settings.models.thinkingLevel': '思考级别',
  'settings.models.noThinking': '当前模型不支持思考。',
  'settings.models.thinkingLevelLabel': '思考级别：',
  'settings.models.loading': '正在加载模型…',
  'settings.models.summary': '在狭窄面板中，模型和提供商名称可能换行以避免裁切。',
  'settings.models.scopedOnly': '仅限范围内模型',
  'settings.models.scopedCheckboxPre': '使用 Pi 的',
  'settings.models.scopedCheckboxPost': '作为 Piclaw 模型列表',
  'settings.models.scopedHintPre': '筛选此选择器和',
  'settings.models.scopedHintPost': '工具。TUI 模型选择保持不变。',
  'settings.models.colModel': '模型',
  'settings.models.colProvider': '提供商',
  'settings.models.colContext': '上下文',
  'settings.models.colReasoning': '推理',
  'settings.models.noMatch': '没有匹配 “{filter}” 的模型',
  'settings.tools.unavailable': '工具数据不可用。',
  'settings.tools.search': '搜索',
  'settings.tools.matchMode': '匹配模式',
  'settings.tools.orMode': '任意关键词（OR）— 结果至少匹配一个搜索词',
  'settings.tools.andMode': '所有关键词（AND）— 结果必须匹配每个搜索词',
  'settings.tools.colEnabled': '已启用',
  'settings.tools.colTool': '工具',
  'settings.tools.colCompact': '结果压缩',
  'settings.tools.colKind': '类型',
  'settings.tools.colSummary': '摘要',
  'settings.tools.colSource': '来源',
  'settings.tools.disableCompaction': '为此工具禁用工具结果压缩',
  'settings.tools.enableCompaction': '为此工具启用工具结果压缩',
  'settings.tools.noMatch': '没有匹配 “{filter}” 的工具',
  'settings.tools.footer': '工具激活由代理运行时管理。组复选框可折叠/展开；“压缩”列控制工具结果压缩资格。',
  'settings.environment.heading': '环境',
  'settings.environment.introPre': '仅显示非 keychain 环境变量。覆盖项存储在扩展 KV 中并应用于',
  'settings.environment.introPost': '，因此后续工具调用会继承它们。',
  'settings.environment.refresh': '刷新',
  'settings.environment.addOverride': '添加覆盖',
  'settings.environment.valuePlaceholder': '值',
  'settings.environment.save': '保存',
  'settings.environment.countLine': '{count} 个变量可见 • {overrides} 个覆盖生效 • {keychain} 个 keychain 注入变量已隐藏',
  'settings.environment.overridden': '在 KV 中覆盖',
  'settings.environment.inherited': '继承自进程环境',
  'settings.environment.kindOverride': '覆盖',
  'settings.environment.kindProcess': '进程',
  'settings.environment.clear': '清除',
  'settings.environment.noMatch': '没有匹配 “{filter}” 的环境变量。',
  'settings.environment.refreshedToast': '环境已刷新。',
  'settings.environment.savedToast': '已保存 {name} 的环境覆盖。',
  'settings.environment.clearedToast': '已清除 {name} 的环境覆盖。',
  'settings.quickActions.loading': '加载中…',
  'settings.quickActions.heading': '时间线快捷操作',
  'settings.quickActions.intro': '选择哪些操作出现在时间线预输入中。代理始终优先固定，然后是工作区命令，再是斜杠命令。',
  'settings.quickActions.enableAll': '全部启用',
  'settings.quickActions.saving': '保存中…',
  'settings.quickActions.saveApply': '保存并应用',
  'settings.quickActions.workspaceCommands': '工作区命令',
  'settings.quickActions.noWorkspaceMatch': '没有匹配此筛选的工作区命令。',
  'settings.quickActions.slashCommands': '斜杠命令',
  'settings.quickActions.slashFallback': '斜杠命令',
  'settings.quickActions.noSlashMatch': '没有匹配此筛选的斜杠命令。',
  'settings.quickActions.savingToast': '正在保存快捷操作…',
  'settings.quickActions.savedToast': '快捷操作已保存。',
  'settings.providers.authApiKey': 'API 密钥',
  'settings.providers.authConfigured': '已配置',
  'settings.providers.heading': '提供商',
  'settings.providers.tagCustom': '自定义',
  'settings.providers.logout': '注销',
  'settings.providers.reconfigure': '重新配置',
  'settings.providers.setUp': '设置',
  'settings.providers.setupHint': '登录流程在浏览器中打开。在狭窄面板中，设置表单会垂直堆叠以避免裁切。',
  'settings.providers.starting': '启动中…',
  'settings.providers.signInOAuth': '使用 OAuth 登录',
  'settings.providers.apiKeyLabel': 'API 密钥',
  'settings.providers.apiKeyPlaceholder': '输入 API 密钥',
  'settings.providers.save': '保存',
  'settings.providers.configuring': '配置中…',
  'settings.providers.saveConfig': '保存配置',
  'settings.providers.apiKeyEmpty': 'API 密钥不能为空。',
  'settings.providers.configuringToast': '正在配置 {provider}…',
  'settings.providers.configured': '{provider} 已配置。',
  'settings.providers.startingOAuth': '正在为 {provider} 启动 OAuth…',
  'settings.providers.oauthOpened': 'OAuth 窗口已打开。完成登录流程，然后关闭此消息。',
  'settings.providers.oauthStarted': '已为 {provider} 启动 OAuth 流程。请查看聊天。',
  'settings.providers.loggingOut': '正在注销 {provider}…',
  'settings.providers.loggedOut': '已注销 {provider}。可能需要重启。',
  'settings.general.identity': '身份',
  'settings.general.userLabel': '用户',
  'settings.general.yourName': '你的名字',
  'settings.general.agentLabel': '代理',
  'settings.general.agentName': '代理名称',
  'settings.general.notifications': '通知',
  'settings.general.browserNotifications': '浏览器通知',
  'settings.general.notifSecureHint': '使用输入栏中的 🔔 铃铛按钮来启用/禁用通知。Web Push 需要 HTTPS 或 localhost。',
  'settings.general.notifInsecureHint': '⚠ 不可用 — 需要安全上下文（HTTPS 或 localhost）。通过 SSH 隐道或带 TLS 的反向代理访问以启用。',
  'settings.general.display': '显示',
  'settings.general.systemMeters': '系统仪表',
  'settings.general.systemMetersHint': '状态栏中的 CPU/内存/网络仪表。仅限此浏览器。',
  'settings.general.instanceConfig': '实例配置',
  'settings.general.composeUpload': '撰写上传（MB）',
  'settings.general.composeUploadAria': '撰写上传限制',
  'settings.general.composeUploadHint': '聊天/媒体附件',
  'settings.general.workspaceUpload': '工作区上传（MB）',
  'settings.general.workspaceUploadAria': '工作区上传限制',
  'settings.general.workspaceUploadHint': '默认为 256 MB；分块上传最多允许 1 GB',
  'settings.general.agentRecovery': '高级 · 代理恢复',
  'settings.general.automaticRecovery': '自动恢复',
  'settings.general.automaticRecoveryHint': '自动重试可恢复的失败回合。',
  'settings.general.recoveryMaxAttempts': '最大尝试次数',
  'settings.general.recoveryMaxAttemptsAria': '自动恢复最大尝试次数',
  'settings.general.recoveryMaxAttemptsHint': '0 表示继承常规重试限制。',
  'settings.general.recoveryTotalBudget': '总预算（毫秒）',
  'settings.general.recoveryTotalBudgetAria': '自动恢复总预算（毫秒）',
  'settings.general.recoveryTotalBudgetHint': '限制单个回合的所有自动恢复工作。',
  'settings.general.authentication': '身份验证',
  'settings.general.widgetToken': '小部件 bearer 令牌',
  'settings.general.token': '令牌',
  'settings.general.hideToken': '隐藏令牌',
  'settings.general.revealToken': '显示令牌',
  'settings.general.copyToken': '复制令牌',
  'settings.general.copied': '已复制',
  'settings.general.regenerating': '正在重新生成…',
  'settings.general.regenerate': '重新生成',
  'settings.general.tokenHintPre': '只读令牌，用于',
  'settings.general.tokenHintMid': '和',
  'settings.general.tokenHintPost': '。用作',
  'settings.general.tokenHintEnd': '。',
  'settings.general.copyFailed': '无法复制小部件令牌。请选择令牌字段并手动复制。',
  'settings.general.regenConfirm': '重新生成小部件令牌？使用旧令牌的现有 macOS 小部件将停止更新。',
  'settings.general.totpTitle': 'TOTP 设置二维码',
  'settings.general.totpConfiguredHint': '当前 Web 登录验证器密钥。扫描此二维码以添加另一个验证器设备。',
  'settings.general.totpUnconfiguredHint': '此实例尚未配置 TOTP，因此没有可用的设置二维码。',
  'settings.general.issuer': '颁发者',
  'settings.general.label': '标签',
  'settings.general.secret': '密钥',
  'settings.general.avatarUpload': '点击上传',
  'settings.developer.heading': '开发者',
  'settings.developer.devMode': '开发者模式',
  'settings.developer.localHint': '仅限此浏览器。开发者模式开关和插件目录覆盖存储在本地浏览器存储中。',
  'settings.developer.addonSources': '插件来源',
  'settings.developer.catalogUrl': '目录 URL',
  'settings.developer.catalogHint': '主插件目录 URL。留空以使用默认值',
  'settings.developer.additionalCatalogs': '其他目录 URL',
  'settings.developer.additionalHint': '在主/默认目录之外额外获取。每行一个 URL。',
  'settings.developer.repoUrl': '仓库 URL',
  'settings.developer.repoHintPre': '覆盖用于',
  'settings.developer.repoHintPost': '安装的 git 仓库。留空以使用默认值。',
  'settings.developer.debug': '调试',
  'settings.developer.logSse': '记录 SSE 事件',
  'settings.developer.logToolCalls': '记录工具调用',
  'settings.developer.debugHint': '调试标志在下次页面重新加载时生效。',
  'settings.addons.installing': '正在安装 {slug}…',
  'settings.addons.removing': '正在移除 {slug}…',
  'settings.addons.installedToast': '插件已安装。',
  'settings.addons.removedToast': '插件已移除。',
  'settings.addons.restarting': '正在重启 piclaw…',
  'settings.addons.restartComplete': '重启完成 — 插件已刷新。',
  'settings.addons.restartTimeout': '后端未能及时返回。请手动重新加载页面。',
  'settings.addons.fetching': '正在获取插件…',
  'settings.addons.loadFailed': '无法加载插件。',
  'settings.addons.catalogFromPre': '目录来自',
  'settings.addons.catalogMerged': '已合并 {count} 个目录来源。',
  'settings.addons.installNote': '通过 Bun 优先安装包；安装/卸载后需要重启。',
  'settings.addons.failedFetchSingular': '获取 {count} 个目录来源失败：',
  'settings.addons.failedFetchPlural': '获取 {count} 个目录来源失败：',
  'settings.addons.activeSources': '活动目录来源（{count}）',
  'settings.addons.windowsWarning': '原生 Windows 插件安装风险更高：Bun 包安装、符号链接清理、锁定文件和重启时机都可能不如 Linux/WSL 可预测。如果可能，请优先使用 WSL 或容器。',
  'settings.addons.typeExtSkill': '扩展 + 技能',
  'settings.addons.typeSkill': '技能',
  'settings.addons.typeExt': '扩展',
  'settings.addons.update': '更新',
  'settings.addons.remove': '移除',
  'settings.addons.install': '安装',
  'settings.addons.noMatch': '没有匹配 “{filter}” 的插件',
  'settings.addons.restartNotice': '扩展更改已安装，但在 piclaw 重启之前处于非活动状态。',
  'settings.addons.restartNow': '立即重启',
  'settings.recordings.modeFull': '完整 / 受信任',
  'settings.recordings.modeMetadata': '仅元数据',
  'settings.recordings.modeRedacted': '已脱敏',
  'settings.recordings.selectPrompt': '选择一个录制以检查、回放、导出或删除。',
  'settings.recordings.playback': '回放',
  'settings.recordings.refresh': '刷新',
  'settings.recordings.delete': '删除',
  'settings.recordings.status': '状态',
  'settings.recordings.mode': '模式',
  'settings.recordings.chat': '聊天',
  'settings.recordings.started': '开始',
  'settings.recordings.ended': '结束',
  'settings.recordings.events': '事件',
  'settings.recordings.redactions': '脱敏',
  'settings.recordings.exportJson': '导出 JSON',
  'settings.recordings.exportJsonl': '导出 JSONL',
  'settings.recordings.exportHtml': '导出独立 HTML',
  'settings.recordings.eventSummary': '事件摘要',
  'settings.recordings.inspectHint': '打开或刷新详情以检查跟踪事件。',
  'settings.recordings.firstEvents': '首批事件',
  'settings.recordings.heading': '会话录制',
  'settings.recordings.intro': '选择性加入的跟踪捕获，用于确定性回放和屏幕录制导出。回放绝不会调用实时代理或工具端点。',
  'settings.recordings.chatJid': '聊天 JID',
  'settings.recordings.title': '标题',
  'settings.recordings.titlePlaceholder': '演示录制',
  'settings.recordings.modeLabelField': '模式',
  'settings.recordings.optRedacted': '已脱敏',
  'settings.recordings.optMetadata': '仅元数据',
  'settings.recordings.optFull': '完整 / 受信任本地',
  'settings.recordings.includeSnapshot': '包含时间线快照',
  'settings.recordings.extraKeys': '额外脱敏键',
  'settings.recordings.extraPatterns': '额外正则模式',
  'settings.recordings.stopCurrent': '停止当前聊天录制',
  'settings.recordings.start': '开始录制',
  'settings.recordings.redactionPreview': '脱敏预览',
  'settings.recordings.previewRedaction': '预览脱敏',
  'settings.recordings.loading': '正在加载录制…',
  'settings.recordings.noneYet': '还没有录制。',
  'settings.recordings.noneYetHint': '在上方开始录制，然后使用回放/导出进行确定性屏幕捕获。',
  'settings.recordings.listLabel': '会话录制',
  'settings.recordings.eventsCount': '{count} 个事件',
  'settings.recordings.noMatch': '没有匹配 “{filter}” 的录制。',
  'settings.recordings.startedToast': '已为 {chat} 开始录制。',
  'settings.recordings.startFailed': '开始录制失败。',
  'settings.recordings.stoppedToast': '已为 {chat} 停止录制。',
  'settings.recordings.stopFailed': '停止录制失败。',
  'settings.recordings.deleteConfirm': '删除录制 {id}？',
  'settings.recordings.deletedToast': '录制已删除。',
  'settings.recordings.deleteFailed': '删除录制失败。',
  'settings.recordings.loadOneFailed': '加载录制失败。',
  'settings.recordings.loadFailed': '加载录制失败。',
  'settings.recordings.previewFailed': '预览失败。',
  'settings.keychain.loadFailed': '加载密钥链失败。',
  'settings.keychain.addFailed': '添加条目失败。',
  'settings.keychain.deleteFailed': '删除条目失败。',
  'settings.keychain.saveNotesFailed': '保存备注失败。',
  'settings.keychain.revealFailed': '显示失败。',
  'settings.keychain.loading': '正在加载密钥链…',
  'settings.keychain.entryCountSingular': '{count} 个条目',
  'settings.keychain.entryCountPlural': '{count} 个条目',
  'settings.keychain.matchingFilter': ' 匹配 "{filter}"',
  'settings.keychain.encryptedSuffix': '，静态加密。',
  'settings.keychain.clickPrefix': '点击',
  'settings.keychain.revealSuffix': '以显示。',
  'settings.keychain.cancel': '取消',
  'settings.keychain.addEntry': '+ 添加条目',
  'settings.keychain.namePlaceholder': '条目名称（例如 github/my-token）',
  'settings.keychain.secretPlaceholder': '密钥值',
  'settings.keychain.usernamePlaceholder': '用户名（可选）',
  'settings.keychain.saving': '正在保存…',
  'settings.keychain.save': '保存',
  'settings.keychain.userNotePlaceholder': '用户备注（仅在此界面可见）',
  'settings.keychain.agentNotePlaceholder': '代理备注（可安全暴露给代理）',
  'settings.keychain.noMatchFilter': '没有条目匹配筛选条件。',
  'settings.keychain.noEntries': '没有密钥链条目。',
  'settings.keychain.hideSecret': '隐藏密钥',
  'settings.keychain.revealSecret': '显示密钥',
  'settings.keychain.deleteQ': '删除？',
  'settings.keychain.yes': '是',
  'settings.keychain.no': '否',
  'settings.keychain.deleteTitle': '删除',
  'settings.keychain.userNote': '用户备注',
  'settings.keychain.agentNote': '代理可读备注',
  'settings.keychain.userNoteHint': '仅限人工/界面备注',
  'settings.keychain.agentNoteHint': '给代理的安全指引',
  'settings.keychain.saveNotes': '保存备注',
  'settings.keychain.masterPassword': '主密码：',
  'settings.keychain.masterPasswordPlaceholder': '输入密钥链主密码',
  'settings.keychain.unlock': '解锁',
  'settings.keychain.totpCode': 'TOTP 代码：',
  'settings.keychain.verify': '验证',
  'settings.keychain.username': '用户名',
  'settings.keychain.copyUsername': '复制用户名',
  'settings.keychain.secret': '密钥',
  'settings.keychain.copySecret': '复制密钥',
  'settings.tasks.internalProtected': '内部/受保护',
  'settings.tasks.noRunLogs': '尚未记录运行日志。',
  'settings.tasks.noSummary': '无摘要',
  'settings.tasks.selectPrompt': '选择一个任务以查看计划、状态和运行历史。',
  'settings.tasks.pause': '暂停',
  'settings.tasks.resume': '恢复',
  'settings.tasks.delete': '删除',
  'settings.tasks.status': '状态',
  'settings.tasks.kind': '类型',
  'settings.tasks.schedule': '计划',
  'settings.tasks.nextRun': '下次运行',
  'settings.tasks.lastRun': '上次运行',
  'settings.tasks.lastResult': '上次结果',
  'settings.tasks.chat': '聊天',
  'settings.tasks.model': '模型',
  'settings.tasks.cwd': '工作目录',
  'settings.tasks.timeout': '超时',
  'settings.tasks.protection': '保护',
  'settings.tasks.protectionHint': '内部任务操作需要明确确认。',
  'settings.tasks.command': '命令',
  'settings.tasks.prompt': '提示',
  'settings.tasks.recentRuns': '最近运行',
  'settings.tasks.activeLabel': '活动',
  'settings.tasks.pausedLabel': '已暂停',
  'settings.tasks.completedLabel': '已完成',
  'settings.tasks.allStatuses': '所有状态',
  'settings.tasks.filterChatPlaceholder': '筛选聊天 JID…',
  'settings.tasks.refresh': '刷新',
  'settings.tasks.loading': '正在加载计划任务…',
  'settings.tasks.noneFound': '未找到计划任务。',
  'settings.tasks.noneFoundHint': '通过提醒、`/tasks` 或调度工具创建的任务将显示在此处。',
  'settings.tasks.listLabel': '计划任务',
  'settings.tasks.next': '下次',
  'settings.tasks.last': '上次',
  'settings.tasks.noMatch': '没有任务匹配 “{filter}”。',
  'settings.tasks.confirmDelete': '删除计划任务 {id}？',
  'settings.tasks.confirmPause': '暂停计划任务 {id}？',
  'settings.tasks.confirmResume': '恢复计划任务 {id}？',
  'settings.tasks.confirmProtected': '任务 {id} 是内部/受保护的。继续执行 {action}？',
  'settings.tasks.deleting': '正在删除 {id}…',
  'settings.tasks.pausing': '正在暂停 {id}…',
  'settings.tasks.resuming': '正在恢复 {id}…',
  'settings.tasks.deletedToast': '计划任务 {id} 已删除。',
  'settings.tasks.pausedToast': '计划任务 {id} 已暂停。',
  'settings.tasks.resumedToast': '计划任务 {id} 已恢复。',
  'settings.tasks.actionFailed': '执行 {action} 任务失败。',
  'settings.tasks.loadFailed': '加载计划任务失败。',
  'settings.compaction.appliedNotice': '压缩设置已应用。现有回合保留其当前计时器；新回合使用更新后的值。',
  'settings.compaction.saving': '正在保存压缩设置…',
  'settings.compaction.saveFailed': '保存压缩设置失败。',
  'settings.compaction.saved': '压缩设置已保存。',
  'settings.compaction.clearing': '正在清除 {chat} 的压缩抑制…',
  'settings.compaction.clearFailed': '清除压缩抑制失败。',
  'settings.compaction.cleared': '已清除 {chat} 的压缩抑制。',
  'settings.compaction.autoHeading': '自动压缩',
  'settings.compaction.enableAutomatic': '启用自动压缩',
  'settings.compaction.enableAutomaticHint': '由 Piclaw 管理的提示前/空闲压缩。上游代理自动压缩器会继续在内部保持禁用。',
  'settings.compaction.processingMethod': '处理方法',
  'settings.compaction.model': '压缩模型',
  'settings.compaction.modelHint': '用于本地智能压缩的严格模型。若已配置但不可用，压缩会停止并保留会话，不会回退。',
  'settings.compaction.modelPlaceholder': '提供商/模型（留空则使用当前模型）',
  'settings.compaction.methodSelective': '选择性',
  'settings.compaction.methodSelectiveHint': '提取高价值的连续性片段；当有界提示无法表示所有被丢弃的源事件时，使用完整的渐进式覆盖。',
  'settings.compaction.methodPipelined': '流水线',
  'settings.compaction.methodPipelinedHint': '在摘要前，对每个被丢弃的源事件进行规范化和分类，并生成可审计的覆盖账本。',
  'settings.compaction.remoteNative': '提供商原生压缩',
  'settings.compaction.remoteNativeHint': '仅对明确支持的提供商启用（{providers}）。任何失败都会自动回退到所选的本地方法。',
  'settings.compaction.remoteTimeout': '提供商原生超时（秒）',
  'settings.compaction.remoteTimeoutAria': '提供商原生压缩超时',
  'settings.compaction.remoteTimeoutHint': '远程预处理在回退到本地方法之前的截止时间。',
  'settings.compaction.enableToolResult': '启用工具结果压缩',
  'settings.compaction.enableToolResultHint': '禁用时，大型工具结果保持内联，不会外部化为可搜索的工具输出句柄。',
  'settings.compaction.semanticSummaries': '压缩工具结果的语义摘要',
  'settings.compaction.semanticSummariesHint': '启用时，压缩输出包含使用活动模型生成的语义摘要（失败时回退到预览）。',
  'settings.compaction.inputLimit': '语义摘要输入限制（字符）',
  'settings.compaction.inputLimitAria': '语义摘要输入限制',
  'settings.compaction.inputLimitHint': '用于语义摘要的完整工具输出采样的最大字符数。',
  'settings.compaction.maxTokens': '语义摘要输出最大令牌数',
  'settings.compaction.maxTokensAria': '语义摘要最大令牌数',
  'settings.compaction.maxTokensHint': '生成摘要长度的上限。',
  'settings.compaction.summaryTimeout': '语义摘要超时（秒）',
  'settings.compaction.summaryTimeoutAria': '语义摘要超时',
  'settings.compaction.summaryTimeoutHint': '在此超时后中止语义摘要生成并回退到预览压缩。',
  'settings.compaction.threshold': '压缩阈值（%）',
  'settings.compaction.thresholdAria': '压缩阈值',
  'settings.compaction.thresholdHint': '当上下文超过窗口的此百分比时自动压缩',
  'settings.compaction.timeout': '压缩超时（秒）',
  'settings.compaction.timeoutAria': '压缩超时',
  'settings.compaction.timeoutHint': '中止卡住的预提示/手动压缩，而不是永远挂起。',
  'settings.compaction.backoffBase': '失败退避基数（分钟）',
  'settings.compaction.backoffBaseAria': '压缩退避基数',
  'settings.compaction.backoffBaseHint': '压缩失败后的首个抑制窗口。',
  'settings.compaction.backoffMax': '失败退避最大值（分钟）',
  'settings.compaction.backoffMaxAria': '压缩退避最大值',
  'settings.compaction.backoffMaxHint': '重复失败后指数抑制的上限。',
  'settings.compaction.decayFactor': '退避衰减系数',
  'settings.compaction.decayFactorAria': '退避衰减系数',
  'settings.compaction.decayFactorHint': '% — 每次成功压缩后退避减半',
  'settings.compaction.watchdogHeading': '停滞监视器',
  'settings.compaction.enableWatchdog': '启用监视器',
  'settings.compaction.enableWatchdogHint': '默认禁用。启用时，如果活动阶段停止心跳，辅助进程将终止运行时。',
  'settings.compaction.watchdogTimeout': '监视器超时（秒）',
  'settings.compaction.watchdogTimeoutAria': '监视器超时',
  'settings.compaction.watchdogTimeoutHint': '活动阶段在监视器终止运行时之前可以无心跳持续多长时间。',
  'settings.compaction.suppressionsHeading': '活动压缩抑制',
  'settings.compaction.noBackoff': '当前没有聊天处于压缩退避状态。',
  'settings.compaction.clear': '清除',
  'settings.compaction.phasesHeading': '实时监视器阶段',
  'settings.compaction.noPhases': '目前没有活动的跟踪阶段。',
  'menu.title': '菜单',
  'menu.showWorkspace': '显示工作区',
  'menu.hideWorkspace': '隐藏工作区',
  'menu.openExplorer': '打开资源管理器',
  'menu.chatOnly': '仅聊天模式',
  'menu.exitChatOnly': '退出仅聊天模式',
  'menu.openTerminal': '在标签页中打开终端',
  'menu.openVnc': '在标签页中打开 VNC',
  'menu.newFile': '新建文件',
  'menu.openRecent': '打开最近文件',
  'menu.refreshTree': '刷新目录树',
  'menu.reindex': '重建工作区索引',
  'menu.showHidden': '显示隐藏文件',
  'menu.hideHidden': '隐藏隐藏文件',
  'menu.scale': '缩放',
  'menu.settings': '设置',
};

const JA: Partial<Record<MessageKey, string>> = {
  'compose.placeholder': 'メッセージ（Enterで送信、Shift+Enterで改行）...',
  'compose.send': '送信',
  'compose.stop': '停止',
  'compose.searchPlaceholder': '検索（Enterで実行）...',
  'compose.clearAll': 'すべてクリア',
  'compose.clearAllTitle': 'すべての添付と参照をクリア',
  'compose.scope': '範囲',
  'compose.searchScope': '検索範囲',
  'compose.scopeCurrent': '現在',
  'compose.scopeBranchFamily': 'ブランチファミリー',
  'compose.scopeAll': 'すべてのチャット',
  'compose.filterImages': '画像',
  'compose.filterAttachments': '添付',
  'compose.search': '検索',
  'compose.closeSearch': '検索を閉じる',
  'compose.shareLocation': '位置を共有',
  'compose.attachFile': 'ファイルを添付',
  'compose.queueControls': 'キュー済みフォローアップの操作',
  'compose.moveUp': '上に移動',
  'compose.moveUpQueue': 'キュー内で上に移動',
  'compose.moveDown': '下に移動',
  'compose.moveDownQueue': 'キュー内で下に移動',
  'compose.editInCompose': '入力欄で編集',
  'compose.returnToEditor': 'キュー済みメッセージを入力欄に戻す',
  'compose.injectSteer': 'キュー済みフォローアップをステアとして挿入',
  'compose.steer': 'ステア',
  'compose.cancelQueued': 'キュー済みメッセージをキャンセル',
  'compose.resizeInput': 'メッセージ入力欄のサイズ変更',
  'compose.resizeInputHint': 'ドラッグしてメッセージ入力欄のサイズを変更',
  'compose.modelPicker': 'モデルピッカー',
  'compose.sessionsAndAgents': 'セッションとエージェント',
  'compose.openModelPicker': 'モデルピッカーを開く',
  'compose.newBranchTitle': 'このチャットから新しいブランチを作成',
  'compose.newRootTitle': 'web:ops のようなクリーンなルートセッションを作成',
  'compose.renameSessionTitle': '現在のセッションの名前を変更',
  'compose.pruneSessionTitle': '現在のエージェント/セッションブランチを削除（プルーン）',
  'compose.filterImagesTitle': '画像付きメッセージのみ表示',
  'compose.filterAttachmentsTitle': '添付付きメッセージのみ表示',
  'compose.selectModel': 'モデルを選択',
  'compose.loadingModels': 'モデルを読み込み中…',
  'compose.noModels': '利用可能なモデルがありません。',
  'compose.nextModel': '次のモデル',
  'compose.manageSessions': 'セッションとエージェントを管理',
  'compose.noSessions': '他のセッションはまだありません。',
  'compose.newBranch': '新しいブランチ',
  'compose.newRoot': '新しいルート…',
  'compose.mergeCurrent': '現在を親にマージ',
  'compose.renameCurrent': '現在の名前を変更…',
  'compose.deleteCurrent': '現在を削除…',
  'compose.mergeInto': 'このブランチを {target} にマージ',
  'compose.mergeBlocked': 'このブランチはアクティブな間または子がある間はマージできません',
  'workspace.title': 'ワークスペース',
  'workspace.moveConfirm': '{entry}「{name}」を{source}から{target}へ移動しますか？',
  'workspace.root': 'ワークスペースのルート',
  'workspace.file': 'ファイル',
  'workspace.folder': 'フォルダー',
  'workspace.newFile': '新規ファイル',
  'workspace.refresh': '更新',
  'workspace.actions': 'ワークスペース操作',
  'workspace.uploadFiles': 'ファイルをアップロード',
  'workspace.reindexing': 'ワークスペースを再インデックス中…',
  'workspace.deleteFile': 'ファイルを削除',
  'workspace.download': 'ダウンロード',
  'workspace.uploadToFolder': 'このフォルダにファイルをアップロード',
  'workspace.addFolderHint': 'フォルダのヒントを入力欄に追加',
  'workspace.downloadZip': 'フォルダをzipでダウンロード',
  'workspace.openInTab': 'タブで開く',
  'workspace.openInEditor': 'エディタで開く',
  'workspace.renameSelected': '選択項目の名前を変更',
  'workspace.downloadSelectedFile': '選択したファイルをダウンロード',
  'workspace.downloadSelectedFolder': '選択したフォルダをダウンロード（zip）',
  'workspace.deleteSelectedFile': '選択したファイルを削除',
  'shell.settings': '設定',
  'shell.newChat': '新規チャット',
  'shell.connecting': '接続中…',
  'shell.connected': '接続済み',
  'language.label': '言語',
  'settings.title': '設定',
  'settings.close': '閉じる（Esc）',
  'settings.filter': 'フィルター…',
  'settings.loading': '設定を読み込み中…',
  'settings.section.general': '一般',
  'settings.section.sessions': 'セッション',
  'settings.section.recordings': '録画',
  'settings.section.compaction': '圧縮',
  'settings.section.keyboard': 'キーボード',
  'settings.section.workspace': 'ワークスペース',
  'settings.section.environment': '環境',
  'settings.section.providers': 'プロバイダー',
  'settings.section.models': 'モデル',
  'settings.section.theme': '外観',
  'settings.section.scheduled-tasks': 'スケジュールタスク',
  'settings.section.quick-actions': 'クイックアクション',
  'settings.section.keychain': 'キーチェーン',
  'settings.section.tools': 'ツール',
  'settings.section.addons': 'アドオン',
  'settings.placeholder.recordings': '録画をフィルター…',
  'settings.placeholder.keyboard': 'ショートカットをフィルター…',
  'settings.placeholder.environment': '環境をフィルター…',
  'settings.placeholder.models': 'モデルをフィルター…',
  'settings.placeholder.scheduled-tasks': 'スケジュールタスクをフィルター…',
  'settings.placeholder.quick-actions': 'クイックアクションをフィルター…',
  'settings.placeholder.keychain': 'エントリをフィルター…',
  'settings.placeholder.tools': 'ツールをフィルター…',
  'settings.placeholder.addons': 'アドオンをフィルター…',
  'preview.close': '閉じる',
  'preview.loading': 'プレビューを読み込み中…',
  'preview.files': 'ファイル',
  'preview.folders': 'フォルダ',
  'preview.compressed': '圧縮後',
  'preview.uncompressed': '非圧縮',
  'preview.name': '名前',
  'preview.type': '種類',
  'preview.method': '方式',
  'preview.size': 'サイズ',
  'post.deleteMessage': 'メッセージを削除',
  'post.tooLarge': 'メッセージが大きすぎて表示できません。',
  'post.previewTruncated': 'プレビューは切り詰められました。',
  'post.submitted': '送信済み',
  'post.discard': '破棄',
  'post.save': '保存',
  'post.cancel': 'キャンセル',
  'post.addNote': 'メモを追加',
  'post.addNotePlaceholder': 'メモを追加…',
  'post.restartNotice': '再起動中 — 理由：{reason}',
  'post.restartCompleted': '再起動が完了しました。',
  'post.agentSelfResume': 'エージェントの自己再開',
  'tab.close': '閉じる',
  'tab.closeOthers': '他を閉じる',
  'tab.closeAll': 'すべて閉じる',
  'tab.reattach': '再アタッチ',
  'tab.openInWindow': 'ウィンドウで開く',
  'tab.openInNewTab': '新しいタブで開く',
  'tab.pinned': 'ピン留め済み',
  'tab.detached': '分離済み',
  'tab.openSeparateWindow': '別ウィンドウで開く',
  'status.trackedVariables': '追跡中の変数',
  'status.attachToSession': 'セッションにアタッチ',
  'status.files': 'ファイル',
  'status.proposedDiff': '提案された差分',
  'status.copyTmux': 'tmuxコマンドをコピー',
  'status.experimentDuration': '実験の経過時間',
  'status.sinceLastActivity': '最後のアクティビティから',
  'annotator.title': '画像に注釈',
  'annotator.typeLabel': 'ラベルを入力…',
  'annotator.undo': '元に戻す',
  'annotator.resetZoom': 'ズームをリセット',
  'tree.filter': 'フィルター…',
  'tree.sessionTree': 'セッションツリー',
  'btw.label': 'BTW サイド会話',
  'btw.close': 'BTW を閉じる',
  'btw.thinking': '思考中',
  'mdpreview.close': 'プレビューを閉じる',
  'mdpreview.unavailable': 'プレビューを利用できません',
  'widget.close': 'ウィジェットを閉じる',
  'oobe.gettingStarted': 'はじめに',
  'oobe.needsSetupTitle': 'インスタンスのセットアップが必要',
  'oobe.configuredTitle': 'インスタンスは設定済み',
  'oobe.needsSetupBody': 'このインスタンスはまだ設定されていません。設定を開き、AIプロバイダー/モデルを設定してリクエストの送信を開始してください。',
  'oobe.configuredBody': 'このインスタンスは設定済みのようです。設定でプロバイダーとモデルの設定を確認または更新してください。',
  'oobe.openSettings': '設定を開く',
  'oobe.dismiss': '閉じる',
  'oobe.done': '完了',
  'palette.placeholder': '入力してエージェント、ワークスペース操作、またはスラッシュコマンドにジャンプ…',
  'palette.hideWorkspace': 'ワークスペースを非表示',
  'palette.showWorkspace': 'ワークスペースを表示',
  'palette.hideWorkspaceDesc': 'ワークスペースサイドバーを非表示にします。',
  'palette.showWorkspaceDesc': 'ワークスペースサイドバーを表示します。',
  'palette.exitChatOnly': 'チャットのみモードを終了',
  'palette.chatOnly': 'チャットのみモード',
  'palette.exitChatOnlyDesc': '分割ワークスペースレイアウトに戻ります。',
  'palette.chatOnlyDesc': 'チャットのみのレイアウトに切り替えます。',
  'palette.groupAgents': 'エージェント',
  'palette.groupWorkspace': 'ワークスペース',
  'palette.groupSlash': 'スラッシュコマンド',
  'palette.hintMove': '移動',
  'palette.hintSelect': '選択',
  'palette.hintPopOut': 'ポップアウト',
  'palette.hintClose': '閉じる',
  'settings.appliedNotice': '設定を適用しました。変更は次のターンから有効になります。',
  'settings.sessions.lifecycle': 'セッションのライフサイクル',
  'settings.sessions.autoRotate': 'セッションを自動ローテーション',
  'settings.sessions.maxSize': '最大セッションサイズ（MB）',
  'settings.sessions.maxSizeAria': '最大セッションサイズ',
  'settings.sessions.agentBehaviour': 'エージェントの動作',
  'settings.sessions.toolBudget': 'ツール使用予算',
  'settings.sessions.toolBudgetAria': 'ツール使用予算',
  'settings.sessions.toolBudgetHint': '1ターンあたりの完了済みツール実行回数の上限',
  'settings.sessions.isolation': 'セッションの分離',
  'settings.sessions.isolationNone': 'なし — セッション間で完全に可視',
  'settings.sessions.isolationSummary': '概要 — ツールは可視、引数は非表示',
  'settings.sessions.isolationFull': '完全 — セッション同士は互いに見えない',
  'settings.editor.heading': 'エディター',
  'settings.editor.vimMode': 'Vim モード',
  'settings.editor.showWhitespace': '空白文字を表示',
  'settings.editor.livePreview': 'Markdown ライブプレビュー',
  'settings.editor.fontSize': 'フォントサイズ（px）',
  'settings.editor.fontSizeAria': 'エディターのフォントサイズ',
  'settings.editor.fontFamily': 'フォントファミリー',
  'settings.editor.fontFamilyPlaceholder': 'monospace（デフォルト）',
  'settings.editor.localOnlyHint': 'このブラウザーのみ。エディターの変更はローカルブラウザーストレージに保存され、次にファイルタブを開くか再読み込みしたときに有効になります。',
  'settings.appearance.syncing': '外観を同期中…',
  'settings.appearance.default': 'デフォルト',
  'settings.appearance.autoLightDark': '自動（ライト/ダーク）',
  'settings.appearance.tint': '色調：',
  'settings.appearance.clearTint': '色調をクリア',
  'settings.appearance.none': 'なし',
  'settings.appearance.outputPadding': '出力の余白',
  'settings.appearance.outputPaddingHint': 'メッセージと思考パネルの周囲に追加する余白です。',
  'settings.keyboard.heading': 'キーボード',
  'settings.keyboard.hint1': 'アプリ全体のショートカットをカンマ区切りのバインディングとしてカスタマイズします。変更はすぐに反映されます。',
  'settings.keyboard.hint1b': 'は閉じる/中止用に予約されており、再割り当てできません。',
  'settings.keyboard.hint2mid': 'と入力',
  'settings.keyboard.hint2end': 'を入力欄の外で押すとこのペインが開きます。',
  'settings.keyboard.resetAll': 'すべてデフォルトにリセット',
  'settings.keyboard.defaultColon': 'デフォルト：',
  'settings.keyboard.save': '保存',
  'settings.keyboard.defaultBtn': 'デフォルト',
  'settings.keyboard.noMatch': 'このフィルターに一致するショートカットはありません。',
  'settings.keyboard.invalidShortcut': '無効なショートカット：{token}。Escape は予約されており、再割り当てできません。',
  'settings.keyboard.saved': 'キーボードショートカットを保存しました。',
  'settings.keyboard.resetOne': 'キーボードショートカットをデフォルトにリセットしました。',
  'settings.keyboard.resetAllDone': 'キーボードショートカットをすべてデフォルトにリセットしました。',
  'settings.workspace.serverApplied': 'ワークスペース設定を適用しました。サーバー側の制限は新しいワークスペースリクエストに直ちに反映されます。',
  'settings.workspace.browserApplied': 'ブラウザーのワークスペース設定はこのタブで直ちに適用されました。',
  'settings.workspace.access': 'アクセス',
  'settings.workspace.enableTerminal': 'Web ターミナルを有効化',
  'settings.workspace.allowVnc': '直接 VNC ターゲットを許可',
  'settings.workspace.accessHint': 'ターミナルアクセスは直ちに更新されます。直接 VNC ターゲットポリシーは新しい VNC リクエストに適用されます。',
  'settings.workspace.guardrails': 'サーバースキャンのガードレール',
  'settings.workspace.maxDepth': '最大ツリー深度',
  'settings.workspace.maxDepthAria': 'ワークスペースツリーの最大深度',
  'settings.workspace.maxDepthHintPre': 'すべての',
  'settings.workspace.maxDepthHintPost': 'リクエストを制限します',
  'settings.workspace.maxEntries': 'スキャンあたりの最大エントリ数',
  'settings.workspace.maxEntriesAria': 'ワークスペースツリーの最大エントリ数',
  'settings.workspace.maxEntriesHint': '大きすぎるツリー走査を早めに打ち切ります',
  'settings.workspace.thisBrowser': 'このブラウザー',
  'settings.workspace.refreshInterval': '更新間隔（秒）',
  'settings.workspace.refreshIntervalAria': 'ワークスペース更新間隔',
  'settings.workspace.folderDepth': 'フォルダプレビューのスキャン深度',
  'settings.workspace.folderDepthAria': 'フォルダプレビューのスキャン深度',
  'settings.workspace.folderDepthHintPre': '',
  'settings.workspace.folderDepthHintPost': 'に設定するとフォルダサイズのプレビュースキャンを無効化します',
  'settings.workspace.footerHint': 'ルートおよびフォルダ展開のツリー読み込みは浅いままです。フォルダサイズのプレビューは UI で最も深いワークスペーススキャンです。',
  'settings.models.thinkingLevel': '思考レベル',
  'settings.models.noThinking': '現在のモデルは思考をサポートしていません。',
  'settings.models.thinkingLevelLabel': '思考レベル：',
  'settings.models.loading': 'モデルを読み込み中…',
  'settings.models.summary': '狭いペインでは、クリッピングを避けるためにモデル名とプロバイダー名が折り返される場合があります。',
  'settings.models.scopedOnly': 'スコープ付きモデルのみ',
  'settings.models.scopedCheckboxPre': 'Piclaw のモデル一覧に Pi の',
  'settings.models.scopedCheckboxPost': 'を使用',
  'settings.models.scopedHintPre': 'このピッカーと',
  'settings.models.scopedHintPost': 'ツールをフィルタリングします。TUI のモデル選択は変更されません。',
  'settings.models.colModel': 'モデル',
  'settings.models.colProvider': 'プロバイダー',
  'settings.models.colContext': 'コンテキスト',
  'settings.models.colReasoning': '推論',
  'settings.models.noMatch': '「{filter}」に一致するモデルはありません',
  'settings.tools.unavailable': 'ツールデータを利用できません。',
  'settings.tools.search': '検索',
  'settings.tools.matchMode': 'マッチモード',
  'settings.tools.orMode': 'いずれかのキーワード（OR）— 少なくとも1つの検索語に一致',
  'settings.tools.andMode': 'すべてのキーワード（AND）— すべての検索語に一致',
  'settings.tools.colEnabled': '有効',
  'settings.tools.colTool': 'ツール',
  'settings.tools.colCompact': '結果圧縮',
  'settings.tools.colKind': '種類',
  'settings.tools.colSummary': '概要',
  'settings.tools.colSource': 'ソース',
  'settings.tools.disableCompaction': 'このツールのツール結果コンパクションを無効化',
  'settings.tools.enableCompaction': 'このツールのツール結果コンパクションを有効化',
  'settings.tools.noMatch': '「{filter}」に一致するツールはありません',
  'settings.tools.footer': 'ツールのアクティベーションはエージェントランタイムが管理します。グループのチェックボックスで折りたたみ/展開でき、「コンパクト」列はツール結果コンパクションの対象可否を制御します。',
  'settings.environment.heading': '環境',
  'settings.environment.introPre': 'キーチェーン以外の環境変数のみを表示しています。オーバーライドは拡張機能の KV に保存され、',
  'settings.environment.introPost': 'に適用されるため、以降のツール呼び出しに継承されます。',
  'settings.environment.refresh': '更新',
  'settings.environment.addOverride': 'オーバーライドを追加',
  'settings.environment.valuePlaceholder': '値',
  'settings.environment.save': '保存',
  'settings.environment.countLine': '{count} 個の変数を表示 • {overrides} 個のオーバーライドが有効 • {keychain} 個のキーチェーン注入変数を非表示',
  'settings.environment.overridden': 'KV でオーバーライド',
  'settings.environment.inherited': 'プロセス環境から継承',
  'settings.environment.kindOverride': 'オーバーライド',
  'settings.environment.kindProcess': 'プロセス',
  'settings.environment.clear': 'クリア',
  'settings.environment.noMatch': '「{filter}」に一致する環境変数はありません。',
  'settings.environment.refreshedToast': '環境を更新しました。',
  'settings.environment.savedToast': '{name} の環境オーバーライドを保存しました。',
  'settings.environment.clearedToast': '{name} の環境オーバーライドをクリアしました。',
  'settings.quickActions.loading': '読み込み中…',
  'settings.quickActions.heading': 'タイムラインクイックアクション',
  'settings.quickActions.intro': 'タイムラインのタイプアヘッドに表示するアクションを選択します。エージェントは常に最初に固定され、次にワークスペースコマンド、その次にスラッシュコマンドが表示されます。',
  'settings.quickActions.enableAll': 'すべて有効化',
  'settings.quickActions.saving': '保存中…',
  'settings.quickActions.saveApply': '保存して適用',
  'settings.quickActions.workspaceCommands': 'ワークスペースコマンド',
  'settings.quickActions.noWorkspaceMatch': 'このフィルターに一致するワークスペースコマンドはありません。',
  'settings.quickActions.slashCommands': 'スラッシュコマンド',
  'settings.quickActions.slashFallback': 'スラッシュコマンド',
  'settings.quickActions.noSlashMatch': 'このフィルターに一致するスラッシュコマンドはありません。',
  'settings.quickActions.savingToast': 'クイックアクションを保存中…',
  'settings.quickActions.savedToast': 'クイックアクションを保存しました。',
  'settings.providers.authApiKey': 'API キー',
  'settings.providers.authConfigured': '設定済み',
  'settings.providers.heading': 'プロバイダー',
  'settings.providers.tagCustom': 'カスタム',
  'settings.providers.logout': 'ログアウト',
  'settings.providers.reconfigure': '再設定',
  'settings.providers.setUp': 'セットアップ',
  'settings.providers.setupHint': 'サインインフローはブラウザーで開きます。狭いペインではセットアップフォームが縦に積み重なってクリッピングを防ぎます。',
  'settings.providers.starting': '開始中…',
  'settings.providers.signInOAuth': 'OAuth でサインイン',
  'settings.providers.apiKeyLabel': 'API キー',
  'settings.providers.apiKeyPlaceholder': 'API キーを入力',
  'settings.providers.save': '保存',
  'settings.providers.configuring': '設定中…',
  'settings.providers.saveConfig': '設定を保存',
  'settings.providers.apiKeyEmpty': 'API キーを空にすることはできません。',
  'settings.providers.configuringToast': '{provider} を設定中…',
  'settings.providers.configured': '{provider} を設定しました。',
  'settings.providers.startingOAuth': '{provider} の OAuth を開始中…',
  'settings.providers.oauthOpened': 'OAuth ウィンドウを開きました。サインインフローを完了してから、このメッセージを閉じてください。',
  'settings.providers.oauthStarted': '{provider} の OAuth フローを開始しました。チャットを確認してください。',
  'settings.providers.loggingOut': '{provider} をログアウト中…',
  'settings.providers.loggedOut': '{provider} をログアウトしました。再起動が必要な場合があります。',
  'settings.general.identity': 'アイデンティティ',
  'settings.general.userLabel': 'ユーザー',
  'settings.general.yourName': 'あなたの名前',
  'settings.general.agentLabel': 'エージェント',
  'settings.general.agentName': 'エージェント名',
  'settings.general.notifications': '通知',
  'settings.general.browserNotifications': 'ブラウザ通知',
  'settings.general.notifSecureHint': '入力バーの 🔔 ベルボタンで通知を有効/無効にします。Web Push には HTTPS または localhost が必要です。',
  'settings.general.notifInsecureHint': '⚠ 利用不可 — セキュアコンテキスト（HTTPS または localhost）が必要です。SSH トンネルまたは TLS 付きリバースプロキシ経由でアクセスして有効化してください。',
  'settings.general.display': '表示',
  'settings.general.systemMeters': 'システムメーター',
  'settings.general.systemMetersHint': 'ステータスバーの CPU/メモリ/ネットワークメーター。このブラウザのみ。',
  'settings.general.instanceConfig': 'インスタンス設定',
  'settings.general.composeUpload': '作成アップロード（MB）',
  'settings.general.composeUploadAria': '作成アップロード上限',
  'settings.general.composeUploadHint': 'チャット/メディア添付',
  'settings.general.workspaceUpload': 'ワークスペースアップロード（MB）',
  'settings.general.workspaceUploadAria': 'ワークスペースアップロード上限',
  'settings.general.workspaceUploadHint': 'デフォルトは 256 MB。チャンクアップロードは最大 1 GB まで許可',
  'settings.general.agentRecovery': '詳細 · エージェント復旧',
  'settings.general.automaticRecovery': '自動復旧',
  'settings.general.automaticRecoveryHint': '復旧可能な失敗ターンを自動的に再試行します。',
  'settings.general.recoveryMaxAttempts': '最大試行回数',
  'settings.general.recoveryMaxAttemptsAria': '自動復旧の最大試行回数',
  'settings.general.recoveryMaxAttemptsHint': '0 は通常の再試行上限を継承します。',
  'settings.general.recoveryTotalBudget': '合計予算（ミリ秒）',
  'settings.general.recoveryTotalBudgetAria': '自動復旧の合計予算（ミリ秒）',
  'settings.general.recoveryTotalBudgetHint': '1 ターンのすべての自動復旧処理を制限します。',
  'settings.general.authentication': '認証',
  'settings.general.widgetToken': 'ウィジェット bearer トークン',
  'settings.general.token': 'トークン',
  'settings.general.hideToken': 'トークンを隠す',
  'settings.general.revealToken': 'トークンを表示',
  'settings.general.copyToken': 'トークンをコピー',
  'settings.general.copied': 'コピーしました',
  'settings.general.regenerating': '再生成中…',
  'settings.general.regenerate': '再生成',
  'settings.general.tokenHintPre': '次の読み取り専用トークン：',
  'settings.general.tokenHintMid': 'および',
  'settings.general.tokenHintPost': '。次として使用：',
  'settings.general.tokenHintEnd': '。',
  'settings.general.copyFailed': 'ウィジェットトークンをコピーできませんでした。トークンフィールドを選択して手動でコピーしてください。',
  'settings.general.regenConfirm': 'ウィジェットトークンを再生成しますか？古いトークンを使用している既存の macOS ウィジェットは更新されなくなります。',
  'settings.general.totpTitle': 'TOTP セットアップ QR',
  'settings.general.totpConfiguredHint': '現在の Web ログイン認証システムのシークレット。この QR をスキャンして別の認証デバイスを追加します。',
  'settings.general.totpUnconfiguredHint': 'このインスタンスにはまだ TOTP が設定されていないため、セットアップ QR は利用できません。',
  'settings.general.issuer': '発行者',
  'settings.general.label': 'ラベル',
  'settings.general.secret': 'シークレット',
  'settings.general.avatarUpload': 'クリックしてアップロード',
  'settings.developer.heading': '開発者',
  'settings.developer.devMode': '開発者モード',
  'settings.developer.localHint': 'このブラウザのみ。開発者モードの切り替えとアドオンカタログのオーバーライドはローカルブラウザストレージに保存されます。',
  'settings.developer.addonSources': 'アドオンソース',
  'settings.developer.catalogUrl': 'カタログ URL',
  'settings.developer.catalogHint': 'プライマリアドオンカタログ URL。空のままにするとデフォルトを使用します',
  'settings.developer.additionalCatalogs': '追加カタログ URL',
  'settings.developer.additionalHint': 'プライマリ/デフォルトカタログに加えて取得されます。1 行に 1 つの URL。',
  'settings.developer.repoUrl': 'リポジトリ URL',
  'settings.developer.repoHintPre': 'git リポジトリを上書き（',
  'settings.developer.repoHintPost': 'インストール用）。空のままでデフォルト。',
  'settings.developer.debug': 'デバッグ',
  'settings.developer.logSse': 'SSE イベントをログ記録',
  'settings.developer.logToolCalls': 'ツール呼び出しをログ記録',
  'settings.developer.debugHint': 'デバッグフラグは次回のページ再読み込み時に有効になります。',
  'settings.addons.installing': '{slug} をインストール中…',
  'settings.addons.removing': '{slug} を削除中…',
  'settings.addons.installedToast': 'アドオンをインストールしました。',
  'settings.addons.removedToast': 'アドオンを削除しました。',
  'settings.addons.restarting': 'piclaw を再起動中…',
  'settings.addons.restartComplete': '再起動完了 — アドオンを更新しました。',
  'settings.addons.restartTimeout': 'バックエンドが時間内に応答しませんでした。ページを手動で再読み込みしてください。',
  'settings.addons.fetching': 'アドオンを取得中…',
  'settings.addons.loadFailed': 'アドオンを読み込めませんでした。',
  'settings.addons.catalogFromPre': 'カタログの取得元：',
  'settings.addons.catalogMerged': '{count} 個のカタログソースをマージしました。',
  'settings.addons.installNote': 'Bun によるパッケージ優先インストール。インストール/アンインストール後に再起動が必要です。',
  'settings.addons.failedFetchSingular': '{count} 個のカタログソースの取得に失敗しました：',
  'settings.addons.failedFetchPlural': '{count} 個のカタログソースの取得に失敗しました：',
  'settings.addons.activeSources': 'アクティブなカタログソース（{count}）',
  'settings.addons.windowsWarning': 'ネイティブ Windows のアドオンインストールはリスクが高くなります：Bun パッケージのインストール、シンボリックリンクのクリーンアップ、ロックされたファイル、再起動のタイミングは、Linux/WSL よりも予測しにくい場合があります。可能であれば WSL またはコンテナを優先してください。',
  'settings.addons.typeExtSkill': '拡張機能 + スキル',
  'settings.addons.typeSkill': 'スキル',
  'settings.addons.typeExt': '拡張機能',
  'settings.addons.update': '更新',
  'settings.addons.remove': '削除',
  'settings.addons.install': 'インストール',
  'settings.addons.noMatch': '「{filter}」に一致するアドオンはありません',
  'settings.addons.restartNotice': '拡張機能の変更はインストールされましたが、piclaw が再起動するまで非アクティブです。',
  'settings.addons.restartNow': '今すぐ再起動',
  'settings.recordings.modeFull': '完全 / 信頼済み',
  'settings.recordings.modeMetadata': 'メタデータのみ',
  'settings.recordings.modeRedacted': '編集済み',
  'settings.recordings.selectPrompt': '録画を選択して検査、再生、エクスポート、または削除します。',
  'settings.recordings.playback': '再生',
  'settings.recordings.refresh': '更新',
  'settings.recordings.delete': '削除',
  'settings.recordings.status': 'ステータス',
  'settings.recordings.mode': 'モード',
  'settings.recordings.chat': 'チャット',
  'settings.recordings.started': '開始',
  'settings.recordings.ended': '終了',
  'settings.recordings.events': 'イベント',
  'settings.recordings.redactions': '編集',
  'settings.recordings.exportJson': 'JSON をエクスポート',
  'settings.recordings.exportJsonl': 'JSONL をエクスポート',
  'settings.recordings.exportHtml': 'スタンドアロン HTML をエクスポート',
  'settings.recordings.eventSummary': 'イベント概要',
  'settings.recordings.inspectHint': '詳細を開くか更新してトレースイベントを検査します。',
  'settings.recordings.firstEvents': '最初のイベント',
  'settings.recordings.heading': 'セッション録画',
  'settings.recordings.intro': '決定論的な再生と画面録画エクスポートのためのオプトイントレースキャプチャ。再生でライブエージェントやツールのエンドポイントを呼び出すことはありません。',
  'settings.recordings.chatJid': 'チャット JID',
  'settings.recordings.title': 'タイトル',
  'settings.recordings.titlePlaceholder': 'デモ録画',
  'settings.recordings.modeLabelField': 'モード',
  'settings.recordings.optRedacted': '編集済み',
  'settings.recordings.optMetadata': 'メタデータのみ',
  'settings.recordings.optFull': '完全 / 信頼済みローカル',
  'settings.recordings.includeSnapshot': 'タイムラインスナップショットを含める',
  'settings.recordings.extraKeys': '追加の編集キー',
  'settings.recordings.extraPatterns': '追加の正規表現パターン',
  'settings.recordings.stopCurrent': '現在のチャット録画を停止',
  'settings.recordings.start': '録画を開始',
  'settings.recordings.redactionPreview': '編集プレビュー',
  'settings.recordings.previewRedaction': '編集をプレビュー',
  'settings.recordings.loading': '録画を読み込み中…',
  'settings.recordings.noneYet': 'まだ録画がありません。',
  'settings.recordings.noneYetHint': '上で録画を開始し、再生/エクスポートを使用して決定論的な画面キャプチャを行います。',
  'settings.recordings.listLabel': 'セッション録画',
  'settings.recordings.eventsCount': '{count} 件のイベント',
  'settings.recordings.noMatch': '「{filter}」に一致する録画はありません。',
  'settings.recordings.startedToast': '{chat} の録画を開始しました。',
  'settings.recordings.startFailed': '録画の開始に失敗しました。',
  'settings.recordings.stoppedToast': '{chat} の録画を停止しました。',
  'settings.recordings.stopFailed': '録画の停止に失敗しました。',
  'settings.recordings.deleteConfirm': '録画 {id} を削除しますか？',
  'settings.recordings.deletedToast': '録画を削除しました。',
  'settings.recordings.deleteFailed': '録画の削除に失敗しました。',
  'settings.recordings.loadOneFailed': '録画の読み込みに失敗しました。',
  'settings.recordings.loadFailed': '録画の読み込みに失敗しました。',
  'settings.recordings.previewFailed': 'プレビューに失敗しました。',
  'settings.keychain.loadFailed': 'キーチェーンの読み込みに失敗しました。',
  'settings.keychain.addFailed': 'エントリの追加に失敗しました。',
  'settings.keychain.deleteFailed': 'エントリの削除に失敗しました。',
  'settings.keychain.saveNotesFailed': 'メモの保存に失敗しました。',
  'settings.keychain.revealFailed': '表示に失敗しました。',
  'settings.keychain.loading': 'キーチェーンを読み込み中…',
  'settings.keychain.entryCountSingular': '{count} 件のエントリ',
  'settings.keychain.entryCountPlural': '{count} 件のエントリ',
  'settings.keychain.matchingFilter': ' 「{filter}」に一致',
  'settings.keychain.encryptedSuffix': '、保存時に暗号化。',
  'settings.keychain.clickPrefix': 'クリック',
  'settings.keychain.revealSuffix': 'で表示。',
  'settings.keychain.cancel': 'キャンセル',
  'settings.keychain.addEntry': '+ エントリを追加',
  'settings.keychain.namePlaceholder': 'エントリ名（例：github/my-token）',
  'settings.keychain.secretPlaceholder': 'シークレット値',
  'settings.keychain.usernamePlaceholder': 'ユーザー名（任意）',
  'settings.keychain.saving': '保存中…',
  'settings.keychain.save': '保存',
  'settings.keychain.userNotePlaceholder': 'ユーザーメモ（この UI でのみ表示）',
  'settings.keychain.agentNotePlaceholder': 'エージェントメモ（エージェントに公開しても安全）',
  'settings.keychain.noMatchFilter': 'フィルターに一致するエントリはありません。',
  'settings.keychain.noEntries': 'キーチェーンエントリがありません。',
  'settings.keychain.hideSecret': 'シークレットを非表示',
  'settings.keychain.revealSecret': 'シークレットを表示',
  'settings.keychain.deleteQ': '削除しますか？',
  'settings.keychain.yes': 'はい',
  'settings.keychain.no': 'いいえ',
  'settings.keychain.deleteTitle': '削除',
  'settings.keychain.userNote': 'ユーザーメモ',
  'settings.keychain.agentNote': 'エージェント読み取り可能メモ',
  'settings.keychain.userNoteHint': '人間/UI メモのみ',
  'settings.keychain.agentNoteHint': 'エージェント向けの安全なガイダンス',
  'settings.keychain.saveNotes': 'メモを保存',
  'settings.keychain.masterPassword': 'マスターパスワード：',
  'settings.keychain.masterPasswordPlaceholder': 'キーチェーンのマスターパスワードを入力',
  'settings.keychain.unlock': 'ロック解除',
  'settings.keychain.totpCode': 'TOTP コード：',
  'settings.keychain.verify': '検証',
  'settings.keychain.username': 'ユーザー名',
  'settings.keychain.copyUsername': 'ユーザー名をコピー',
  'settings.keychain.secret': 'シークレット',
  'settings.keychain.copySecret': 'シークレットをコピー',
  'settings.tasks.internalProtected': '内部/保護済み',
  'settings.tasks.noRunLogs': 'まだ実行ログが記録されていません。',
  'settings.tasks.noSummary': '概要なし',
  'settings.tasks.selectPrompt': 'タスクを選択してスケジュール、ステータス、実行履歴を確認します。',
  'settings.tasks.pause': '一時停止',
  'settings.tasks.resume': '再開',
  'settings.tasks.delete': '削除',
  'settings.tasks.status': 'ステータス',
  'settings.tasks.kind': '種類',
  'settings.tasks.schedule': 'スケジュール',
  'settings.tasks.nextRun': '次回実行',
  'settings.tasks.lastRun': '前回実行',
  'settings.tasks.lastResult': '前回の結果',
  'settings.tasks.chat': 'チャット',
  'settings.tasks.model': 'モデル',
  'settings.tasks.cwd': '作業ディレクトリ',
  'settings.tasks.timeout': 'タイムアウト',
  'settings.tasks.protection': '保護',
  'settings.tasks.protectionHint': '内部タスクの操作には明示的な確認が必要です。',
  'settings.tasks.command': 'コマンド',
  'settings.tasks.prompt': 'プロンプト',
  'settings.tasks.recentRuns': '最近の実行',
  'settings.tasks.activeLabel': 'アクティブ',
  'settings.tasks.pausedLabel': '一時停止',
  'settings.tasks.completedLabel': '完了',
  'settings.tasks.allStatuses': 'すべてのステータス',
  'settings.tasks.filterChatPlaceholder': 'チャット JID をフィルター…',
  'settings.tasks.refresh': '更新',
  'settings.tasks.loading': 'スケジュールタスクを読み込み中…',
  'settings.tasks.noneFound': 'スケジュールされたタスクが見つかりません。',
  'settings.tasks.noneFoundHint': 'リマインダー、`/tasks`、またはスケジューラツールで作成されたタスクがここに表示されます。',
  'settings.tasks.listLabel': 'スケジュールされたタスク',
  'settings.tasks.next': '次回',
  'settings.tasks.last': '前回',
  'settings.tasks.noMatch': '「{filter}」に一致するタスクはありません。',
  'settings.tasks.confirmDelete': 'スケジュールタスク {id} を削除しますか？',
  'settings.tasks.confirmPause': 'スケジュールタスク {id} を一時停止しますか？',
  'settings.tasks.confirmResume': 'スケジュールタスク {id} を再開しますか？',
  'settings.tasks.confirmProtected': 'タスク {id} は内部/保護済みです。{action} を続行しますか？',
  'settings.tasks.deleting': '{id} を削除中…',
  'settings.tasks.pausing': '{id} を一時停止中…',
  'settings.tasks.resuming': '{id} を再開中…',
  'settings.tasks.deletedToast': 'スケジュールタスク {id} を削除しました。',
  'settings.tasks.pausedToast': 'スケジュールタスク {id} を一時停止しました。',
  'settings.tasks.resumedToast': 'スケジュールタスク {id} を再開しました。',
  'settings.tasks.actionFailed': '{action} タスクに失敗しました。',
  'settings.tasks.loadFailed': 'スケジュールタスクの読み込みに失敗しました。',
  'settings.compaction.appliedNotice': '圧縮設定が適用されました。既存のターンは現在のタイマーを保持し、新しいターンは更新された値を使用します。',
  'settings.compaction.saving': '圧縮設定を保存中…',
  'settings.compaction.saveFailed': '圧縮設定の保存に失敗しました。',
  'settings.compaction.saved': '圧縮設定を保存しました。',
  'settings.compaction.clearing': '{chat} の圧縮抑制をクリア中…',
  'settings.compaction.clearFailed': '圧縮抑制のクリアに失敗しました。',
  'settings.compaction.cleared': '{chat} の圧縮抑制をクリアしました。',
  'settings.compaction.autoHeading': '自動圧縮',
  'settings.compaction.enableAutomatic': '自動圧縮を有効化',
  'settings.compaction.enableAutomaticHint': 'Piclaw が管理するプロンプト前/アイドル時の圧縮です。上流エージェントの自動圧縮は内部的に抑制されたままです。',
  'settings.compaction.processingMethod': '処理方式',
  'settings.compaction.model': '圧縮モデル',
  'settings.compaction.modelHint': 'ローカルスマート圧縮専用の厳密なモデルです。設定済みで利用できない場合は、フォールバックせずセッションを保持して停止します。',
  'settings.compaction.modelPlaceholder': 'provider/model（空欄は現在のモデル）',
  'settings.compaction.methodSelective': '選択型',
  'settings.compaction.methodSelectiveHint': '重要な継続情報を抽出し、制限付きプロンプトですべての破棄対象イベントを表現できない場合は完全な段階的カバレッジを使用します。',
  'settings.compaction.methodPipelined': 'パイプライン',
  'settings.compaction.methodPipelinedHint': '要約前に、破棄対象の各ソースイベントを正規化・分類し、監査可能なカバレッジ台帳を作成します。',
  'settings.compaction.remoteNative': 'プロバイダー・ネイティブ圧縮',
  'settings.compaction.remoteNativeHint': '明示的に対応しているプロバイダー（{providers}）のみオプトインできます。失敗時は選択したローカル方式へアトミックにフォールバックします。',
  'settings.compaction.remoteTimeout': 'プロバイダー・ネイティブのタイムアウト（秒）',
  'settings.compaction.remoteTimeoutAria': 'プロバイダー・ネイティブ圧縮のタイムアウト',
  'settings.compaction.remoteTimeoutHint': 'ローカル方式へフォールバックする前のリモート処理期限です。',
  'settings.compaction.enableToolResult': 'ツール結果の圧縮を有効化',
  'settings.compaction.enableToolResultHint': '無効にすると、大きなツール結果はインラインのまま残り、検索可能なツール出力ハンドルに外部化されません。',
  'settings.compaction.semanticSummaries': '圧縮されたツール結果のセマンティック要約',
  'settings.compaction.semanticSummariesHint': '有効にすると、圧縮された出力にアクティブモデルで生成されたセマンティック要約が含まれます（失敗時はプレビューにフォールバック）。',
  'settings.compaction.inputLimit': 'セマンティック要約の入力上限（文字）',
  'settings.compaction.inputLimitAria': 'セマンティック要約の入力上限',
  'settings.compaction.inputLimitHint': 'セマンティック要約のために完全なツール出力からサンプリングする最大文字数。',
  'settings.compaction.maxTokens': 'セマンティック要約の出力最大トークン数',
  'settings.compaction.maxTokensAria': 'セマンティック要約の最大トークン数',
  'settings.compaction.maxTokensHint': '生成される要約の長さの上限。',
  'settings.compaction.summaryTimeout': 'セマンティック要約のタイムアウト（秒）',
  'settings.compaction.summaryTimeoutAria': 'セマンティック要約のタイムアウト',
  'settings.compaction.summaryTimeoutHint': 'このタイムアウト後にセマンティック要約の生成を中止し、プレビュー圧縮にフォールバックします。',
  'settings.compaction.threshold': '圧縮しきい値（%）',
  'settings.compaction.thresholdAria': '圧縮しきい値',
  'settings.compaction.thresholdHint': 'コンテキストがウィンドウのこの％を超えたら自動圧縮',
  'settings.compaction.timeout': '圧縮タイムアウト（秒）',
  'settings.compaction.timeoutAria': '圧縮タイムアウト',
  'settings.compaction.timeoutHint': 'スタックした事前プロンプト/手動圧縮を中止し、永久にハングしないようにします。',
  'settings.compaction.backoffBase': '失敗バックオフ基準（分）',
  'settings.compaction.backoffBaseAria': '圧縮バックオフ基準',
  'settings.compaction.backoffBaseHint': '圧縮失敗後の最初の抑制ウィンドウ。',
  'settings.compaction.backoffMax': '失敗バックオフ最大（分）',
  'settings.compaction.backoffMaxAria': '圧縮バックオフ最大',
  'settings.compaction.backoffMaxHint': '繰り返し失敗した後の指数的抑制の上限。',
  'settings.compaction.decayFactor': 'バックオフ減衰係数',
  'settings.compaction.decayFactorAria': 'バックオフ減衰係数',
  'settings.compaction.decayFactorHint': '% — 圧縮が成功するたびにバックオフを半減',
  'settings.compaction.watchdogHeading': 'ストール監視',
  'settings.compaction.enableWatchdog': '監視を有効化',
  'settings.compaction.enableWatchdogHint': 'デフォルトで無効。有効にすると、アクティブフェーズがハートビートを停止した場合、ヘルパープロセスがランタイムを終了します。',
  'settings.compaction.watchdogTimeout': '監視タイムアウト（秒）',
  'settings.compaction.watchdogTimeoutAria': '監視タイムアウト',
  'settings.compaction.watchdogTimeoutHint': '監視がランタイムを強制終了するまでに、アクティブフェーズがハートビートなしで継続できる時間。',
  'settings.compaction.suppressionsHeading': 'アクティブな圧縮抑制',
  'settings.compaction.noBackoff': '現在、圧縮バックオフ中のチャットはありません。',
  'settings.compaction.clear': 'クリア',
  'settings.compaction.phasesHeading': 'ライブ監視フェーズ',
  'settings.compaction.noPhases': '現在、追跡中のアクティブなフェーズはありません。',
  'menu.title': 'メニュー',
  'menu.showWorkspace': 'ワークスペースを表示',
  'menu.hideWorkspace': 'ワークスペースを非表示',
  'menu.openExplorer': 'エクスプローラーを開く',
  'menu.chatOnly': 'チャットのみモード',
  'menu.exitChatOnly': 'チャットのみモードを終了',
  'menu.openTerminal': 'ターミナルをタブで開く',
  'menu.openVnc': 'VNC をタブで開く',
  'menu.newFile': '新規ファイル',
  'menu.openRecent': '最近のファイルを開く',
  'menu.refreshTree': 'ツリーを更新',
  'menu.reindex': 'ワークスペースを再インデックス',
  'menu.showHidden': '隠しファイルを表示',
  'menu.hideHidden': '隠しファイルを非表示',
  'menu.scale': '拡大縮小',
  'menu.settings': '設定',
};

const TRANSLATIONS: Record<Locale, Partial<Record<MessageKey, string>>> = {
  en: EN,
  'zh-CN': ZH_CN,
  ja: JA,
};

let currentLocale: Locale = DEFAULT_LOCALE;
let initialized = false;

/** Normalize an arbitrary locale-ish string into a supported `Locale`. */
export function normalizeLocale(value: unknown): Locale {
  const raw = String(value ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!raw) return DEFAULT_LOCALE;
  if (raw === 'zh-cn' || raw === 'zh' || raw === 'zh-hans' || raw.startsWith('zh-hans')) {
    return 'zh-CN';
  }
  if (raw === 'ja' || raw.startsWith('ja-')) return 'ja';
  if (raw === 'en' || raw.startsWith('en-')) return 'en';
  return DEFAULT_LOCALE;
}

/** Best-effort browser-language hint, used only when no locale is stored. */
function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;
  const candidates = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
  ].filter((c): c is string => typeof c === 'string' && c.length > 0);
  for (const candidate of candidates) {
    const normalized = normalizeLocale(candidate);
    if (normalized !== DEFAULT_LOCALE) return normalized;
  }
  return DEFAULT_LOCALE;
}

/** Resolve the initial locale: stored explicit override wins over browser hint. */
export function resolveInitialLocale(): Locale {
  const stored = getLocalStorageItem(LOCALE_STORAGE_KEY);
  if (stored) return normalizeLocale(stored);
  return detectBrowserLocale();
}

function emitLocaleChange(locale: Locale) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT, { detail: { locale } }));
}

/** Current active locale. Initializes from storage/browser on first read. */
export function getLocale(): Locale {
  if (!initialized) initLocale();
  return currentLocale;
}

/**
 * Initialize locale state from storage/browser hint. Idempotent; safe to call
 * from app bootstrap. Returns the resolved locale.
 */
export function initLocale(): Locale {
  currentLocale = resolveInitialLocale();
  initialized = true;
  return currentLocale;
}

/** Set the active locale explicitly and persist it. No-op if unchanged. */
export function setLocale(value: unknown, options: { persist?: boolean } = {}): Locale {
  const next = normalizeLocale(value);
  initialized = true;
  if (next === currentLocale && options.persist === false) return currentLocale;
  currentLocale = next;
  if (options.persist !== false) setLocalStorageItem(LOCALE_STORAGE_KEY, next);
  emitLocaleChange(next);
  return currentLocale;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const replacement = vars[name];
    return replacement === undefined || replacement === null ? match : String(replacement);
  });
}

/**
 * Translate a key for a locale (defaults to the active locale).
 * Falls back to English, then to the key itself, so missing keys never break.
 */
export function translate(
  key: MessageKey,
  vars?: Record<string, string | number>,
  locale: Locale = getLocale(),
): string {
  const fromLocale = TRANSLATIONS[locale]?.[key];
  const template = fromLocale ?? EN[key] ?? key;
  return interpolate(template, vars);
}

/** Convenience alias for the active-locale translation path. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  return translate(key, vars);
}

/**
 * Preact hook: subscribe to locale changes.
 * Returns the current locale and a setter that persists + broadcasts.
 */
export function useLocale(): [Locale, (value: unknown) => void] {
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const next = normalizeLocale(detail?.locale ?? getLocale());
      setLocaleState(next);
    };
    window.addEventListener(LOCALE_CHANGE_EVENT, handler);
    // Re-sync in case locale changed between initial render and effect.
    setLocaleState(getLocale());
    return () => window.removeEventListener(LOCALE_CHANGE_EVENT, handler);
  }, []);
  return [locale, (value: unknown) => setLocale(value)];
}

/**
 * Preact hook: locale-aware translation bound to the active locale.
 * Re-renders the consuming component when the locale changes.
 */
export function useTranslation(): {
  locale: Locale;
  setLocale: (value: unknown) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
} {
  const [locale, setLocaleValue] = useLocale();
  return {
    locale,
    setLocale: setLocaleValue,
    t: (key: MessageKey, vars?: Record<string, string | number>) => translate(key, vars, locale),
  };
}

export type { MessageKey };
