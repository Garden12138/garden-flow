import { NoteCardWorkbench } from './NoteCardWorkbench';
import { appAlert } from '../../utils/appDialogs';
import { lazy, Suspense, useMemo, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import type { ChatMessageLinkTarget } from '../MessageItem';
import { XhsNotePreviewPane } from '../../pages/gardenflow/XhsNotePreviewPane';
import { ProductEditorContext, useProductEditor } from '../product-video/ProductEditorContext';

const ChatWorkspace = lazy(async () => ({
  default: (await import('../../pages/Chat')).Chat,
}));

interface XhsNoteWorkbenchProps {
  target: ChatMessageLinkTarget;
  editorChatSessionId: string | null;
  editorChatReady?: boolean;
  editorSessionMetadata?: Record<string, unknown> | null;
  chatFocusSignal?: number;
  isActive?: boolean;
  onClose?: () => void;
}

function buildXhsEditorContext(target: ChatMessageLinkTarget): string {
  const projectPath = target.projectPath || target.localPathCandidate || target.relativePath || target.href;
  const noteType = target.noteType === 'video' ? '视频笔记' : '图文笔记';
  return [
    ...(target.xhsNote?.productImageSet ? ['当前是商品套图工程。页面标题、文案、图片 ID、布局和统一配色在 document.productImageSet.pages/style 中编辑，imagePages 和 mediaSlots 由系统投影。商品快照、素材清单和 render/generation 记录不可自行改写；付费图片生成由工作台按页确认，禁止直接 image_generate。'] : []),
    '当前对话位于创作工作台左侧，所有修改作用于中间的作品编辑，右侧展示效果预览。',
    '每次修改前先用 manuscripts note-get 读取最新 revision；保存时使用 manuscripts note-save --expected-revision <刚读取的版本>，禁止用普通 Markdown 写入覆盖结构化工程。',
    `当前工程路径：${projectPath}`,
    `当前工程 URI：${target.uri || target.href}`,
    `当前笔记类型：${noteType}`,
    `当前标题：${target.xhsNote?.finalTitle || target.label || '未命名'}`,
    `当前 revision：${target.xhsNote?.revision || target.version || 0}`,
  ].join('\n');
}

export function XhsNoteWorkbench({
  target,
  editorChatSessionId,
  editorChatReady = true,
  editorSessionMetadata = null,
  chatFocusSignal = 0,
  isActive = false,
  onClose,
}: XhsNoteWorkbenchProps) {
  const flushNote = useRef<() => Promise<unknown>>(async () => undefined);
  const registerFlush = (flush: () => Promise<unknown>) => { flushNote.current = flush; return () => { flushNote.current = async () => undefined; }; };
  const projectPath = target.projectPath || target.localPathCandidate || target.relativePath || target.href;
  const isProduct = Boolean(target.xhsNote?.productImageSet);
  const productEditor = useProductEditor(isProduct ? { kind: 'image-set', path: projectPath } : null);
  const taskHints = useMemo(() => ({
    ...(editorSessionMetadata || {}),
    mode: 'xiaohongshu-note-editing',
    executionProfile: 'artifact-authoring',
    requireSave: true,
    platform: 'xiaohongshu',
    taskType: 'direct_write',
    artifactType: 'xiaohongshu-note',
    activeXhsNotePath: projectPath,
    activeXhsNoteUri: target.uri || target.href,
    xhsNoteType: target.noteType,
    productImageSetEditing: Boolean(target.xhsNote?.productImageSet),
    initialContext: buildXhsEditorContext(target),
  }), [editorSessionMetadata, projectPath, target]);

  if (target.noteType !== 'video' && !isProduct) return <NoteCardWorkbench key={projectPath} target={target} sessionId={editorChatReady ? editorChatSessionId : null} isActive={isActive} onClose={onClose} />;

  return (
    <ProductEditorContext.Provider value={isProduct ? productEditor : null}>
    <XhsNotePreviewPane target={target} registerFlush={registerFlush} actions={onClose && <button type="button" className="rounded border border-border px-2 py-1 text-xs" onClick={() => { void (async () => { if (isProduct) await productEditor.beforeSend(); else await flushNote.current(); onClose(); })().catch(reason => { void appAlert(String(reason)); }); }}>返回对话</button>} chat={(      <aside data-product-project-editor-chat={isProduct ? '' : undefined} className="h-full min-h-0 bg-surface-secondary/55">
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-border bg-surface-primary/70 px-3 py-2 text-[11px] leading-5 text-text-tertiary">
            对话修改会同步到作品编辑；发送前自动保存手动输入。
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {(isProduct ? productEditor.sessionId : editorChatSessionId && editorChatReady) ? (
              <Suspense fallback={<div className="flex h-full items-center justify-center text-text-tertiary">AI 会话加载中...</div>}>
                <ChatWorkspace
                  isActive={isActive}
                  fixedSessionId={(isProduct ? productEditor.sessionId : editorChatSessionId)!}
                  beforeSend={isProduct ? productEditor.beforeSend : async () => { await flushNote.current(); return {}; }}
                  keepComposerInputActive={isProduct}
                  showClearButton={false}
                  showWelcomeShortcuts={false}
                  showComposerShortcuts={target.noteType === 'video'}
                  shortcuts={target.noteType === 'video' ? [{
                    label: '生成视频',
                    text: '生成视频',
                    displayContent: '生成视频',
                    action: 'send',
                    taskHints: {
                      editorAction: 'generate-video',
                    },
                  }] : []}
                  fixedSessionContextIndicatorMode="none"
                  contentLayout="wide"
                  contentWidthPreset="default"
                  allowFileUpload
                  messageWorkflowPlacement="bottom"
                  messageWorkflowVariant="compact"
                  messageWorkflowEmphasis="default"
                  fixedSessionTaskHints={isProduct ? { workflowKind: 'product-project-edit' } : taskHints}
                  focusSignal={chatFocusSignal}
                />
              </Suspense>
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center">
                <div>
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-accent-primary/70" />
                  <div className="mt-3 text-sm text-text-secondary">
                    {editorChatSessionId ? '正在同步稿件上下文...' : '正在初始化 AI 会话...'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>)} />

    </ProductEditorContext.Provider>
  );
}
