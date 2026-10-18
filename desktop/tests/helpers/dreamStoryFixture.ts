import { randomUUID } from 'node:crypto';
import type { DreamDirectorPackage } from '../../shared/dreamStory.ts';
import { resolveDreamStoryTarget } from '../../shared/contentCreationTarget.ts';
export function dreamDirector(fragmentId: string): DreamDirectorPackage {
    return { schemaVersion: 2, settings: [{ id: 'sea', description: 'A quiet sea', referenceAssetIds: [], revision: 1 }], title: 'The Quiet Sea', language: 'en', story: 'A quiet elevator descends until a luminous key opens a door to the sea.',
        emotionalArc: ['quiet', 'wonder'], preservedFragmentIds: [fragmentId], creativeAdditions: ['The door opens slowly.'],
        visualStyle: 'Soft ink and moss green, portrait illustrations.', characters: [],
        scenes: Array.from({ length: 8 }, (_, i) => ({ id: 'scene_' + i, fragmentIds: [fragmentId], characterIds: [],
            settingId: 'sea', continuity: 'cut', mediaType: 'image', videoPrompt: 'The luminous key floats slowly above the sea',
            visual: 'A luminous key above a quiet sea.', narration: 'The sea is waiting. I keep the key.', imagePrompt: 'Portrait luminous key and quiet sea, soft ink.', plannedDurationMs: 9000, motion: 'slow-zoom-in', locked: false })),
        publication: { description: 'A quiet journey through an imagined sea.', hashtags: ['DreamStory'] } };
}
export function dreamRequest(project: any) { return { spaceId: project.dreamStory.spaceId, projectId: project.id, requestId: randomUUID(),
    expectedRevision: project.dreamStory.revision, expectedDraftEpoch: project.dreamStory.draftEpoch, targetDigest: project.dreamStory.targetDigest }; }
export async function readyDream(h: any, narration = false) {
    let project = await h.api.createDreamStory();
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'record.save', fragments: [{ id: 'remembered', text: '合成梦境：电梯、发光钥匙和海。', locked: true }] }, { type: 'target.confirm', target: resolveDreamStoryTarget({ narration, compositionMode: 'story-keyframes' }) }] });
    const candidate = await h.api.saveDreamCandidate(dreamRequest(project), dreamDirector('remembered'));
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'candidate.adopt', candidateId: candidate.id }] });
    project = await h.api.applyDreamEdit({ ...dreamRequest(project), operations: [{ type: 'story.adopt' }, { type: 'storyboard.adopt' }] });
    return project;
}
export const dreamPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
