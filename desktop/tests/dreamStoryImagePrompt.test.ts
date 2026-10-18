import test from 'node:test';
import assert from 'node:assert/strict';
import { dreamImagePrompt } from '../shared/dreamStoryImagePrompt.ts';
import { dreamDirector } from './helpers/dreamStoryFixture.ts';
import type { DreamStoryDocument } from '../shared/dreamStory.ts';
import { imagePromptBudget } from '../shared/imagePromptBudget.ts';

test('current action leads reference instructions; cut and continue have distinct spatial constraints', () => {
    const director = dreamDirector('record');
    director.characters = [{ id: 'student', description: 'Student with short hair', wardrobe: 'Blue school uniform', props: 'Exam papers, later a prize box', referenceAssetIds: [], revision: 1 }];
    const scene = { ...director.scenes[1], characterIds: ['student'], continuity: 'continue' as const, visual: 'The student stands in the aisle searching for a seat.', imagePrompt: 'Full body standing, classmates occupy all desks.' };
    const doc = { director } as DreamStoryDocument;
    const prompt = dreamImagePrompt(doc, scene, ['character:student,setting:sea,previous:scene_0']);
    assert.ok(prompt.indexOf(scene.visual) < prompt.indexOf('REFERENCE INPUTS'));
    assert.ok(prompt.includes('Image 1: character:student,setting:sea,previous:scene_0'));
    assert.ok(prompt.includes('not a pose or composition to copy'));
    assert.ok(prompt.includes('include only props needed for the current scene'));
    assert.ok(prompt.includes('same location as the immediately preceding scene'));
    assert.ok(prompt.endsWith(scene.visual));
    const cut = dreamImagePrompt(doc, { ...scene, continuity: 'cut' }, ['character:student']);
    assert.ok(cut.includes('ignore backgrounds from character reference images'));
    assert.ok(!cut.includes('CONTINUITY: same location'));
});

test('explicit scene instructions retain action, all reference roles and spatial constraints without full story inventories', () => {
    const director = dreamDirector('record');
    director.visualStyle = 'LONG_UNRELATED_STYLE '.repeat(500);
    director.characters = [{ id: 'student', description: 'STORY_WIDE_DESCRIPTION', props: 'FUTURE_PRIZE', wardrobe: 'STORY_WIDE_WARDROBE', referenceAssetIds: [], revision: 1 }];
    const scene = { ...director.scenes[2], imagePromptMode: 'scene' as const, characterIds: ['student'], continuity: 'continue' as const,
        visual: 'The student sits in the original chair on the front platform.', imagePrompt: 'Same short-haired student in a blue blazer. Muted gouache classroom, cool windows and a warm lamp. Side view with head, hands and shoes visible.',
        referenceFraming: 'new-shot' as const, spatialAnchors: [{ id: 'chair', object: 'high-backed chair', count: 1, location: 'Front platform behind teacher desk', state: 'Occupied by student, no chair in aisle' }] };
    const prompt = dreamImagePrompt({ director } as DreamStoryDocument, scene, ['character:student', 'setting:room', 'previous:scene_1']);
    for (const text of [scene.visual, scene.imagePrompt, 'Image 1: character:student', 'Image 2: setting:room', 'Image 3: previous:scene_1', 'Exactly 1 high-backed chair', scene.spatialAnchors[0].location, scene.spatialAnchors[0].state, 'objects stay in their original positions', 'Same location; advance']) assert.ok(prompt.includes(text));
    assert.ok(!/LONG_UNRELATED_STYLE|STORY_WIDE|FUTURE_PRIZE/.test(prompt));
    const budget = imagePromptBudget('dashscope-wan-native', 'qwen-image-2.0-pro', prompt)!;
    assert.ok(budget.estimatedTokens <= budget.safeTokens);
    const context = dreamImagePrompt({ director } as DreamStoryDocument, { ...scene, imagePromptMode: undefined }, []);
    assert.ok(context.includes(director.visualStyle)); // No automatic shortening of existing scenes.
    const cut = dreamImagePrompt({ director } as DreamStoryDocument, { ...scene, continuity: 'cut' }, ['character:student']);
    assert.ok(cut.includes('Scene cut: use the current location; ignore old reference backgrounds'));
});


test('new camera shots preserve the existing object count, position and current occupancy', () => {
    const director = dreamDirector('record');
    const scene = { ...director.scenes[2], referenceFraming: 'new-shot' as const, spatialAnchors: [{ id: 'chair', object: 'high-backed invigilator chair', count: 1, location: 'On the front platform behind the teacher desk', state: 'Occupied by the student; no chair in the aisle' }] };
    const prompt = dreamImagePrompt({ director } as DreamStoryDocument, scene, ['character:student', 'setting:classroom', 'previous:scene_1']);
    assert.ok(prompt.includes('exactly 1 high-backed invigilator chair'));
    assert.ok(prompt.includes(scene.spatialAnchors[0].location));
    assert.ok(prompt.includes(scene.spatialAnchors[0].state));
    assert.ok(prompt.includes('same existing objects, not additional copies'));
    assert.ok(prompt.includes('CAMERA: establish a new camera shot'));
    assert.ok(prompt.indexOf('SPATIAL CONSTRAINTS') < prompt.indexOf('REFERENCE INPUTS'));
});
