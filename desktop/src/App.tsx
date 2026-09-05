import { useState, useEffect, useCallback, lazy, Suspense, type ReactNode } from 'react';
import { FileText, Loader2, MessageSquareWarning } from 'lucide-react';
import { AppDialogsHost } from './components/AppDialogsHost';
import { Layout } from './components/Layout';
import { FeedbackReportDialog } from './components/FeedbackReportDialog';
import { NotificationsHost } from './notifications/NotificationsHost';
import { useI18n } from './i18n';
import { AppSubjectsModal } from './features/app-shell/AppSubjectsModal';
import { useExecutionPersistence } from './features/app-shell/useExecutionPersistence';
import { useFeedbackReportDialog } from './features/app-shell/useFeedbackReportDialog';
import { useGenerationShellNavigation } from './features/app-shell/useGenerationShellNavigation';
import { useGlobalIntentRouter } from './features/app-shell/useGlobalIntentRouter';
import { useGardenFlowShellNavigation } from './features/app-shell/useGardenFlowShellNavigation';
import { useSettingsShellNavigation } from './features/app-shell/useSettingsShellNavigation';
import { useSubjectsModal } from './features/app-shell/useSubjectsModal';
import { shouldRenderView, useViewNavigation } from './features/app-shell/useViewNavigation';
import type { GenerationAssetPickerRequest, GenerationIntent, ImmersiveMode } from './features/app-shell/types';
import { ClipboardCapturePrompt } from './features/capture/ClipboardCapturePrompt';

export type { FlowHandoff, FlowStage, GenerationIntent, ImmersiveMode, PendingChatMessage, TeamSection, ViewType } from './features/app-shell/types';

const HomePage = lazy(async () => ({ default: (await import('./pages/Home')).Home }));
const SkillsPage = lazy(async () => ({ default: (await import('./pages/Skills')).Skills }));
const KnowledgePage = lazy(async () => ({ default: (await import('./pages/Knowledge')).Knowledge }));
const SettingsPage = lazy(async () => ({ default: (await import('./pages/Settings')).Settings }));
const ManuscriptEditorHost = lazy(async () => ({ default: (await import('./components/manuscripts/ManuscriptEditorHost')).ManuscriptEditorHost }));
const ArchivesPage = lazy(async () => ({ default: (await import('./pages/Archives')).Archives }));
const WanderPage = lazy(async () => ({ default: (await import('./pages/Wander')).Wander }));
const GardenFlowPage = lazy(async () => ({ default: (await import('./pages/GardenFlow')).GardenFlow }));
const MediaLibraryPage = lazy(async () => ({ default: (await import('./pages/MediaLibrary')).MediaLibrary }));
const CoverStudioPage = lazy(async () => ({ default: (await import('./pages/CoverStudio')).CoverStudio }));
const GenerationStudioPage = lazy(async () => ({ default: (await import('./pages/GenerationStudio')).GenerationStudio }));
const SubjectsPage = lazy(async () => ({ default: (await import('./pages/Subjects')).Subjects }));
const AutomationPage = lazy(async () => ({ default: (await import('./pages/Automation')).Automation }));
const ApprovalPage = lazy(async () => ({ default: (await import('./pages/Approval')).Approval }));

function ViewLoadingFallback() {
  const { t } = useI18n();
  return (
    <div className="h-full min-h-0 flex items-center justify-center text-text-tertiary">
      <Loader2 className="w-4 h-4 animate-spin mr-2" />
      {t('app.loadingPage')}
    </div>
  );
}

