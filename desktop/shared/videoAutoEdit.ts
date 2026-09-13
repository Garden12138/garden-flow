export type VideoEditorV2ProjectStatus =
  | 'draft'
  | 'generating'
  | 'partial'
  | 'analyzing'
  | 'transcribing'
  | 'ready'
  | 'auto_editing'
  | 'rendering'
  | 'exported'
  | 'failed';

export type VideoEditorV2AssetKind = 'video' | 'audio' | 'image';
export type VideoEditorV2TrackKind = 'primary-video' | 'b-roll' | 'subtitle' | 'music' | 'voiceover' | 'effect';
export type ProductVideoFitMode = 'contain-blur' | 'cover';
export type ProductVideoMotionPreset = 'static' | 'slow-zoom-in' | 'slow-zoom-out' | 'pan-left' | 'pan-right';
export type ProductVideoSceneSource = 'product-asset' | 'ai-motion';
export type ProductVideoGenerationStatus = 'not-required' | 'pending' | 'generating' | 'ready' | 'failed';
export type SrtSegmentTag = 'keep' | 'remove' | 'highlight' | 'hook' | 'filler' | 'unclear';

export interface VideoCanvasSpec {
  width: number;
  height: number;
  fps: number;
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:5' | 'custom';
}

export interface MediaProbeRecord {
  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
  rotation?: number;
}

export interface MediaAssetRecord {
  id: string;
  kind: VideoEditorV2AssetKind;
  title: string;
  sourcePath: string;
  projectPath: string;
  relativePath: string;
  proxyPath?: string | null;
  thumbnailPath?: string | null;
  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
  hash: string;
  createdAt: string;
  updatedAt: string;
  probe?: MediaProbeRecord;
  provenance?: {
    kind: 'brand-product' | 'ai-generated' | 'user-import';
    productId?: string;
    sourceAssetId?: string;
    generationJobId?: string;
    prompt?: string;
  };
}

export interface ProductVideoProposalScene {
  id: string;
  title: string;
  durationMs: number;
  source: ProductVideoSceneSource;
  productAssetIds: string[];
  overlayText?: string;
  generationPrompt?: string;
  fitMode: ProductVideoFitMode;
  motionPreset: ProductVideoMotionPreset;
}

export interface ProductVideoProposal {
  version: 1;
  proposalId: string;
  productId: string;
  referencedProductIds: string[];
  productName: string;
  productUpdatedAt: string;
  title: string;
  canvas: VideoCanvasSpec;
  durationMs: number;
  scenes: ProductVideoProposalScene[];
}

export interface ProductVideoSceneState extends ProductVideoProposalScene {
  generationStatus: ProductVideoGenerationStatus;
  generationJobId?: string;
  generatedAssetId?: string;
  error?: string;
}

export interface ProductVideoProjectMetadata {
  proposal: ProductVideoProposal;
  productSnapshot: {
    id: string;
    name: string;
    updatedAt: string;
    brandName?: string;
    facts: Array<{ key: string; value: string; origin: string }>;
    skus?: Array<{ id: string; name: string; variantText?: string; externalId?: string }>;
    sources?: Array<{
      platform: string;
      sourceUrl: string;
      capturedAt: string;
      price?: { text: string; currency?: string; label?: string };
      parameters: Array<{ key: string; value: string }>;
    }>;
  };
  scenes: ProductVideoSceneState[];
}

export interface SrtSegment {
  id: string;
  index: number;
  assetId: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number | null;
  speaker?: string | null;
  tags: SrtSegmentTag[];
}

export interface TranscriptTrack {
  id: string;
  assetId: string;
  language?: string;
  sourceSrtPath: string;
  normalizedJsonPath: string;
  editedSrtPath?: string | null;
  segments: SrtSegment[];
  createdAt: string;
  updatedAt: string;
}

