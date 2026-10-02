import { app } from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { buildVideoEditorV2RemotionComposition, VIDEO_EDITOR_V2_REMOTION_COMPOSITION_ID } from '../../../shared/videoAutoEditRemotion';
import type { VideoEditorV2RemotionComposition } from '../../../shared/videoAutoEditRemotion';
import type { RenderOutputRecord, SrtSegment, VideoEditorV2Project } from '../../../shared/videoAutoEdit';
import { serializeSegmentsToSrt } from '../video-auto-edit/srtParser';
import { ensureProductVideoMusicAudible, saveVideoEditorV2Project } from './videoEditorV2ProjectStore';
import { stageRemotionAssets } from './remotionAssetStaging';
import { registerRenderedVideoAsset } from '../mediaLibraryStore';
import { videoRenderFingerprint } from './videoPublicationPolicy';

type RenderProgressPayload = {
  projectId: string;
  stage: string;
  percent: number;
  status: 'running' | 'completed' | 'failed';
  outputPath?: string;
  error?: string;
};

export type VideoEditorV2RenderProgress = (payload: RenderProgressPayload) => void;

export type RenderVideoEditorV2ProjectInput = {
  projectId: string;
  outputPath?: string;
  renderVideo?: boolean;
  onProgress?: VideoEditorV2RenderProgress;
};

function nowIso(): string {
  return new Date().toISOString();
}

function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  return fs.mkdir(path.dirname(filePath), { recursive: true })
    .then(async () => {
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf-8');
      await fs.rename(tempPath, filePath);
    });
}

function sanitizeFileBaseName(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\-.一-龥]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim()
    || 'video-edit';
}

