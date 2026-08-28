import type { UploadedFileAttachment } from '../../components/ChatComposer';

const ATTACHMENT_DRAFT_STORAGE_PREFIX = 'redbox:chat:attachment-draft:v1';

function storageKey(surface: string, scopeId: string): string {
  const normalizedSurface = String(surface || '').trim() || 'chat';
  const normalizedScopeId = String(scopeId || '').trim() || '__default__';
  return `${ATTACHMENT_DRAFT_STORAGE_PREFIX}:${normalizedSurface}:${normalizedScopeId}`;
}

function toPersistableAttachmentDraft(
  attachment: UploadedFileAttachment | null | undefined,
): UploadedFileAttachment | null {
  if (!attachment || attachment.type !== 'uploaded-file') {
    return null;
  }
  const { thumbnailDataUrl: _thumbnailDataUrl, ...persisted } = attachment;
  return persisted;
}

function toPersistableAttachmentDrafts(
  attachments: UploadedFileAttachment[] | null | undefined,
): UploadedFileAttachment[] {
  return (attachments || [])
    .map((attachment) => toPersistableAttachmentDraft(attachment))
    .filter((attachment): attachment is UploadedFileAttachment => Boolean(attachment));
}

export function loadAttachmentDrafts(
  surface: string,
  scopeId: string,
): UploadedFileAttachment[] {
  try {
    const raw = window.localStorage.getItem(storageKey(surface, scopeId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UploadedFileAttachment | UploadedFileAttachment[];
    return toPersistableAttachmentDrafts(Array.isArray(parsed) ? parsed : [parsed]);
  } catch {
    return [];
  }
}

export function loadAttachmentDraft(
  surface: string,
  scopeId: string,
): UploadedFileAttachment | null {
  return loadAttachmentDrafts(surface, scopeId)[0] || null;
}

export function saveAttachmentDrafts(
  surface: string,
  scopeId: string,
  attachments: UploadedFileAttachment[] | null | undefined,
): void {
  try {
    const key = storageKey(surface, scopeId);
    const persisted = toPersistableAttachmentDrafts(attachments);
    if (persisted.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(persisted));
  } catch {
    // Ignore storage failures and keep the in-memory draft usable.
  }
}

export function saveAttachmentDraft(
  surface: string,
  scopeId: string,
  attachment: UploadedFileAttachment | null | undefined,
): void {
  saveAttachmentDrafts(surface, scopeId, attachment ? [attachment] : []);
}

export function clearAttachmentDraft(surface: string, scopeId: string): void {
  try {
    window.localStorage.removeItem(storageKey(surface, scopeId));
  } catch {
    // Ignore storage failures and keep the in-memory draft usable.
  }
}
