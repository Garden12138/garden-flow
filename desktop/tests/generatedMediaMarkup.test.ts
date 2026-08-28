import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeGeneratedMediaMarkup } from '../shared/generatedMediaMarkup.ts';

test('converts generated video HTML to the chat media Markdown contract', () => {
    const source = 'redbox-asset://asset//Users/example/media/generated/video.mp4';
    assert.equal(
        normalizeGeneratedMediaMarkup(`生成视频\n<video src="${source}" controls></video>`),
        `生成视频\n\n\n![generated-video](<${source}>)\n\n`,
    );
});

test('supports nested audio sources and preserves fenced HTML examples', () => {
    const audioSource = 'redbox-asset://asset//Users/example/media/generated/audio.mp3';
    assert.match(
        normalizeGeneratedMediaMarkup(`<audio controls><source src='${audioSource}'></audio>`),
        /!\[generated-audio\]\(<redbox-asset:\/\/asset\/\/Users\/example\/media\/generated\/audio\.mp3>\)/,
    );
    const fenced = '```html\n<video src="example.mp4" controls></video>\n```';
    assert.equal(normalizeGeneratedMediaMarkup(fenced), fenced);
});
