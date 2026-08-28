import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSkillsFromDir } from '../electron/core/skillLoader.ts';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('loads xhs-auto-capture from desktop electron builtin-skills', async () => {
    const skillsDir = path.join(desktopRoot, 'electron', 'builtin-skills');
    const skills = await loadSkillsFromDir(skillsDir, 'builtin');
    const skill = skills.find((item) => item.name === 'xhs-auto-capture');
    assert.ok(skill, 'expected xhs-auto-capture to be discovered');
    assert.equal(skill?.sourceScope, 'builtin');
    const body = String(skill?.body || '');
    assert.ok(body.includes('research.run'), 'skill should describe the structured research.run pipeline');
    assert.ok(body.includes('页面里的搜索框'), 'skill should describe in-page search');
    assert.ok(body.includes('capture.save'), 'skill should describe plugin capture.save');
    assert.ok(body.includes('保存笔记'), 'skill should describe the plugin save-note path');
    assert.ok(body.includes('login_required'), 'skill should describe structured login-wall stop');
    assert.ok(body.includes('entryId'), 'skill should tie completion to real knowledge entries');
});

test('xhs capture prompt describes the structured plugin pipeline', () => {
    const promptSource = fs.readFileSync(
        path.join(desktopRoot, 'electron', 'core', 'builtinAutomationTasks.ts'),
        'utf8',
    );
    assert.match(promptSource, /research\.run/);
    assert.match(promptSource, /capture\.save/);
    assert.match(promptSource, /保存笔记/);
    assert.match(promptSource, /登录墙/);
    assert.doesNotMatch(promptSource, /computer-use/i, 'builtin task definition should no longer depend on computer-use');
});
