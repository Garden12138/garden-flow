import { lazy, Suspense, useMemo } from 'react';
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
}

function buildXhsEditorContext(target: ChatMessageLinkTarget): string {
  const projectPath = target.projectPath || target.localPathCandidate || target.relativePath || target.href;
  const noteType = target.noteType === 'video' ? '视频笔记' : '图文笔记';
  return [
    ...(target.xhsNote?.productImageSet ? ['当前是商品套图工程。页面标题、文案、图片 ID、布局和统一配色在 document.productImageSet.pages/style 中编辑，imagePages 和 mediaSlots 由系统投影。商品快照、素材清单和 render/generation 记录不可自行改写；付费图片生成由工作台按页确认，禁止直接 image_generate。'] : []),
    '当前对话嵌入在小红书稿件工作台右侧，所有修改都作用于左侧当前打开的结构化笔记。',
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
}: XhsNoteWorkbenchProps) {
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

  return (
    <ProductEditorContext.Provider value={isProduct ? productEditor : null}>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_420px] bg-surface-primary text-text-primary">
      <section className="min-h-0 border-r border-border bg-surface-primary">
        <XhsNotePreviewPane target={target} />
      </section>
      <aside data-product-project-editor-chat={isProduct ? '' : undefined} className="min-h-0 bg-surface-secondary/55">
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-border bg-surface-primary/70 px-3 py-2 text-[11px] leading-5 text-text-tertiary">
            这是当前稿件的独立对话；原创作对话仍保留在“对话”列表中，关闭稿件编辑器即可返回。
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {(isProduct ? productEditor.sessionId : editorChatSessionId && editorChatReady) ? (
              <Suspense fallback={<div className="flex h-full items-center justify-center text-text-tertiary">AI 会话加载中...</div>}>
                <ChatWorkspace
                  isActive={isActive}
                  fixedSessionId={(isProduct ? productEditor.sessionId : editorChatSessionId)!}
                  beforeSend={isProduct ? productEditor.beforeSend : undefined}
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
      </aside>
    </div>
    </ProductEditorContext.Provider>
  );
}
