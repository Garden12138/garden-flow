import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { AuthoringTaskHints } from '../../utils/gardenflowAuthoring';
import { uiTraceInteraction } from '../../utils/uiDebug';
import type { ImmersiveMode, PendingChatMessage, GardenFlowNavigationAction, ViewType } from './types';

interface UseGardenFlowShellNavigationParams {
  currentView: ViewType;
  setCurrentView: Dispatch<SetStateAction<ViewType>>;
  setActiveManuscriptEditorFile: Dispatch<SetStateAction<string | null>>;
  setImmersiveMode: Dispatch<SetStateAction<ImmersiveMode>>;
}

export function useGardenFlowShellNavigation({
  currentView,
  setCurrentView,
  setActiveManuscriptEditorFile,
  setImmersiveMode,
}: UseGardenFlowShellNavigationParams) {
  const [gardenflowOnboardingVersion, setGardenFlowOnboardingVersion] = useState(0);
  const [pendingGardenFlowMessage, setPendingGardenFlowMessage] = useState<PendingChatMessage | null>(null);
  const [gardenFlowNavigationAction, setGardenFlowNavigationAction] = useState<GardenFlowNavigationAction | null>(null);

  const navigateToGardenFlow = useCallback((message: PendingChatMessage) => {
    uiTraceInteraction('app', 'nav_to_gardenflow', { to: 'gardenflow' });
    setPendingGardenFlowMessage(message);
    setActiveManuscriptEditorFile(null);
    setImmersiveMode(false);
    setCurrentView('gardenflow');
  }, [setActiveManuscriptEditorFile, setCurrentView, setImmersiveMode]);

  const openGardenFlowOnboarding = useCallback(() => {
    void (async () => {
      try {
        await window.ipcRenderer.gardenflowProfile.startStyleDefinition({
          forceRestart: true,
          source: 'manual-redefine',
        });
        setGardenFlowOnboardingVersion((value) => value + 1);
      } catch (error) {
        console.error('Failed to start GardenFlow style definition:', error);
      }
      navigateToGardenFlow({
        content: '我想重新定义这个空间的自媒体定位和写作风格。请先让我上传账号主页截图来确认账号定位，可以让我发 1 到 3 张主页相关截图一起分析；确认后，再让我上传一篇自己的文章截图或对标账号文章截图来学习创作风格。不要直接写稿。',
        displayContent: '重新定义这个空间的风格',
        sessionRouting: 'new',
        deliveryMode: 'send',
        taskHints: {
          activeSkills: ['gardenflow-style-definition'],
          requiredSkill: 'gardenflow-style-definition',
          allowedOperateActions: [
            'gardenflow.profile.bundle',
            'gardenflow.profile.read',
            'gardenflow.profile.update',
            'gardenflow.profile.completeStyleDefinition',
          ],
          initialContext: '用户从界面入口手动请求重新定义当前 GardenFlow 空间风格。',
        } as AuthoringTaskHints,
      });
    })();
  }, [navigateToGardenFlow]);

  const clearPendingGardenFlowMessage = useCallback(() => {
    setPendingGardenFlowMessage(null);
  }, []);

  const clearGardenFlowNavigationAction = useCallback(() => {
    setGardenFlowNavigationAction(null);
  }, []);

  const navigateToManuscript = useCallback((filePath: string) => {
    uiTraceInteraction('app', 'open_manuscript_editor', { sourceView: currentView });
    setActiveManuscriptEditorFile(filePath);
    setCurrentView('gardenflow');
  }, [currentView, setActiveManuscriptEditorFile, setCurrentView]);

  const closeManuscriptEditor = useCallback(() => {
    setActiveManuscriptEditorFile(null);
    setImmersiveMode(false);
  }, [setActiveManuscriptEditorFile, setImmersiveMode]);

  const openGardenFlowChatSurface = useCallback(() => {
    setActiveManuscriptEditorFile(null);
    setImmersiveMode(false);
    setCurrentView('gardenflow');
  }, [setActiveManuscriptEditorFile, setCurrentView, setImmersiveMode]);

  const openGardenFlowSession = useCallback((sessionId: string) => {
    const nextSessionId = String(sessionId || '').trim();
    if (!nextSessionId) return;
    setActiveManuscriptEditorFile(null);
    setImmersiveMode(false);
    setGardenFlowNavigationAction({
      action: 'open-session',
      sessionId: nextSessionId,
      nonce: Date.now(),
    });
    setCurrentView('gardenflow');
  }, [setActiveManuscriptEditorFile, setCurrentView, setImmersiveMode]);

  return {
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
  };
}
