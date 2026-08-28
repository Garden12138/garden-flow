import type { Message } from '../../components/MessageItem';
import type { ProcessItem } from '../../components/ProcessTimeline';

function finishRunningTimeline(items: ProcessItem[], now: number): { items: ProcessItem[]; changed: boolean } {
  let changed = false;
  const next = items.map((item) => {
    if (item.status !== 'running') return item;
    changed = true;
    return {
      ...item,
      status: 'done' as const,
      duration: Math.max(0, now - item.timestamp),
    };
  });
  return { items: next, changed };
}

export function finalizeCancelledChatMessages(messages: Message[], now = Date.now()): Message[] {
  let next = messages;
  let changed = false;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'ai' || message.messageType === 'thinking') continue;
    const timeline = finishRunningTimeline(message.timeline || [], now);
    if (message.isStreaming || timeline.changed || message.suppressPendingIndicator) {
      next = [...next];
      next[index] = {
        ...message,
        timeline: timeline.items,
        isStreaming: false,
        suppressPendingIndicator: false,
        processingFinishedAt: now,
      };
      changed = true;
    }
    break;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'ai' || message.messageType !== 'thinking' || !message.isStreaming) continue;
    if (!changed) next = [...next];
    next[index] = {
      ...message,
      isStreaming: false,
      processingFinishedAt: now,
    };
    changed = true;
    break;
  }

  return changed ? next : messages;
}
