import { flushCreationBeforeNavigate, hasCreationFlush } from '../workbench/creationNavigation';
import { appAlert } from '../../utils/appDialogs';
import { GARDENFLOW_NAVIGATE_EVENT } from '../../notifications/types';
import type { AppIntent } from './types';

export function dispatchAppIntent(intent: AppIntent): void {
  const dispatch = () => window.dispatchEvent(new CustomEvent(GARDENFLOW_NAVIGATE_EVENT, { detail: intent }));
  if (hasCreationFlush()) void flushCreationBeforeNavigate().then(dispatch).catch(reason => { void appAlert(String(reason)); });
  else dispatch();
}
