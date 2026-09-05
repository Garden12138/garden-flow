import { createBridgeCore } from './core';
import type { InvokeGuardOptions } from './types';
import { createAccountsBridge } from './domains/accountsBridge';
import { createAdvisorsBridge } from './domains/advisorsBridge';
import { createAiConfigBridge } from './domains/aiConfigBridge';
import { createAppBridge } from './domains/appBridge';
import { createArchivesBridge } from './domains/archivesBridge';
import { createAssistantControlBridge } from './domains/assistantControlBridge';
import { createAudioVoiceBridge } from './domains/audioVoiceBridge';
import { createCaptureBridge } from './domains/captureBridge';
import { createChatBridge } from './domains/chatBridge';
import { createCliRuntimeBridge } from './domains/cliRuntimeBridge';
import { createCoverBridge } from './domains/coverBridge';
import { createFilesBridge } from './domains/filesBridge';
import { createGenerationBridge } from './domains/generationBridge';
import { createGardenFlowBridge } from './domains/gardenflowBridge';
import { createImageHostingBridge } from './domains/imageHostingBridge';
import { createKnowledgeBridge } from './domains/knowledgeBridge';
import { createLlmReadinessBridge } from './domains/llmReadinessBridge';
import { createManuscriptsBridge } from './domains/manuscriptsBridge';
import { createMediaBridge } from './domains/mediaBridge';
import { createMcpBridge } from './domains/mcpBridge';
import { createPluginsBridge } from './domains/pluginsBridge';
import { createRuntimeBridge } from './domains/runtimeBridge';
import { createSessionsBridge } from './domains/sessionsBridge';
import { createSettingsBridge } from './domains/settingsBridge';
import { createSkillsBridge } from './domains/skillsBridge';
import { createSpacesBridge } from './domains/spacesBridge';
import { createSubjectsBridge } from './domains/subjectsBridge';
import { createSystemBridge } from './domains/systemBridge';
import { createTeamRuntimeBridge } from './domains/teamRuntimeBridge';
import { createToolsBridge } from './domains/toolsBridge';
import { createVideoEditorBridge } from './domains/videoEditorBridge';
import { createWanderBridge } from './domains/wanderBridge';
import { createWindowControlsBridge } from './domains/windowControlsBridge';
import { createXhsPublisherBridge } from './domains/xhsPublisherBridge';

function createIpcRenderer() {
  const core = createBridgeCore();
  return {
    on: core.on,
    off: core.off,
    removeAllListeners: core.removeAllListeners,
    send: (channel: string, ...args: unknown[]) => core.sendChannel(channel, args.length <= 1 ? args[0] : args),
    invoke: (channel: string, ...args: unknown[]) => core.invokeChannel(channel, args.length <= 1 ? args[0] : args),
    invokeGuarded: <T = unknown>(channel: string, payload?: unknown, options?: InvokeGuardOptions<T>) =>
      core.invokeChannelGuarded<T>(channel, payload, options),
    command: <T = unknown>(command: string, args?: unknown) => core.invokeCommand<T>(command, args),
    commandGuarded: <T = unknown>(command: string, args?: unknown, options?: InvokeGuardOptions<T> & { fallbackChannel?: string }) =>
      core.invokeCommandGuarded<T>(command, args, options),
    ...createWindowControlsBridge(core),
    ...createSpacesBridge(core),
    ...createAdvisorsBridge(core),
    ...createKnowledgeBridge(core),
    ...createChatBridge(core),
    ...createFilesBridge(core),
    ...createSettingsBridge(core),
    ...createAppBridge(core),
    ...createCaptureBridge(core),
    ...createAccountsBridge(core),
    ...createAiConfigBridge(core),
    ...createAudioVoiceBridge(core),
    ...createAssistantControlBridge(core),
    ...createCliRuntimeBridge(core),
    ...createRuntimeBridge(core),
    ...createToolsBridge(core),
    ...createSubjectsBridge(core),
    ...createArchivesBridge(core),
    ...createWanderBridge(core),
    ...createMediaBridge(core),
    ...createCoverBridge(core),
    ...createGenerationBridge(core),
    ...createImageHostingBridge(core),
    ...createMcpBridge(core),
    ...createPluginsBridge(core),
    ...createSkillsBridge(core),
    ...createLlmReadinessBridge(core),
    ...createVideoEditorBridge(core),
    ...createSessionsBridge(core),
    ...createManuscriptsBridge(core),
    ...createGardenFlowBridge(core),
    ...createXhsPublisherBridge(core),
    ...createTeamRuntimeBridge(core),
    ...createSystemBridge(core),
  };
}

export type IpcRendererBridge = ReturnType<typeof createIpcRenderer>;

declare global {
  interface Window {
    ipcRenderer: IpcRendererBridge;
  }
}

export function installIpcRendererBridge(): void {
  if (typeof window === 'undefined' || window.ipcRenderer) return;
  window.ipcRenderer = createIpcRenderer();
}
