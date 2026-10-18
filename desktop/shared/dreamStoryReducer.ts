import { dreamCanonical, validateDreamDirector, type DreamStoryDocument, type DreamEditOperation, type DreamStoryVersion } from './dreamStory.ts';

export function dreamVersion(doc: DreamStoryDocument, id: string, label: string, createdAt: string): DreamStoryVersion {
    return structuredClone({ id, label, createdAt, director: doc.director, target: doc.target, fragments: doc.fragments,
        media: doc.media, musicAssetId: doc.musicAssetId, musicVolume: doc.musicVolume, voiceVolume: doc.voiceVolume,
        captions: doc.captions, style: doc.style, dreamDate: doc.dreamDate, emotion: doc.emotion,
        storyAdopted: doc.storyAdopted, storyboardAdopted: doc.storyboardAdopted, stage: doc.stage });
}

export function reduceDreamStory(source: DreamStoryDocument, operations: DreamEditOperation[], versionId: string, now: string): DreamStoryDocument {
    const doc = structuredClone(source);
    const before = dreamVersion(source, versionId, '修改前', now);
    for (const op of operations) {
        if (op.type === 'record.save') {
            for (const fragment of doc.fragments.filter(item => item.locked)) {
                const next = op.fragments.find(item => item.id === fragment.id);
                if ((!next || next.text !== fragment.text) && next?.locked !== false) throw new Error('请先解锁原始片段再修改或删除');
            }
            if (new Set(op.fragments.map(item => item.id)).size !== op.fragments.length) throw new Error('片段 ID 重复');
            doc.fragments = op.fragments; doc.dreamDate = op.dreamDate; doc.emotion = op.emotion;
            if (op.style !== undefined) doc.style = op.style;
            if (doc.director) doc.recordReviewRequired = true;
        } else if (op.type === 'target.confirm') {
            if (doc.target && (doc.target.language !== op.target.language || doc.target.market !== op.target.market)) throw new Error('语言或市场变化需要创建独立目标版本');
            if (doc.target && doc.target.compositionMode !== op.target.compositionMode) throw new Error('制作模式变化需要创建独立目标版本');
            doc.target = op.target;
            if (doc.director && doc.director.language !== op.target.language) { doc.storyAdopted = false; doc.storyboardAdopted = false; doc.stage = 'story'; }
        } else if (op.type === 'candidate.adopt') {
            const candidate = doc.candidates.find(item => item.id === op.candidateId);
            if (!candidate || candidate.targetDigest !== doc.targetDigest) throw new Error('候选目标已变化，请重新规划');
            if (candidate.basedOnRevision !== source.revision || candidate.draftEpoch !== source.draftEpoch) throw new Error('候选生成期间内容已变化，请基于当前内容重新规划');
            const next = validateDreamDirector(candidate.director, doc.fragments, doc.target);
            for (const locked of doc.director?.scenes.filter(scene => scene.locked) || []) {
                if (dreamCanonical(next.scenes.find(scene => scene.id === locked.id)) !== dreamCanonical(locked)) throw new Error('候选修改了锁定分镜，请先解锁');
            }
            candidate.adoptedAt = now;
            doc.director = next; doc.storyAdopted = false; doc.storyboardAdopted = false;
            doc.storySyncRequired = false; doc.recordReviewRequired = false; doc.stage = 'story';
        } else if (op.type === 'story.update') {
            if (!doc.director) throw new Error('请先生成故事');
            doc.director.story = op.story; doc.storyAdopted = false; doc.storySyncRequired = true;
        } else if (op.type === 'director.update') {
            if (!doc.director) throw new Error('请先采用导演包');
            if (doc.director.scenes.some(scene => scene.locked) && ((op.visualStyle && op.visualStyle !== doc.director.visualStyle) || (op.characters && dreamCanonical(op.characters) !== dreamCanonical(doc.director.characters)) || (op.settings && dreamCanonical(op.settings) !== dreamCanonical(doc.director.settings)))) throw new Error('设定影响锁定分镜，请先解锁相关分镜');
            if (op.title !== undefined) doc.director.title = op.title;
            if (op.visualStyle !== undefined) doc.director.visualStyle = op.visualStyle;
            if (op.characters !== undefined) doc.director.characters = op.characters;
            if (op.settings !== undefined) doc.director.settings = op.settings;
            doc.storyboardAdopted = false;
        } else if (op.type === 'reference.bind') {
            if (doc.director?.scenes.some(scene => scene.locked && (op.ownerKind === 'character' ? scene.characterIds.includes(op.ownerId) : scene.settingId === op.ownerId))) throw new Error('请先解锁受影响分镜');
            const owner = op.ownerKind === 'character' ? doc.director?.characters.find(item => item.id === op.ownerId) : doc.director?.settings?.find(item => item.id === op.ownerId);
            if (!owner) throw new Error('参考对象不存在');
            if (Object.keys(op.crops || {}).some(id => !op.assetIds.includes(id))) throw new Error('裁切参考不属于此对象');
            owner.referenceAssetIds = [...new Set(op.assetIds)];
            const crops = Object.fromEntries(Object.entries(op.crops ?? owner.referenceCrops ?? {}).filter(([id]) => op.assetIds.includes(id)));
            if (Object.keys(crops).length) owner.referenceCrops = crops; else delete owner.referenceCrops;
            owner.revision++;
        } else if (op.type === 'publication.copy') {
            if (!doc.director) throw new Error('请先采用导演包');
            if ([op.description, op.hashtags.map(tag => '#' + tag).join(' ')].join('\n').length > 4000) throw new Error('TikTok 文案与话题合计最多 4000 字符');
            doc.director.publication = { description: op.description, hashtags: op.hashtags };
        } else if (op.type === 'scene.update') {
            const scene = doc.director?.scenes.find(item => item.id === op.sceneId);
            if (!scene) throw new Error('分镜不存在');
            if (scene.locked && (Object.keys(op.changes).length !== 1 || op.changes.locked !== false)) throw new Error('请先解锁分镜');
            Object.assign(scene, op.changes); doc.storyboardAdopted = false; doc.captions = undefined;
        } else if (op.type === 'scene.order') {
            const scenes = doc.director?.scenes;
            if (!scenes || new Set(op.sceneIds).size !== 8 || op.sceneIds.some(id => !scenes.some(scene => scene.id === id))) throw new Error('分镜顺序必须包含八个原有 ID');
            doc.director!.scenes = op.sceneIds.map(id => scenes.find(scene => scene.id === id)!); doc.captions = undefined;
        } else if (op.type === 'story.adopt' || op.type === 'storyboard.adopt') {
            if (!doc.target || !doc.director) throw new Error('请先确认目标并采用导演包');
            validateDreamDirector(doc.director, doc.fragments, doc.target);
            if (op.type === 'story.adopt') { doc.storyAdopted = true; doc.recordReviewRequired = false; doc.stage = 'storyboard'; }
            else {
                if (!doc.storyAdopted) throw new Error('请先采用故事');
                doc.storyboardAdopted = true; doc.storySyncRequired = false; doc.stage = 'media';
            }
            doc.versions.push(dreamVersion(doc, versionId + '_' + doc.versions.length, op.type === 'story.adopt' ? '采用故事' : '采用分镜', now));
        } else if (op.type === 'undo' || op.type === 'version.restore') {
            const version = op.type === 'undo' ? doc.undo.pop() : doc.versions.find(item => item.id === op.versionId);
            if (!version) throw new Error('没有可恢复的版本');
            doc.director = structuredClone(version.director); doc.fragments = structuredClone(version.fragments);
            doc.target = structuredClone(version.target); doc.storyAdopted = false; doc.storyboardAdopted = false;
            doc.stage = doc.director ? 'story' : 'record'; doc.captions = undefined;
            if (version.media) doc.media = structuredClone(version.media);
            if (op.type === 'undo') {
                doc.musicAssetId = version.musicAssetId; doc.musicVolume = version.musicVolume ?? doc.musicVolume; doc.voiceVolume = version.voiceVolume ?? doc.voiceVolume;
                doc.captions = structuredClone(version.captions); doc.style = version.style ?? doc.style; doc.dreamDate = version.dreamDate; doc.emotion = version.emotion;
                doc.storyAdopted = version.storyAdopted ?? false; doc.storyboardAdopted = version.storyboardAdopted ?? false; doc.stage = version.stage || doc.stage;
            }
        } else if (op.type === 'mix.update') { doc.musicVolume = op.musicVolume; doc.voiceVolume = op.voiceVolume; }
        else if (op.type === 'music.remove') { doc.musicAssetId = undefined; }
        else if (op.type === 'captions.update') { doc.captions = op.captions.map(cue => ({ sceneId: cue.sceneId!, text: cue.text!, startMs: cue.startMs!, endMs: cue.endMs! })); }
    }
    if (!operations.some(op => op.type === 'undo')) doc.undo = [...doc.undo, before].slice(-20);
    doc.versions = doc.versions.slice(-100);
    return doc;
}
