type TimelineClipLike = Record<string, unknown>;
type PackageStateLike = {
  assets?: { items?: Array<Record<string, unknown>> } | null;
  timelineSummary?: {
    trackNames?: string[];
    clips?: TimelineClipLike[];
    clipCount?: number;
  } | null;
  editorProject?: {
    ai?: {
      scriptApproval?: {
        status?: string | null;
      } | null;
    } | null;
  } | null;
  videoProject?: {
    scriptApproval?: {
      status?: string | null;
    } | null;
  } | null;
};

export type EditorAiWorkspaceMode = {
  id: string;
  label: string;
};

export type EditorSessionBindingRequest = {
  session: {
    scope: 'file' | 'context';
    filePath?: string;
    contextType: string;
    contextId: string;
    title?: string;
    modeLabel?: string;
    targetTypeLabel?: string;
    targetPath?: string;
    initialContext?: string;
  };
  metadata: Record<string, unknown>;
};

type BuildEditorSessionBindingParams = {
  editorFile: string | null;
  draftType?: string | null;
  editorTitle?: string | null;
  fileFallbackTitle?: string | null;
  editorAiWorkspaceMode: EditorAiWorkspaceMode;
  packageState?: PackageStateLike | null;
  editorBodyDirty: boolean;
  xhsNote?: {
    noteType?: 'image' | 'video';
    projectPath?: string | null;
    uri?: string | null;
    revision?: number | null;
  } | null;
};

const WRITING_EDITOR_ALLOWED_TOOLS = ['workflow'];
const WRITING_EDITOR_ALLOWED_APP_CLI_ACTIONS = ['manuscripts.writeCurrent'];
const XHS_EDITOR_ALLOWED_APP_CLI_ACTIONS = [
  'manuscripts.note-get',
  'manuscripts.note-save',
  'manuscripts.note-bind-media',
  'manuscripts.note-export',
  'image.generate',
  'video.generate',
  'video.generate-note',
];

function text(value: unknown): string {
  return String(value || '').trim();
}

function list<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function pickDraftTitle(params: BuildEditorSessionBindingParams): string {
  return text(params.editorTitle) || text(params.fileFallbackTitle) || '未命名';
}

function resolveModeLabel(params: BuildEditorSessionBindingParams): string {
  const workspaceModeLabel = text(params.editorAiWorkspaceMode.label);
  if (workspaceModeLabel) return workspaceModeLabel;
  switch (params.draftType) {
    case 'longform':
      return '长文编辑';
    default:
      return '文件编辑';
  }
}

function resolveTargetTypeLabel(params: BuildEditorSessionBindingParams): string {
  switch (params.draftType) {
    case 'longform':
      return '长文稿件';
    default:
      return '文件';
  }
}

function resolveMediaSummaries(params: BuildEditorSessionBindingParams) {
  const packageAssets = list(params.packageState?.assets?.items);
  const timelineClips = list(params.packageState?.timelineSummary?.clips);
  const trackNamesFromSummary = list(params.packageState?.timelineSummary?.trackNames);
  const timelineTrackNames = trackNamesFromSummary.length
    ? trackNamesFromSummary
    : Array.from(new Set(
        timelineClips
          .map((item) => text(item?.track))
          .filter(Boolean),
      ));
  return {
    packageAssets,
    timelineClips,
    timelineTrackNames,
  };
}

function resolveScriptApprovalStatus(params: BuildEditorSessionBindingParams): string {
  return params.editorBodyDirty ? 'pending' : 'draft';
}

export function buildEditorSessionBinding(
  params: BuildEditorSessionBindingParams,
): EditorSessionBindingRequest | null {
  const isXhsNote = Boolean(params.xhsNote);
  const editorFile = text(params.xhsNote?.projectPath) || text(params.editorFile);
  if (!editorFile) return null;

  const xhsNoteType = params.xhsNote?.noteType === 'video' ? 'video' : 'image';
  const draftType = isXhsNote ? `xiaohongshu-${xhsNoteType}` : text(params.draftType) || 'unknown';
  const { packageAssets } = resolveMediaSummaries(params);
  const modeLabel = isXhsNote ? '小红书笔记编辑' : resolveModeLabel(params);
  const targetTypeLabel = isXhsNote
    ? `小红书${xhsNoteType === 'video' ? '视频' : '图文'}笔记`
    : resolveTargetTypeLabel(params);
  const associatedFilePath = editorFile;
  const currentTitle = pickDraftTitle(params);

  const metadata: Record<string, unknown> = {
    editorBindingVersion: 1,
    editorBindingKind: isXhsNote ? 'xiaohongshu-note' : 'file',
    contextType: 'file',
    contextId: editorFile,
    isContextBound: true,
    intent: isXhsNote ? 'manuscript_creation' : 'manuscript_editing',
    editorIntent: isXhsNote ? 'xiaohongshu_note_editing' : 'manuscript_editing',
    allowedTools: WRITING_EDITOR_ALLOWED_TOOLS,
    allowedAppCliActions: isXhsNote ? XHS_EDITOR_ALLOWED_APP_CLI_ACTIONS : WRITING_EDITOR_ALLOWED_APP_CLI_ACTIONS,
    writeTarget: isXhsNote ? text(params.xhsNote?.uri) : 'manuscripts://current',
    allowedWriteTargets: isXhsNote ? [text(params.xhsNote?.uri)].filter(Boolean) : ['manuscripts://current'],
    associatedFilePath,
    agentProfile: 'manuscript-editor',
    sourceManuscriptPath: editorFile,
    sourceManuscriptTitle: currentTitle,
    sourceManuscriptDraftType: draftType,
    currentAuthoringProjectPath: editorFile,
    currentAuthoringContentPath: editorFile,
    currentAuthoringEntryPath: editorFile,
    currentAuthoringTitle: currentTitle,
    editorWorkspaceMode: text(params.editorAiWorkspaceMode.id),
    editorWorkspaceModeLabel: text(params.editorAiWorkspaceMode.label),
    mediaAssetCount: packageAssets.length,
    mediaClipCount: 0,
    editorApprovalStatus: resolveScriptApprovalStatus(params),
    mediaTrackNames: [],
    mediaClips: [],
    ...(isXhsNote ? {
      executionProfile: 'artifact-authoring',
      requireSave: true,
      platform: 'xiaohongshu',
      taskType: 'direct_write',
      artifactType: 'xiaohongshu-note',
      activeXhsNotePath: editorFile,
      activeXhsNoteUri: text(params.xhsNote?.uri),
      xhsNoteType,
      xhsNoteRevision: Number(params.xhsNote?.revision || 0),
    } : {}),
  };

  return {
    session: {
      scope: 'file',
      filePath: editorFile,
      contextType: 'file',
      contextId: editorFile,
      title: currentTitle,
      modeLabel,
      targetTypeLabel,
      targetPath: associatedFilePath,
    },
    metadata,
  };
}
