import type {
  NotificationEnvelope,
  NotificationSettings,
  NotificationSystemPermissionSnapshot,
} from './types';

function normalizePermissionState(value: unknown): NotificationSystemPermissionSnapshot {
  const state = typeof value === 'object' && value !== null && 'state' in value
    ? String((value as { state?: unknown }).state || '').trim().toLowerCase()
    : '';
  if (state === 'granted' || state === 'denied' || state === 'prompt') {
    return { state };
  }
  return { state: 'unknown' };
}

export async function showSystemNotification(
  notification: NotificationEnvelope,
  settings: NotificationSettings,
): Promise<void> {
  if (!settings.system.enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  new Notification(notification.title, { body: notification.body });
}

export async function requestSystemNotificationPermission(): Promise<NotificationSystemPermissionSnapshot> {
  if (typeof Notification === 'undefined') return { state: 'unknown' };
  return normalizePermissionState({ state: await Notification.requestPermission() });
}

export async function getSystemNotificationPermissionState(): Promise<NotificationSystemPermissionSnapshot> {
  if (typeof Notification === 'undefined') return { state: 'unknown' };
  return normalizePermissionState({ state: Notification.permission });
}
