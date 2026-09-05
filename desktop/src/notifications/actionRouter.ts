import { dispatchAppIntent } from '../features/app-shell/appIntent';
import type { NotificationAction } from './types';

export async function runNotificationAction(action: NotificationAction): Promise<void> {
  if (action.action === 'navigate') {
    if (action.payload.view === 'settings') {
      dispatchAppIntent({
        type: 'settings.open',
        tab: action.payload.settingsTab,
        aiModelSubTab: action.payload.aiModelSubTab,
      });
    } else if (action.payload.view === 'gardenflow') {
      dispatchAppIntent({ type: 'gardenflow.open' });
    } else if (action.payload.view === 'approval') {
      dispatchAppIntent({ type: 'approval.open', docketId: action.payload.docketId });
    } else {
      dispatchAppIntent({ type: 'view.open', view: action.payload.view });
    }
    return;
  }

  if (action.action === 'open-path') {
    await window.ipcRenderer.openPath(action.payload.path);
    return;
  }

  if (action.action === 'retry-generation') {
    await window.ipcRenderer.generation.retryJob(action.payload.jobId);
    dispatchAppIntent({ type: 'view.open', view: 'generation-studio' });
    return;
  }

  if (action.action === 'open-feedback-report') {
    window.dispatchEvent(new CustomEvent('gardenflow:open-feedback-report', {
      detail: {
        sourcePage: 'notifications',
        operation: action.payload.feedbackId ? `feedback:${action.payload.feedbackId}` : 'feedback',
      },
    }));
  }
}
