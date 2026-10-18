import type { DreamScene, DreamStoryDocument } from './dreamStory';

export const DREAM_IMAGE_PROMPT_VERSION = 5;

/** References constrain continuity; the scene remains authoritative for action and framing. */
export function dreamImagePrompt(document: DreamStoryDocument, scene: DreamScene, roles: string[]): string {
    if (scene.imagePromptMode === 'scene') return [
        'Create one full-frame 9:16 keyframe. Current action takes priority over reference poses.',
        `CURRENT SCENE\n${scene.visual}\n${scene.imagePrompt}`,
        ...(scene.spatialAnchors?.length ? [`SPATIAL CONSTRAINTS\n${scene.spatialAnchors.map(anchor => `Exactly ${anchor.count} ${anchor.object}; location: ${anchor.location}; state: ${anchor.state}.`).join('\n')}\nUse these existing objects; do not add duplicates.`] : []),
        scene.referenceFraming === 'new-shot' ? 'CAMERA: new shot of the same location; objects stay in their original positions.' : 'CAMERA: preserve the established spatial layout.',
        `REFERENCES\n${roles.length ? roles.map((role, index) => `Image ${index + 1}: ${role}`).join('\n') : 'None.'}`,
        scene.imageReferenceMode === 'previous' ? 'Edit Image 1 into the current moment. Preserve its student identity, wardrobe, classroom, lighting and painting style. Change the action and camera as directed; do not copy the previous pose.' : 'Character refs: identity and wardrobe. Setting refs: architecture and lighting. Previous frame: continuity, not a pose to copy.',
        scene.continuity === 'continue' ? 'Same location; advance to the current action.' : 'Scene cut: use the current location; ignore old reference backgrounds, retain identity and style.',
        'Complete head and body unless deliberately cropped. No panels, text or logos. At 1080x1920 keep key subjects inside top120/right144/bottom320/left72.',
    ].join('\n\n');
    const director = document.director!;
    const setting = director.settings?.find(item => item.id === scene.settingId);
    const characters = director.characters.filter(character => scene.characterIds.includes(character.id));
    return [
        'Create one new storyboard keyframe for the CURRENT SCENE below. Its action, pose, props and camera framing take priority over reference-image composition.',
        `CURRENT SCENE\n${scene.visual}\n${scene.imagePrompt}`,
        ...(scene.spatialAnchors?.length ? [`SPATIAL CONSTRAINTS\n${scene.spatialAnchors.map(anchor => `${anchor.id}: exactly ${anchor.count} ${anchor.object}; location: ${anchor.location}; current state: ${anchor.state}.`).join('\n')}\nThese are the same existing objects, not additional copies. Do not leave the original object unchanged and add a duplicate elsewhere.`] : []),
        scene.referenceFraming === 'new-shot' ? 'CAMERA: establish a new camera shot of the SAME existing location and objects. Do not paste a new subject or duplicate furniture into the old full-frame composition. The location constraints remain binding when the camera moves.' : 'CAMERA: keep the established spatial layout unless the current scene explicitly requests another view.',
        `REFERENCE INPUTS\n${roles.length ? roles.map((role, index) => `Image ${index + 1}: ${role}`).join('\n') : 'No reference images.'}`,
        'Character references preserve identity, body proportions, hairstyle and applicable wardrobe. Setting references preserve architecture, layout, lighting and palette. Previous-scene references establish continuity, not a pose or composition to copy. Create the current action from a suitable camera view; do not merely restyle the previous image.',
        scene.continuity === 'continue'
            ? 'CONTINUITY: same location as the immediately preceding scene. Keep its spatial logic while advancing to the current story moment. Do not carry over an earlier action or temporary prop unless the current scene calls for it.'
            : 'CONTINUITY: scene cut. Establish the current location below; ignore backgrounds from character reference images that belong to other locations. Retain character identity and visual style.',
        `CURRENT LOCATION\n${setting?.description || 'Use the location described in the current scene.'}`,
        `VISUAL STYLE\n${director.visualStyle}`,
        ...characters.map(character => `CHARACTER ${character.id}\n${character.description}\nWardrobe: ${character.wardrobe || 'As described in the current scene.'}\nProp inventory: ${character.props || 'None specified.'}\nThis inventory spans the story: include only props needed for the current scene, never all inventory items at once.`),
        'Anonymity means simplified or stylized facial detail, not missing heads or body parts. Single full-frame composition, no panels, no readable text or logos. 9:16 portrait; keep important subjects inside top 120, right 144, bottom 320, left 72 insets on a 1080x1920 canvas.',
        `FINAL ACTION CHECK\nThe image must show this new moment: ${scene.visual}`,
    ].join('\n\n');
}
