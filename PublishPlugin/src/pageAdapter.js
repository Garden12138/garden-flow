export const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish?source=official&from=tab_switch';

export function publishTargetForNoteType(noteType) {
  return noteType === 'image' || noteType === 'video' ? noteType : '';
}

export function buildPublishModeUrl(noteType, currentHref = PUBLISH_URL, options = {}) {
  const target = publishTargetForNoteType(noteType);
  if (!target) throw new TypeError('Unsupported Xiaohongshu note type');
  let current;
  try {
    current = new URL(currentHref);
  } catch {
    current = new URL(PUBLISH_URL);
  }
  const url = new URL('/publish/publish', new URL(PUBLISH_URL).origin);
  url.searchParams.set('source', 'official');
  if (options.published === true || (options.published !== false && current.searchParams.get('published') === 'true')) {
    url.searchParams.set('published', 'true');
  }
  url.searchParams.set('from', 'tab_switch');
  url.searchParams.set('target', target);
  return url.toString();
}

export function normalizeHashtags(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values.map((item) => String(item || '').trim().replace(/^#+/, '').replace(/\s+/g, ' '))
    .filter((item) => item && !seen.has(item) && seen.add(item));
}

export function buildBody(body, hashtags) {
  const text = String(body || '').trim();
  const existing = new Set(Array.from(text.matchAll(/#([^#\s]+)/g), (match) => match[1]));
  const suffix = normalizeHashtags(hashtags).filter((tag) => !existing.has(tag)).map((tag) => `#${tag}`);
  return suffix.length ? `${text}\n${suffix.join(' ')}` : text;
}

export function normalizeEditorText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/gi, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function verifyPreparedEditorSnapshot(snapshot, payload) {
  if (!snapshot || typeof snapshot !== 'object' || !payload || typeof payload !== 'object') {
    return { ok: false, titleMatches: false, bodyMatches: false };
  }
  const titleValue = String(snapshot.titleValue || '').trim();
  const bodyValue = normalizeEditorText(snapshot.bodyValue);
  const expectedBody = normalizeEditorText(payload.expectedBody);
  const titleMatches = titleValue === String(payload.title || '').trim();
  const bodyMatches = bodyValue === expectedBody;
  return {
    ...snapshot,
    ok: titleMatches
      && bodyMatches
      && snapshot.mediaBusy !== true,
    titleValue,
    bodyValue,
    expectedBody,
    titleMatches,
    bodyMatches,
  };
}

export function canResumeOwnedPreparingDraft(snapshot, ownershipStatus) {
  return ownershipStatus === 'preparing'
    && String(snapshot?.titleValue || '').trim() === ''
    && normalizeEditorText(snapshot?.bodyValue) === '';
}

function nodeAttributes(node) {
  const values = Array.from(node?.attributes || []);
  const attributes = {};
  for (let index = 0; index + 1 < values.length; index += 2) {
    attributes[String(values[index] || '').toLowerCase()] = String(values[index + 1] || '');
  }
  return attributes;
}

export function findFileInputsInFlattenedDom(nodes, kind) {
  if (kind !== 'image' && kind !== 'video') return [];
  return flattenPiercedDomNodes(nodes).flatMap((node) => {
    if (String(node?.nodeName || '').toUpperCase() !== 'INPUT') return [];
    const attributes = nodeAttributes(node);
    if (String(attributes.type || '').toLowerCase() !== 'file') return [];
    const accept = String(attributes.accept || '').toLowerCase();
    const matches = kind === 'video'
      ? accept.includes('video') || /\.(mp4|mov|m4v|webm)/.test(accept)
      : accept.includes('image') || /\.(png|jpe?g|webp)/.test(accept);
    const backendDOMNodeId = Number(node.backendNodeId);
    return matches && Number.isInteger(backendDOMNodeId)
      ? [{ backendDOMNodeId, accept }]
      : [];
  });
}

export function choosePublishTargetCandidate(candidates) {
  if (!Array.isArray(candidates)) {
    return { ok: false, code: 'PUBLISH_BUTTON_NOT_FOUND', message: '未找到发布按钮' };
  }
  const ranked = candidates
    .filter((item) => item
      && typeof item === 'object'
      && Number.isFinite(Number(item.x))
      && Number.isFinite(Number(item.y))
      && Number(item.width) > 0
      && Number(item.height) > 0)
    .map((item) => {
      const tagName = String(item.tagName || '').toUpperCase();
      const nativeControl = tagName === 'BUTTON' || (tagName === 'INPUT' && ['button', 'submit'].includes(String(item.inputType || '').toLowerCase()));
      const score = (item.disabled ? -100 : 0)
        + (nativeControl ? 8 : 0)
        + (String(item.role || '').toLowerCase() === 'button' ? 6 : 0)
        + (item.interactive ? 4 : 0)
        + (item.nearDraftControl ? 5 : 0)
        + (item.bottomHalf ? 3 : 0)
        + (item.hitTestable ? 2 : 0);
      return { ...item, score };
    })
    .sort((left, right) => right.score - left.score);
  if (ranked.length === 0) {
    return { ok: false, code: 'PUBLISH_BUTTON_NOT_FOUND', message: '未找到发布按钮' };
  }
  const enabled = ranked.filter((item) => item.disabled !== true);
  if (enabled.length === 0) {
    return { ok: false, code: 'PUBLISH_BUTTON_DISABLED', message: '发布按钮暂不可用，请检查页面校验提示' };
  }
  const best = enabled[0];
  const equallyRanked = enabled.filter((item) => item.score === best.score);
  if (equallyRanked.length > 1) {
    return { ok: false, code: 'PUBLISH_BUTTON_AMBIGUOUS', message: '页面存在多个无法区分的发布按钮，未继续点击' };
  }
  return {
    ok: true,
    x: Number(best.x),
    y: Number(best.y),
    score: best.score,
    candidateCount: ranked.length,
  };
}

function normalizedAccessibilityValue(value) {
  return String(value?.value ?? value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function publishCandidateFromBox(backendDOMNodeId, model, viewportHeight, details) {
  const box = model?.model && typeof model.model === 'object' ? model.model : model;
  const quad = Array.isArray(box?.content) && box.content.length >= 8
    ? box.content
    : box?.border;
  if (!Array.isArray(quad) || quad.length < 8) return null;
  const xs = [Number(quad[0]), Number(quad[2]), Number(quad[4]), Number(quad[6])];
  const ys = [Number(quad[1]), Number(quad[3]), Number(quad[5]), Number(quad[7])];
  if (xs.some((value) => !Number.isFinite(value)) || ys.some((value) => !Number.isFinite(value))) return null;
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  if (right <= left || bottom <= top) return null;
  const x = left + (right - left) / 2;
  const y = top + (bottom - top) / 2;
  return {
    x,
    y,
    width: right - left,
    height: bottom - top,
    tagName: details.tagName || '',
    inputType: details.inputType || '',
    role: details.role || '',
    interactive: true,
    nearDraftControl: false,
    bottomHalf: Number(viewportHeight) > 0 && y >= Number(viewportHeight) / 2,
    hitTestable: true,
    disabled: details.disabled === true,
    backendDOMNodeId,
  };
}

export function publishCandidatesFromAxTree(nodes, boxModels, viewportHeight = 0) {
  if (!Array.isArray(nodes) || !boxModels || typeof boxModels !== 'object') return [];
  const seen = new Set();
  const candidates = [];
  for (const node of nodes) {
    const backendDOMNodeId = Number(node?.backendDOMNodeId);
    const name = normalizedAccessibilityValue(node?.name);
    const role = normalizedAccessibilityValue(node?.role).toLowerCase();
    if (node?.ignored === true
      || name !== '发布'
      || role !== 'button'
      || !Number.isInteger(backendDOMNodeId)
      || seen.has(backendDOMNodeId)) {
      continue;
    }
    const model = boxModels[backendDOMNodeId] || boxModels[String(backendDOMNodeId)];
    const properties = new Map((Array.isArray(node?.properties) ? node.properties : [])
      .map((item) => [String(item?.name || ''), item?.value?.value]));
    const candidate = publishCandidateFromBox(backendDOMNodeId, model, viewportHeight, {
      role,
      disabled: properties.get('disabled') === true,
    });
    if (!candidate) continue;
    seen.add(backendDOMNodeId);
    candidates.push(candidate);
  }
  return candidates;
}

function flattenPiercedDomNodes(nodes) {
  const flattened = new Map();
  const visit = (node, parentId) => {
    if (!node || typeof node !== 'object') return;
    const normalized = parentId != null && node.parentId == null ? { ...node, parentId } : node;
    if (Number.isInteger(Number(normalized.nodeId))) flattened.set(Number(normalized.nodeId), normalized);
    const nextParent = Number(normalized.nodeId);
    for (const child of Array.from(normalized.children || [])) visit(child, nextParent);
    for (const shadowRoot of Array.from(normalized.shadowRoots || [])) visit(shadowRoot, nextParent);
  };
  for (const node of Array.from(nodes || [])) visit(node, null);
  return Array.from(flattened.values());
}

export function findPublishButtonsInFlattenedDom(nodes) {
  const flattened = flattenPiercedDomNodes(nodes);
  const byId = new Map(flattened.map((node) => [Number(node.nodeId), node]));
  const childIds = new Map();
  for (const node of flattened) {
    const parentId = Number(node.parentId);
    if (!Number.isInteger(parentId)) continue;
    const values = childIds.get(parentId) || [];
    values.push(Number(node.nodeId));
    childIds.set(parentId, values);
  }
  const descendantText = (rootId) => {
    const pending = [...(childIds.get(rootId) || [])];
    const values = [];
    const visited = new Set();
    while (pending.length > 0 && visited.size < 50) {
      const nodeId = pending.shift();
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      const node = byId.get(nodeId);
      if (!node) continue;
      if (Number(node.nodeType) === 3) values.push(String(node.nodeValue || ''));
      pending.push(...(childIds.get(nodeId) || []));
    }
    return normalizedAccessibilityValue(values.join(' '));
  };
  const matches = [];
  const seen = new Set();
  for (const node of flattened) {
    if (String(node.nodeName || '').toUpperCase() !== 'BUTTON') continue;
    const attributes = {};
    const pairs = Array.from(node.attributes || []);
    for (let index = 0; index + 1 < pairs.length; index += 2) {
      attributes[String(pairs[index] || '').toLowerCase()] = String(pairs[index + 1] || '');
    }
    const name = normalizedAccessibilityValue(
      attributes['aria-label'] || attributes.title || attributes.value || descendantText(Number(node.nodeId)),
    );
    const backendDOMNodeId = Number(node.backendNodeId);
    if (name !== '发布' || !Number.isInteger(backendDOMNodeId) || seen.has(backendDOMNodeId)) continue;
    seen.add(backendDOMNodeId);
    matches.push({
      backendDOMNodeId,
      disabled: Object.hasOwn(attributes, 'disabled') || attributes['aria-disabled'] === 'true',
      tagName: 'BUTTON',
      inputType: attributes.type || '',
      role: 'button',
    });
  }
  return matches;
}

export function publishCandidatesFromFlattenedDom(nodes, boxModels, viewportHeight = 0) {
  if (!boxModels || typeof boxModels !== 'object') return [];
  return findPublishButtonsInFlattenedDom(nodes)
    .map((item) => publishCandidateFromBox(
      item.backendDOMNodeId,
      boxModels[item.backendDOMNodeId] || boxModels[String(item.backendDOMNodeId)],
      viewportHeight,
      item,
    ))
    .filter(Boolean);
}

export function isUploadLandingReady(evidence) {
  if (!evidence
    || evidence.publishPath !== '/publish/publish'
    || evidence.hasTitleInput
    || evidence.editableCount > 0) {
    return false;
  }
  if (evidence.publishTarget === 'image') {
    return Boolean(evidence.imageUploadAction && evidence.imageUploadPrompt);
  }
  if (evidence.publishTarget === 'video') {
    return Boolean(evidence.videoUploadAction && evidence.videoUploadPrompt);
  }
  return Boolean(evidence.uploadModeControl
    && (evidence.genericUploadPrompt || evidence.fileInputCount > 0));
}

export function isPublishModeReady(evidence, noteType) {
  const target = publishTargetForNoteType(noteType);
  return Boolean(target
    && evidence?.publishTarget === target
    && isUploadLandingReady(evidence));
}

export function publishModeMatches(evidence, noteType) {
  const target = publishTargetForNoteType(noteType);
  return Boolean(target && evidence?.publishTarget === target);
}

export function classifyPageProbe(probe) {
  if (!probe || typeof probe !== 'object') return 'unsupported';
  if (probe.securityChallenge) return 'security_challenge';
  if (probe.loginRequired) return 'login_required';
  if (probe.successPage) return 'success';
  if (!probe.editorReady && !probe.uploadLandingReady) return 'unsupported';
  return probe.editorReady ? 'draft' : 'ready';
}

function isNonEmptyString(value, maxLength) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isAbsolutePath(value) {
  return typeof value === 'string' && (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value));
}

export function validatePublishRequest(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'INVALID_REQUEST', message: '发布请求必须是对象' };
  }
  if (payload.protocolVersion !== 1 || !isNonEmptyString(payload.jobId, 200)) {
    return { ok: false, code: 'INVALID_REQUEST', message: '发布协议或任务 ID 无效' };
  }
  if (!isNonEmptyString(payload.sessionId, 200)
    || !isNonEmptyString(payload.projectPath, 4096)
    || !Number.isInteger(payload.revision)
    || payload.revision < 0
    || !/^[a-f0-9]{64}$/i.test(String(payload.contentDigest || ''))) {
    return { ok: false, code: 'INVALID_REQUEST', message: '发布版本信息无效' };
  }
  if (!['image', 'video'].includes(payload.noteType)
    || !isNonEmptyString(payload.title, 1000)
    || !isNonEmptyString(payload.body, 20000)
    || !Array.isArray(payload.hashtags)
    || payload.hashtags.length > 30
    || payload.hashtags.some((item) => typeof item !== 'string')) {
    return { ok: false, code: 'INVALID_REQUEST', message: '笔记内容格式无效' };
  }
  if (!Array.isArray(payload.media) || payload.media.length === 0 || payload.media.length > 18) {
    return { ok: false, code: 'INVALID_REQUEST', message: '媒体清单为空或数量超限' };
  }
  const paths = new Set();
  const orders = new Set();
  for (const item of payload.media) {
    if (!item || typeof item !== 'object'
      || !isNonEmptyString(item.slotId, 200)
      || !['cover', 'image-page', 'video'].includes(item.role)
      || !isAbsolutePath(item.path)
      || !isNonEmptyString(item.mimeType, 200)
      || !Number.isInteger(item.order)
      || item.order < 0
      || paths.has(item.path)
      || orders.has(item.order)) {
      return { ok: false, code: 'INVALID_MEDIA', message: '媒体清单包含无效或重复项目' };
    }
    paths.add(item.path);
    orders.add(item.order);
  }
  const videos = payload.media.filter((item) => item.role === 'video');
  const images = payload.media.filter((item) => item.role !== 'video');
  if (payload.noteType === 'video') {
    if (videos.length !== 1 || images.length > 1 || images.some((item) => item.role !== 'cover')) {
      return { ok: false, code: 'INVALID_MEDIA', message: '视频笔记必须包含一个视频，且最多包含一个封面' };
    }
  } else if (videos.length > 0 || images.length === 0) {
    return { ok: false, code: 'INVALID_MEDIA', message: '图片笔记只能包含图片媒体' };
  }
  return { ok: true };
}