function AuthenticatedApp() {
  const {
    currentView,
    setCurrentView,
    immersiveMode,
    setImmersiveMode,
    activeManuscriptEditorFile,
    setActiveManuscriptEditorFile,
    mountedViews,
    persistentViews,
    navigateToView,
    setViewPersistent,
    returnFromSettings,
  } = useViewNavigation();
  const [gardenFlowGlobalSidebarContent, setGardenFlowGlobalSidebarContent] = useState<ReactNode>(null);
  const [gardenFlowTitleBarActions, setGardenFlowTitleBarActions] = useState<ReactNode>(null);
  const [wanderTitleBarContent, setWanderTitleBarContent] = useState<ReactNode>(null);
  const [knowledgeTitleBarContent, setKnowledgeTitleBarContent] = useState<ReactNode>(null);
  const [approvalTargetDocketId, setApprovalTargetDocketId] = useState('');
  const [generationAssetPicker, setGenerationAssetPicker] = useState<GenerationAssetPickerRequest | null>(null);

  const {
    subjectsModalOpen,
    openSubjectsModal,
    closeSubjectsModal,
  } = useSubjectsModal();
  const closeAssetsModal = useCallback(() => {
    setGenerationAssetPicker(null);
    closeSubjectsModal();
  }, [closeSubjectsModal]);
  const openGenerationAssetPicker = useCallback((request?: GenerationAssetPickerRequest) => {
    setGenerationAssetPicker(request || null);
    openSubjectsModal();
  }, [openSubjectsModal]);
  useEffect(() => {
    if (!subjectsModalOpen) setGenerationAssetPicker(null);
  }, [subjectsModalOpen]);

  const {
    feedbackReportOpen,
    feedbackReportContext,
    openFeedbackReport,
    closeFeedbackReport,
    notifyFeedbackReportSubmitted,
  } = useFeedbackReportDialog(currentView);

  const {
    settingsNavigationTarget,
    setSettingsNavigationTarget,
  } = useSettingsShellNavigation();

  const {
    gardenflowOnboardingVersion,
    pendingGardenFlowMessage,
    gardenFlowNavigationAction,
    setGardenFlowNavigationAction,
    navigateToGardenFlow,
    openGardenFlowOnboarding,
    clearPendingGardenFlowMessage,
    clearGardenFlowNavigationAction,
    navigateToManuscript,
    closeManuscriptEditor,
    openGardenFlowChatSurface,
    openGardenFlowSession,
  } = useGardenFlowShellNavigation({
    currentView,
    setCurrentView,
    setActiveManuscriptEditorFile,
    setImmersiveMode,
  });

  const {
    pendingGenerationIntent,
    setPendingGenerationIntent,
    navigateToGenerationStudio,
    clearPendingGenerationIntent,
    returnToFreeCreation,
  } = useGenerationShellNavigation({ setCurrentView });

  useGlobalIntentRouter({
    navigateToView,
    setCurrentView,
    setActiveManuscriptEditorFile,
    setSettingsNavigationTarget,
    setGardenFlowNavigationAction,
    setApprovalTargetDocketId,
    setPendingGenerationIntent,
    navigateToGardenFlow,
  });

  const {
    handleWanderExecutionStateChange,
    handleGardenFlowExecutionStateChange,
    handleGenerationStudioExecutionStateChange,
    handleCoverStudioExecutionStateChange,
  } = useExecutionPersistence(setViewPersistent);

  const isManuscriptEditorActive = currentView === 'gardenflow' && Boolean(activeManuscriptEditorFile);
  const effectiveImmersiveMode: ImmersiveMode = isManuscriptEditorActive ? false : immersiveMode;

  return (
    <>
      <Layout
        currentView={currentView}
        onNavigate={navigateToView}
        immersiveMode={effectiveImmersiveMode}
        hideGlobalSidebar={currentView === 'settings'}
        globalSidebarContent={gardenFlowGlobalSidebarContent}
        activeModalView={subjectsModalOpen ? 'subjects' : undefined}
        renderTitleBarContent={({ currentView }) => {
          if (isManuscriptEditorActive) {
            return (
              <div className="inline-flex min-w-0 items-center gap-2 text-[12px] font-semibold text-text-secondary">
                <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                <span className="truncate">稿件编辑器</span>
              </div>
            );
          }
          if (currentView === 'wander') return wanderTitleBarContent;
          if (currentView === 'knowledge') return knowledgeTitleBarContent;
          return null;
        }}
        renderTitleBarActions={({ currentView }) => (
          <>
            {currentView === 'gardenflow' && !isManuscriptEditorActive ? gardenFlowTitleBarActions : null}
            <button
              type="button"
              onClick={() => openFeedbackReport({ sourcePage: currentView })}
              className="app-titlebar-button"
              title="反馈问题"
              aria-label="反馈问题"
            >
              <MessageSquareWarning className="w-[13px] h-[13px]" strokeWidth={1.75} />
            </button>
          </>
        )}
      >
        {shouldRenderView(mountedViews, currentView, persistentViews, 'home') && (
          <div className={currentView === 'home' ? 'h-full min-h-0 flex flex-col' : 'hidden'}>
            <Suspense fallback={currentView === 'home' ? <ViewLoadingFallback /> : null}>
              <HomePage
                isActive={currentView === 'home'}
                onNavigateToGenerationStudio={(mode) => navigateToGenerationStudio({
                  mode,
                  source: 'standalone',
                })}
                onOpenManuscript={navigateToManuscript}
              />
            </Suspense>
          </div>
        )}
        {isManuscriptEditorActive && activeManuscriptEditorFile && (
          <div className="h-full min-h-0 flex flex-col overflow-hidden">
            <Suspense fallback={<ViewLoadingFallback />}>
              <ManuscriptEditorHost
                filePath={activeManuscriptEditorFile}
                onNavigateToGardenFlow={navigateToGardenFlow}
                onNavigateToGenerationStudio={navigateToGenerationStudio}
                isActive={true}
                onClose={closeManuscriptEditor}
                onImmersiveModeChange={setImmersiveMode}
              />
            </Suspense>
          </div>
        )}
        {shouldRenderView(mountedViews, currentView, persistentViews, 'skills') && (
          <div className={currentView === 'skills' ? 'h-full min-h-0 flex flex-col' : 'hidden'}>
            <Suspense fallback={currentView === 'skills' ? <ViewLoadingFallback /> : null}>
              <SkillsPage isActive={currentView === 'skills'} />
            </Suspense>
          </div>
        )}
        {shouldRenderView(mountedViews, currentView, persistentViews, 'knowledge') && (
          <div className={currentView === 'knowledge' ? 'h-full min-h-0 flex flex-col' : 'hidden'}>
            <Suspense fallback={currentView === 'knowledge' ? <ViewLoadingFallback /> : null}>
              <KnowledgePage
                onNavigateToGardenFlow={navigateToGardenFlow}
                isActive={currentView === 'knowledge'}
                onTitleBarContentChange={setKnowledgeTitleBarContent}
              />
            </Suspense>
          </div>
        )}
        {shouldRenderView(mountedViews, currentView, persistentViews, 'settings') && (
          <div className={currentView === 'settings' ? 'h-full min-h-0 flex flex-col' : 'hidden'}>
            <Suspense fallback={currentView === 'settings' ? <ViewLoadingFallback /> : null}>
              <SettingsPage
                isActive={currentView === 'settings'}
                onOpenGardenFlowOnboarding={openGardenFlowOnboarding}
                gardenflowOnboardingVersion={gardenflowOnboardingVersion}
                navigationTarget={settingsNavigationTarget}
                onReturn={returnFromSettings}
              />
            </Suspense>
          </div>
        )}
        {shouldRenderView(mountedViews, currentView, persistentViews, 'archives') && (
          <div className={currentView === 'archives' ? 'h-full min-h-0 flex flex-col' : 'hidden'}>
            <Suspense fallback={currentView === 'archives' ? <ViewLoadingFallback /> : null}>
              <ArchivesPage isActive={currentView === 'archives'} />
            </Suspense>
          </div>
        )}
        {shouldRenderView(mountedViews, currentView, persistentViews, 'wander') && (
          <div className={currentView === 'wander' ? 'h-full min-h-0 flex flex-col' : 'hidden'}>
            <Suspense fallback={currentView === 'wander' ? <ViewLoadingFallback /> : null}>
              <WanderPage
                onNavigateToGardenFlow={navigateToGardenFlow}
                onExecutionStateChange={handleWanderExecutionStateChange}
                onTitleBarContentChange={setWanderTitleBarContent}
                isActive={currentView === 'wander'}
              />
            </Suspense>
          </div>
        )}
        {(currentView !== 'gardenflow' || shouldRenderView(mountedViews, currentView, persistentViews, 'gardenflow')) && (
          <div className={currentView === 'gardenflow' && !isManuscriptEditorActive ? 'h-full min-h-0 flex flex-col' : 'hidden'}>
            <Suspense fallback={currentView === 'gardenflow' ? <ViewLoadingFallback /> : null}>
              <GardenFlowPage
                pendingMessage={pendingGardenFlowMessage}
                onPendingMessageConsumed={clearPendingGardenFlowMessage}
                navigationAction={gardenFlowNavigationAction}
                onNavigationActionConsumed={clearGardenFlowNavigationAction}
                isActive={currentView === 'gardenflow' || persistentViews.has('gardenflow')}
                onExecutionStateChange={handleGardenFlowExecutionStateChange}
                onOpenGardenFlowOnboarding={openGardenFlowOnboarding}
                gardenflowOnboardingVersion={gardenflowOnboardingVersion}
                onGlobalSidebarContentChange={setGardenFlowGlobalSidebarContent}
                onTitleBarActionsChange={setGardenFlowTitleBarActions}
                onOpenChatSurface={openGardenFlowChatSurface}
                onOpenManuscriptEditor={navigateToManuscript}
                activeManuscriptPath={activeManuscriptEditorFile}
                titleBarActive={currentView === 'gardenflow' && !isManuscriptEditorActive}
              />
            </Suspense>
          </div>
        )}
        {shouldRenderView(mountedViews, currentView, persistentViews, 'media-library') && (
          <div className={currentView === 'media-library' ? 'min-h-full bg-background flex flex-col' : 'hidden'}>
            <Suspense fallback={currentView === 'media-library' ? <ViewLoadingFallback /> : null}>
              <MediaLibraryPage
                isActive={currentView === 'media-library'}
                onNavigateToGenerationStudio={navigateToGenerationStudio}
              />
            </Suspense>
          </div>
        )}
        {shouldRenderView(mountedViews, currentView, persistentViews, 'subjects') && (
          <div className={currentView === 'subjects' ? 'h-full min-h-0 flex flex-col' : 'hidden'}>
            <Suspense fallback={currentView === 'subjects' ? <ViewLoadingFallback /> : null}>
              <SubjectsPage
                isActive={currentView === 'subjects'}
                variant="page"
              />
            </Suspense>
          </div>
        )}
        {shouldRenderView(mountedViews, currentView, persistentViews, 'cover-studio') && (
          <div className={currentView === 'cover-studio' ? 'h-full min-h-0 flex flex-col' : 'hidden'}>
            <Suspense fallback={currentView === 'cover-studio' ? <ViewLoadingFallback /> : null}>
              <CoverStudioPage
                isActive={currentView === 'cover-studio' || persistentViews.has('cover-studio')}
                onExecutionStateChange={handleCoverStudioExecutionStateChange}
                onReturnHome={returnToFreeCreation}
              />
            </Suspense>
          </div>
        )}
        {shouldRenderView(mountedViews, currentView, persistentViews, 'generation-studio') && (
          <div className={currentView === 'generation-studio' ? 'h-full min-h-0 flex flex-col' : 'hidden'}>
            <Suspense fallback={currentView === 'generation-studio' ? <ViewLoadingFallback /> : null}>
              <GenerationStudioPage
                isActive={currentView === 'generation-studio' || persistentViews.has('generation-studio')}
                pendingIntent={pendingGenerationIntent}
                onIntentConsumed={clearPendingGenerationIntent}
                onExecutionStateChange={handleGenerationStudioExecutionStateChange}
                onOpenAssets={openGenerationAssetPicker}
              />
            </Suspense>
          </div>
        )}
        {shouldRenderView(mountedViews, currentView, persistentViews, 'automation') && (
          <div className={currentView === 'automation' ? 'h-full min-h-0 flex flex-col' : 'hidden'}>
            <Suspense fallback={currentView === 'automation' ? <ViewLoadingFallback /> : null}>
              <AutomationPage
                isActive={currentView === 'automation'}
                onOpenGardenFlowSession={openGardenFlowSession}
              />
            </Suspense>
          </div>
        )}
        {shouldRenderView(mountedViews, currentView, persistentViews, 'approval') && (
          <div className={currentView === 'approval' ? 'h-full min-h-0 flex flex-col' : 'hidden'}>
            <Suspense fallback={currentView === 'approval' ? <ViewLoadingFallback /> : null}>
              <ApprovalPage
                isActive={currentView === 'approval'}
                targetDocketId={approvalTargetDocketId}
              />
            </Suspense>
          </div>
        )}
      </Layout>
      <ClipboardCapturePrompt />
      {subjectsModalOpen && (
        <AppSubjectsModal close={closeAssetsModal}>
          <Suspense fallback={<ViewLoadingFallback />}>
            <SubjectsPage
              isActive={subjectsModalOpen}
              variant="modal"
              onClose={closeAssetsModal}
              referencePicker={generationAssetPicker ? {
                mediaKind: generationAssetPicker.mediaKind,
                maxCount: generationAssetPicker.maxCount,
                allowedExtensions: generationAssetPicker.allowedExtensions,
                onSelect: (references) => {
                  generationAssetPicker.onSelect(references);
                  closeAssetsModal();
                },
              } : undefined}
            />
          </Suspense>
        </AppSubjectsModal>
      )}
      <FeedbackReportDialog
        open={feedbackReportOpen}
        context={feedbackReportContext}
        onClose={closeFeedbackReport}
        onSubmitted={notifyFeedbackReportSubmitted}
      />
      <NotificationsHost currentView={currentView} />
      <AppDialogsHost />
    </>
  );
}

function App() {
  return <AuthenticatedApp />;
}

export default App;
