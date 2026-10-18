import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import createArchive from 'archiver';
import { randomUUID } from 'node:crypto';
import { getWorkspacePaths, getTikTokVideoVersionByProject } from '../db';
import { parseLegacyDreamStory } from '../../shared/dreamStoryImport';
import { dreamShareDocument, dreamMarkdown, dreamSrt } from '../../shared/dreamStoryExport';
import { createDreamStory, readDreamStory, dreamDigest, persistDreamProject, dreamLock } from './dreamStoryStore';
import { listVideoEditorV2Projects } from './video-editor-v2/videoEditorV2ProjectStore';
import { isPathWithinRoots } from './localAssetManager';
import { currentDreamExport } from './dreamStoryRenderService';

const imports = new Map<string, { spaceId: string; digest: string; data: ReturnType<typeof parseLegacyDreamStory>; createdAt: number }>();
export async function previewDreamImport(file: string) {
    const stat = await fs.stat(file); if (!stat.isFile() || stat.size > 5_000_000) throw new Error('请选择不超过 5 MB 的导演包 JSON');
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')); const data = parseLegacyDreamStory(parsed);
    const digest = dreamDigest(data); const id = 'import_' + randomUUID();
    for (const [key, item] of imports) if (Date.now() - item.createdAt > 1800000) imports.delete(key);
    imports.set(id, { spaceId: getWorkspacePaths().activeSpaceId, digest, data, createdAt: Date.now() });
    return { id, title: data.director.title, sceneCount: 8, language: 'zh-CN', hasOriginal: Boolean(data.fragments.length), missing: ['尚未确认 TikTok 目标', '八幕画面与声音需要手动导入并核对'], scenes: data.director.scenes.map(scene => ({ id: scene.id, visual: scene.visual })) };
}
export async function confirmDreamImport(id: string) {
    const item = imports.get(id); if (!item || item.spaceId !== getWorkspacePaths().activeSpaceId || Date.now() - item.createdAt > 1800000) throw new Error('导入预览已失效');
    return dreamLock(item.spaceId, 'legacy_import_' + item.digest, async () => {
        const existing = (await listVideoEditorV2Projects()).find(project => project.dreamStory?.provenance?.digest === item.digest);
        if (existing) return existing;
        const created = await createDreamStory(item.data.director.title); const project = await readDreamStory(created.id);
        project.version = 3; project.dreamStory!.schemaVersion = 1;
        Object.assign(project.dreamStory, { director: item.data.director, fragments: item.data.fragments, dreamDate: item.data.dreamDate,
            stage: 'story', provenance: { kind: 'legacy-director-package', digest: item.digest } });
        return persistDreamProject(project);
    });
}
export async function exportDreamStory(projectId: string, file: string, format: 'json' | 'markdown' | 'srt' | 'mp4' | 'share' | 'backup', includePrivate = false): Promise<void> {
    const project = await readDreamStory(projectId); const doc = structuredClone(project.dreamStory);
    const publication = getTikTokVideoVersionByProject(projectId);
    if (doc.director && publication?.source?.kind === 'dream-story') doc.director.publication = { description: publication.description, hashtags: publication.hashtags };
    if (doc.dirty) throw new Error('请先保存当前输入');
    if (format === 'json') { await fs.writeFile(file, JSON.stringify(dreamShareDocument(doc), null, 2)); return; }
    if (format === 'markdown') { await fs.writeFile(file, dreamMarkdown(doc)); return; }
    if (format === 'srt') { await fs.writeFile(file, dreamSrt(project)); return; }
    if (format === 'mp4') { const checked = await currentDreamExport(projectId); if (path.resolve(file) !== path.resolve(checked.output.path)) await fs.copyFile(checked.output.path, file); return; }
    const root = await fs.realpath(project.projectDir);
    const archive = createArchive('zip', { zlib: { level: 9 } });
    const output = createWriteStream(file);
    const done = new Promise<void>((resolve, reject) => { output.on('close', resolve); output.on('error', reject); archive.on('error', reject); });
    archive.pipe(output);
    archive.append(JSON.stringify(dreamShareDocument(doc), null, 2), { name: 'director.json' });
    archive.append(dreamMarkdown(doc), { name: 'story.md' }); archive.append(dreamSrt(project), { name: 'subtitles.srt' });
    // Backups opt into private authoring fields; provider requests, jobs and credentials are never archived.
    if (includePrivate) archive.append(JSON.stringify({ fragments: doc.fragments, director: doc.director, versions: format === 'backup' ? doc.versions : undefined }, null, 2), { name: 'private-authoring.json' });
    const ids = format === 'backup' ? project.assets.map(asset => asset.id) : [...new Set(Object.values(doc.media).flatMap(binding => [binding.image?.assetId, binding.audio?.assetId, binding.video?.assetId]).concat(doc.musicAssetId, ...(includePrivate ? doc.director?.characters.flatMap(item => item.referenceAssetIds) || [] : []), ...(includePrivate ? doc.director?.settings?.flatMap(item => item.referenceAssetIds) || [] : [])).filter((id): id is string => Boolean(id)))];
    const manifest = [];
    for (const id of ids) {
        const asset = project.assets.find(item => item.id === id); if (!asset) continue;
        const real = await fs.realpath(asset.projectPath); if (!isPathWithinRoots(real, [root])) throw new Error('归档素材越出工程');
        const name = `media/${asset.id}${path.extname(real)}`; archive.file(real, { name }); manifest.push({ id: asset.id, kind: asset.kind, path: name });
    }
    const current = await currentDreamExport(projectId).catch(() => null);
    if (current) archive.file(current.output.path, { name: 'video.mp4' });
    archive.append(JSON.stringify({ schemaVersion: 1, assets: manifest }), { name: 'manifest.json' });
    if (format === 'backup') archive.append(JSON.stringify({ schemaVersion: 1, purpose: 'dream-story-backup', projectKind: 'dream-story',
        title: project.title, target: doc.target, stage: doc.stage, storyAdopted: doc.storyAdopted, storyboardAdopted: doc.storyboardAdopted,
        director: includePrivate ? doc.director : dreamShareDocument(doc), fragments: includePrivate ? doc.fragments : undefined,
        versions: includePrivate ? doc.versions : undefined, media: doc.media, assets: manifest,
        musicAssetId: doc.musicAssetId, musicVolume: doc.musicVolume, voiceVolume: doc.voiceVolume, captions: doc.captions,
        omitted: includePrivate ? ['credentials', 'providerRequests'] : ['rawDreams', 'privatePrompts', 'history', 'credentials', 'providerRequests'] }, null, 2), { name: 'backup.json' });
    await archive.finalize(); await done;
}