export interface VideoCropSpec {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VideoTransformSpec {
  x?: number;
  y?: number;
  scale?: number;
  rotate?: number;
  opacity?: number;
}

export interface VideoClipStyle {
  subtitlePreset?: string;
  transition?: string;
}

export interface VideoTimelineClip {
  id: string;
  assetId?: string;
  transcriptSegmentIds?: string[];
  disabled?: boolean;
  sourceStartMs: number;
  sourceEndMs: number;
  timelineStartMs: number;
  timelineEndMs: number;
  playbackRate?: number;
  crop?: VideoCropSpec;
  transform?: VideoTransformSpec;
  style?: VideoClipStyle;
  text?: string;
  sceneId?: string;
  fitMode?: ProductVideoFitMode;
  motionPreset?: ProductVideoMotionPreset;
  volume?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
}

export interface VideoTimelineTrack {
  id: string;
  kind: VideoEditorV2TrackKind;
  name: string;
  locked?: boolean;
  muted?: boolean;
  clips: VideoTimelineClip[];
}

export interface VideoTimelineV2 {
  id: string;
  durationMs: number;
  tracks: VideoTimelineTrack[];
}

export interface AutoEditPlan {
  summary: string;
  selectedSegments: Array<{
    segmentId: string;
    reason: string;
    role: 'hook' | 'context' | 'proof' | 'detail' | 'cta' | 'filler-removal';
    priority: number;
  }>;
  removedSegments: Array<{
    segmentId: string;
    reason: string;
  }>;
  titleCards: Array<{
    afterSegmentId?: string;
    text: string;
    durationMs: number;
  }>;
  subtitleStyle?: Record<string, unknown>;
  warnings: string[];
}

export interface EditDecision {
  id: string;
  kind: 'keep' | 'remove' | 'merge' | 'title-card' | 'transition';
  segmentIds: string[];
  reason?: string;
}

export interface AutoEditRunRecord {
  id: string;
  createdAt: string;
  appliedAt?: string | null;
  trackId?: string;
  userGoal: string;
  targetDurationMs?: number | null;
  plan: AutoEditPlan;
  decisions: EditDecision[];
  status: 'planned' | 'applied' | 'failed';
  error?: string;
}

export interface VideoEditorV2UndoRecord {
  id: string;
  createdAt: string;
  label: string;
  timeline: VideoTimelineV2;
  autoEditRuns?: AutoEditRunRecord[];
  productVideo?: ProductVideoProjectMetadata | null;
}

export interface RemotionSnapshotRecord {
  compositionPath: string;
  updatedAt: string;
}

export interface RenderOutputRecord {
  id: string;
  path: string;
  createdAt: string;
  durationMs?: number;
}

export interface VideoEditorV2Project {
  version: 2;
  id: string;
  title: string;
  projectKind: 'subtitle-edit' | 'product-video';
  sourceManuscriptPath?: string | null;
  projectDir: string;
  createdAt: string;
  updatedAt: string;
  status: VideoEditorV2ProjectStatus;
  canvas: VideoCanvasSpec;
  assets: MediaAssetRecord[];
  transcriptTracks: TranscriptTrack[];
  timeline: VideoTimelineV2;
  autoEditRuns: AutoEditRunRecord[];
  undoStack: VideoEditorV2UndoRecord[];
  remotionSnapshot?: RemotionSnapshotRecord | null;
  renderOutputs: RenderOutputRecord[];
  lastError?: string | null;
  productVideo?: ProductVideoProjectMetadata | null;
}

export type ProductVideoEditCommand =
  | { type: 'scene.reorder'; sceneId: string; targetSceneId: string; position: 'before' | 'after' }
  | { type: 'scene.duration'; sceneId: string; durationMs: number }
  | { type: 'scene.fit'; sceneId: string; fitMode: ProductVideoFitMode }
  | { type: 'scene.motion'; sceneId: string; motionPreset: ProductVideoMotionPreset }
  | { type: 'scene.text'; sceneId: string; text: string }
  | { type: 'scene.asset'; sceneId: string; assetId: string }
  | { type: 'scene.delete'; sceneId: string }
  | { type: 'music.remove' };
