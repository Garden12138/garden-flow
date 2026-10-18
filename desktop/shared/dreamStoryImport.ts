import { z } from 'zod';
import { DreamDirectorPackageSchema, type DreamDirectorPackage, type DreamFragment } from './dreamStory.ts';
const LegacyScene = z.object({ scene_id: z.number().int().min(1).max(8), duration_seconds: z.number().min(1).max(90),
    visual_zh: z.string().min(1).max(12000), voiceover_zh: z.string().max(12000), image_prompt_en: z.string().max(12000),
    image_prompt_zh: z.string().max(12000).optional(), camera_motion: z.string().max(300).optional() });
const LegacyPackage = z.object({ schema_version: z.literal('1.0'), title: z.string().min(1).max(200), story: z.string().min(1).max(12000),
    emotional_arc: z.array(z.string().min(1).max(12000)).min(1).max(12), visual_style: z.string().min(1).max(12000),
    characters: z.array(z.object({ name: z.string().max(200), description: z.string().min(1).max(12000) })).max(20), scenes: z.array(LegacyScene).length(8) });
export function parseLegacyDreamStory(raw: unknown): { director: DreamDirectorPackage; fragments: DreamFragment[]; dreamDate?: string } {
    const wrapper = z.object({ package: z.unknown().optional(), dream: z.object({ fragments: z.string().max(12000), dream_date: z.string().max(40).nullable().optional() }).optional() }).passthrough().parse(raw);
    const legacy = LegacyPackage.parse(wrapper.package || raw);
    if (new Set(legacy.scenes.map(scene => scene.scene_id)).size !== 8) throw new Error('旧导演包幕号重复');
    const fragments: DreamFragment[] = wrapper.dream?.fragments.trim() ? [{ id: 'legacy_fragment', text: wrapper.dream.fragments, locked: false }] : [];
    const characters = legacy.characters.map((character, index) => ({ id: 'legacy_character_' + (index + 1), description: `${character.name}: ${character.description}`, revision: 1, referenceAssetIds: [] }));
    return { fragments, dreamDate: wrapper.dream?.dream_date || undefined, director: DreamDirectorPackageSchema.parse({
        schemaVersion: 1, title: legacy.title, language: 'zh-CN', story: legacy.story, emotionalArc: legacy.emotional_arc,
        preservedFragmentIds: fragments.map(item => item.id), creativeAdditions: [], visualStyle: legacy.visual_style, characters,
        scenes: [...legacy.scenes].sort((a, b) => a.scene_id - b.scene_id).map(scene => ({ id: 'legacy_scene_' + scene.scene_id,
            fragmentIds: fragments.map(item => item.id), characterIds: characters.map(character => character.id), visual: scene.visual_zh,
            narration: scene.voiceover_zh, imagePrompt: scene.image_prompt_en || scene.image_prompt_zh || scene.visual_zh,
            plannedDurationMs: Math.round(scene.duration_seconds * 1000), motion: 'slow-zoom-in', locked: false })),
        publication: { description: '', hashtags: [] },
    }) };
}
