import { runInWorkspaceSpace, getWorkspacePaths } from '../../db';
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
import { ensureProductVideoMusicAudible, getVideoEditorV2Project, saveVideoEditorV2Project, enqueueProductProjectMutation } from './videoEditorV2ProjectStore';
import { stageRemotionAssets } from './remotionAssetStaging';
import { registerRenderedVideoAsset } from '../mediaLibraryStore';
import { videoRenderFingerprint } from './videoPublicationPolicy';
import { retryLocalRemotionNavigation } from './localRemotionRetry';
import { findReusableProductVideoExport, renderedVideoSha256 } from './productVideoExportCache';

import { syncProductVideoTargetExport } from '../productWorkVersionService';

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

export async function renderRemotionComposition(input: {
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
    const onRetry = () => input.onProgress?.({
      projectId: input.project.id,
      stage: '重新准备渲染',
      percent: 40,
      status: 'running',
    });
    const composition = await retryLocalRemotionNavigation(() => selectComposition({
      serveUrl: renderDir,
      id: VIDEO_EDITOR_V2_REMOTION_COMPOSITION_ID,
      inputProps,
      browserExecutable,
      binariesDirectory,
    }), onRetry);

    await retryLocalRemotionNavigation(() => renderMedia({
      composition,
      serveUrl: renderDir,
      browserExecutable,
      binariesDirectory,
      codec: 'h264',
      imageFormat: 'jpeg',
      outputLocation: input.outputPath,
      // Limit simultaneous Chrome pages to keep local navigation reliable alongside the editor.
      concurrency: 2,
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
    }), onRetry);
  } finally {
    await fs.rm(renderDir, { recursive: true, force: true });
  }
}

async function renderVideoEditorV2ProjectInSpace(input: RenderVideoEditorV2ProjectInput): Promise<{
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
  if (input.renderVideo !== false && project.productVideo?.scenes.some(scene => scene.voiceoverAssetId && ['stale', 'duration-conflict'].includes(scene.voiceoverStatus || ''))) {
    throw new Error('已有配音已过期或长于镜头，请在对应镜头重新生成、移除配音或调整时长后导出');
  }
  const composition = buildVideoEditorV2RemotionComposition(project);
  if (!composition) {
    throw new Error('生成 Remotion 快照前需要先生成自动粗剪 timeline');
  }

  const renderId = `render_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const compositionPath = path.join(project.projectDir, 'remotion', 'composition.latest.json');
  const cached = input.renderVideo === false ? null : await findReusableProductVideoExport(project);
  if (cached) {
    const outputPath = ensureMp4OutputPath(String(input.outputPath || '').trim() || getDefaultOutputPath(project));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    if (path.resolve(outputPath) !== cached.sourcePath) await fs.copyFile(cached.sourcePath, outputPath);
    if (await renderedVideoSha256(outputPath) !== cached.output.outputSha256) throw new Error('缓存成片已变化，请重新导出');
    const current = await enqueueProductProjectMutation(project.id, async () => {
      const latest = await getVideoEditorV2Project(project.id);
      if (!latest || videoRenderFingerprint(latest) !== cached.output.renderFingerprint
        || latest.renderOutputs[0]?.id !== cached.output.id || latest.renderOutputs[0]?.outputSha256 !== cached.output.outputSha256
        || latest.productVideo?.scenes.some(scene => scene.voiceoverAssetId && ['stale', 'duration-conflict'].includes(scene.voiceoverStatus || ''))) {
        throw new Error('工程在复用成片期间已变化，请重新导出');
      }
      // Copying an unchanged export must not change the edit credential or revive a prior confirmation.
      return latest.status === 'exported' ? latest : saveVideoEditorV2Project({ ...latest, status: 'exported', lastError: null }, latest.updatedAt);
    });
    await writeJsonAtomic(compositionPath, composition);
    const subtitlePath = await writeTimelineSrt(current);
    await syncProductVideoTargetExport(current);
    input.onProgress?.({ projectId: project.id, stage: '复用当前成片', percent: 100, status: 'completed', outputPath });
    return { project: current, outputPath, mediaAssetId: cached.output.mediaAssetId, compositionPath, subtitlePath };
  }
  await writeJsonAtomic(compositionPath, composition);
  const subtitlePath = await writeTimelineSrt(project);
  let updatedProject = await enqueueProductProjectMutation(project.id, async () => {
    const current = await getVideoEditorV2Project(project.id);
    if (!current || videoRenderFingerprint(current) !== videoRenderFingerprint(project)) throw new Error('工程在准备导出期间已变化，请重新导出');
    return saveVideoEditorV2Project({
    ...current,
    status: input.renderVideo === false ? project.status : 'rendering',
    remotionSnapshot: {
      compositionPath,
      updatedAt: nowIso(),
    },
    lastError: null,
    });
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
      outputSha256: await renderedVideoSha256(outputPath),
      createdAt: nowIso(),
      durationMs: updatedProject.timeline.durationMs,
    };
    updatedProject = await enqueueProductProjectMutation(project.id, async () => {
      const current = await getVideoEditorV2Project(project.id);
      if (!current) throw new Error('导出工程不存在');
      const matches = videoRenderFingerprint(current) === renderOutput.renderFingerprint;
      return saveVideoEditorV2Project({ ...current, status: matches ? 'exported' : current.status,
        renderOutputs: [renderOutput, ...(current.renderOutputs || [])].slice(0, 20), lastError: matches ? null : current.lastError });
    });
    if (videoRenderFingerprint(updatedProject) === renderOutput.renderFingerprint) await syncProductVideoTargetExport(updatedProject);
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
    updatedProject = await enqueueProductProjectMutation(project.id, async () => {
      const current = await getVideoEditorV2Project(project.id);
      if (!current) throw error;
      const matches = videoRenderFingerprint(current) === videoRenderFingerprint(project);
      return saveVideoEditorV2Project({ ...current, status: matches ? 'failed' : current.status, lastError: matches ? message : current.lastError });
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

export function renderVideoEditorV2Project(input: RenderVideoEditorV2ProjectInput): ReturnType<typeof renderVideoEditorV2ProjectInSpace> {
  return runInWorkspaceSpace(getWorkspacePaths().activeSpaceId, async () => {
    const result = await renderVideoEditorV2ProjectInSpace(input);
    if (result.mediaAssetId && result.project.productVideo) await (await import('../publicationCompletionService')).recordCompletedPublication({ kind: 'video', projectId: result.project.id });
    return result;
  });
}