function timestampForFileName(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function getDefaultOutputPath(project: VideoEditorV2Project): string {
  return path.join(
    project.projectDir,
    'renders',
    `${sanitizeFileBaseName(project.title)}-${timestampForFileName()}.mp4`,
  );
}

function ensureMp4OutputPath(rawPath: string): string {
  const normalized = path.resolve(path.normalize(rawPath));
  return path.extname(normalized) ? normalized : `${normalized}.mp4`;
}

function buildTimelineSrtSegments(project: VideoEditorV2Project): SrtSegment[] {
  const subtitleTrack = project.timeline.tracks.find((track) => track.kind === 'subtitle');
  if (!subtitleTrack) return [];
  return subtitleTrack.clips
    .filter((clip) => String(clip.text || '').trim())
    .sort((left, right) => left.timelineStartMs - right.timelineStartMs)
    .map((clip, index) => ({
      id: `render_subtitle_${index + 1}`,
      index: index + 1,
      assetId: String(clip.assetId || ''),
      startMs: Math.max(0, Math.round(clip.timelineStartMs)),
      endMs: Math.max(0, Math.round(clip.timelineEndMs)),
      text: String(clip.text || '').trim(),
      tags: [],
    }));
}

async function writeTimelineSrt(project: VideoEditorV2Project): Promise<string | null> {
  const segments = buildTimelineSrtSegments(project);
  if (segments.length === 0) return null;
  const srtPath = path.join(
    project.projectDir,
    'renders',
    `${sanitizeFileBaseName(project.title)}-${timestampForFileName()}.edited.srt`,
  );
  await fs.mkdir(path.dirname(srtPath), { recursive: true });
  await fs.writeFile(srtPath, serializeSegmentsToSrt(segments), 'utf-8');
  return srtPath;
}

function findRemotionBundleDirectory(): string {
  const candidates = [
    path.join(process.resourcesPath, 'remotion-render-bundle'),
    path.join(app.getAppPath(), '.remotion-render-bundle'),
    path.join(process.cwd(), '.remotion-render-bundle'),
  ];
  for (const candidate of candidates) {
    if (fsSync.existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  throw new Error('缺少 Remotion 渲染资源。请重新安装应用，或在开发环境执行 pnpm --dir desktop prepare:remotion-bundle。');
}

function findInstalledChrome(): string | undefined {
  const candidates = [
    process.env.CHROME_PATH,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined,
    process.platform === 'darwin' ? '/Applications/Chromium.app/Contents/MacOS/Chromium' : undefined,
    process.platform === 'win32' ? path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined,
    process.platform === 'linux' ? '/usr/bin/google-chrome' : undefined,
    process.platform === 'linux' ? '/usr/bin/chromium' : undefined,
  ];
  for (const candidate of candidates) {
    if (candidate && fsSync.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function findRemotionCompositorDirectory(): string {
  const platformDirectory = `${process.platform}-${process.arch}`;
  const executable = process.platform === 'win32' ? 'remotion.exe' : 'remotion';
  const candidates = [
    path.join(process.resourcesPath, 'remotion-compositor', platformDirectory),
    path.join(app.getAppPath(), '.remotion-compositor', platformDirectory),
    path.join(process.cwd(), '.remotion-compositor', platformDirectory),
  ];
  const found = candidates.find((candidate) => fsSync.existsSync(path.join(candidate, executable)));
  if (!found) throw new Error(`缺少 ${platformDirectory} Remotion 合成器。请重新安装应用，或执行 pnpm --dir desktop prepare:remotion-bundle。`);
  return found;
}

async function renderRemotionComposition(input: {
  project: VideoEditorV2Project;
  composition: VideoEditorV2RemotionComposition;
  outputPath: string;
  onProgress?: VideoEditorV2RenderProgress;
}): Promise<void> {
  const renderDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gardenflow-remotion-render-'));
  try {
    input.onProgress?.({
      projectId: input.project.id,
      stage: '准备渲染素材',
      percent: 10,
      status: 'running',
    });
    await fs.cp(findRemotionBundleDirectory(), renderDir, { recursive: true });
    const stagedComposition = await stageRemotionAssets(input.project.assets, input.composition, renderDir);
    const rendererPath = app.isPackaged
      ? path.join(process.resourcesPath, 'remotion-renderer-runtime', 'node_modules', '@remotion', 'renderer', 'dist', 'index.js')
      : '@remotion/renderer';
    const { renderMedia, selectComposition } = createRequire(import.meta.url)(rendererPath) as typeof import('@remotion/renderer');
    const inputProps = { composition: stagedComposition, runtime: 'render' as const };
    const browserExecutable = findInstalledChrome();
    const binariesDirectory = findRemotionCompositorDirectory();

    input.onProgress?.({
      projectId: input.project.id,
      stage: '读取 Remotion composition',
      percent: 40,
      status: 'running',
    });
    const composition = await selectComposition({
      serveUrl: renderDir,
      id: VIDEO_EDITOR_V2_REMOTION_COMPOSITION_ID,
      inputProps,
      browserExecutable,
      binariesDirectory,
    });

    await renderMedia({
      composition,
      serveUrl: renderDir,
      browserExecutable,
      binariesDirectory,
      codec: 'h264',
      imageFormat: 'jpeg',
      outputLocation: input.outputPath,
      inputProps,
      overwrite: true,
      logLevel: 'warn',
      onProgress: (progress: { progress?: number }) => {
        input.onProgress?.({
          projectId: input.project.id,
          stage: '渲染 MP4',
          percent: Math.round(45 + Math.max(0, Math.min(1, Number(progress.progress) || 0)) * 50),
          status: 'running',
        });
      },
    });
  } finally {
    await fs.rm(renderDir, { recursive: true, force: true });
  }
}

export async function renderVideoEditorV2Project(input: RenderVideoEditorV2ProjectInput): Promise<{
  project: VideoEditorV2Project;
  outputPath?: string;
  mediaAssetId?: string;
  compositionPath: string;
  subtitlePath?: string | null;
}> {
  const project = await ensureProductVideoMusicAudible(input.projectId);
  if (!project) {
    throw new Error('Video editor V2 project not found');
  }
  const composition = buildVideoEditorV2RemotionComposition(project);
  if (!composition) {
    throw new Error('生成 Remotion 快照前需要先生成自动粗剪 timeline');
  }

  const renderId = `render_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const compositionPath = path.join(project.projectDir, 'remotion', 'composition.latest.json');
  await writeJsonAtomic(compositionPath, composition);
  const subtitlePath = await writeTimelineSrt(project);
  let updatedProject = await saveVideoEditorV2Project({
    ...project,
    status: input.renderVideo === false ? project.status : 'rendering',
    remotionSnapshot: {
      compositionPath,
      updatedAt: nowIso(),
    },
    lastError: null,
  });

  if (input.renderVideo === false) {
    return {
      project: updatedProject,
      compositionPath,
      subtitlePath,
    };
  }

  const outputPath = ensureMp4OutputPath(String(input.outputPath || '').trim() || getDefaultOutputPath(updatedProject));
  try {
    input.onProgress?.({
      projectId: project.id,
      stage: '准备渲染',
      percent: 5,
      status: 'running',
      outputPath,
    });
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await renderRemotionComposition({
      project: updatedProject,
      composition: {
        ...composition,
        render: {
          outputPath,
          renderedAt: Date.now(),
          durationInFrames: composition.durationInFrames,
          renderMode: 'full',
          compositionId: VIDEO_EDITOR_V2_REMOTION_COMPOSITION_ID,
          codec: 'h264',
          imageFormat: 'jpeg',
        },
      },
      outputPath,
      onProgress: input.onProgress,
    });

    const mediaAsset = updatedProject.projectKind === 'product-video'
      ? await registerRenderedVideoAsset({
        projectId: updatedProject.id,
        renderId,
        sourcePath: outputPath,
        title: updatedProject.title,
      })
      : null;

    const renderOutput: RenderOutputRecord = {
      id: renderId,
      path: outputPath,
      mediaAssetId: mediaAsset?.id,
      renderFingerprint: videoRenderFingerprint(project),
      createdAt: nowIso(),
      durationMs: updatedProject.timeline.durationMs,
    };
    updatedProject = await saveVideoEditorV2Project({
      ...updatedProject,
      status: 'exported',
      renderOutputs: [renderOutput, ...(updatedProject.renderOutputs || [])].slice(0, 20),
      lastError: null,
    });
    input.onProgress?.({
      projectId: project.id,
      stage: '导出完成',
      percent: 100,
      status: 'completed',
      outputPath,
    });
    return {
      project: updatedProject,
      outputPath,
      mediaAssetId: mediaAsset?.id,
      compositionPath,
      subtitlePath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updatedProject = await saveVideoEditorV2Project({
      ...updatedProject,
      status: 'failed',
      lastError: message,
    });
    input.onProgress?.({
      projectId: project.id,
      stage: '导出失败',
      percent: 100,
      status: 'failed',
      outputPath,
      error: message,
    });
    throw error;
  }
}
