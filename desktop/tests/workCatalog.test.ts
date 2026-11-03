// Run: pnpm --dir desktop exec node --test tests/workCatalog.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeWorkCatalog, type WorkCatalogItem } from '../shared/workCatalog.ts';
import { bindMetricCsvToPublication, parseMetricCsv } from '../shared/metricCsv.ts';
const item = (id: string, nativeKey?: string): WorkCatalogItem => ({ id, title: id, kind: 'note-image', updatedAt: '2026-10-25T00:00:00Z', availability: 'ready', target: { kind: 'workspace', id }, nativeKey });

test('registered workspaces replace their native duplicate while independent legacy files remain', () => {
    const registered = { ...item('work', 'note:project.redpost'), updatedAt: '2026-10-25T01:00:00Z' };
    const catalog = mergeWorkCatalog([registered], [item('old-native', 'note:project.redpost'), item('legacy', 'note:legacy.md'), item('video', 'video:video_1')]);
    assert.deepEqual(catalog.map(work => work.id), ['work', 'legacy', 'video']);
    assert.equal(catalog[0], registered);
});
test('missing and corrupt records stay visible; unreadable registrations never hide a readable legacy work', () => {
    const missing = { ...item('missing', 'video:missing'), availability: 'missing' as const, issue: '文件缺失' };
    const corrupt = { ...item('corrupt', 'note:legacy'), availability: 'unreadable' as const };
    assert.deepEqual(mergeWorkCatalog([missing, corrupt], [item('legacy', 'note:legacy')]).map(work => work.id), ['missing', 'corrupt', 'legacy']);
});
test('publication selection fills only empty CSV associations and preserves quoted multiline fields', () => {
    const result = bindMetricCsvToPublication('metric,sourceNote,publicationLinkId\nlikes,"说明,含逗号\n和换行",\nviews,已有行,other', 'publicationLinkId', 'chosen');
    assert.deepEqual(parseMetricCsv(result), [['metric', 'sourceNote', 'publicationLinkId'], ['likes', '说明,含逗号\n和换行', 'chosen'], ['views', '已有行', 'other']]);
    assert.deepEqual(parseMetricCsv(bindMetricCsvToPublication('metric,value\nlikes,12', 'publicationLinkId', 'chosen')), [['metric', 'value', 'publicationLinkId'], ['likes', '12', 'chosen']]);
    assert.throws(() => bindMetricCsvToPublication('metric,metric\nlikes,12', 'publicationLinkId', 'chosen'), /标题/);
    assert.throws(() => bindMetricCsvToPublication('metric\n"unfinished', 'publicationLinkId', 'chosen'), /引号/);
});
