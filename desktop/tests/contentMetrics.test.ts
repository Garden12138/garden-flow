import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MetricCsvFields, MetricInputSchema, MetricWindowSchema, ManualPublicationLinkSchema, PublicationLinkSchema, ExternalPublicationLinkSchema, type MetricInput, type PublicationLink, type MetricObservation } from '../shared/contentExperiments.ts';
import { ciDigest, initializeContentIntelligence } from '../electron/core/content-intelligence/repository.ts';
import { initializeContentMetrics, createContentMetricsRepository, deleteContentMetricsSpace } from '../electron/core/content-intelligence/metricsRepository.ts';
import { parseMetricCsv, readMetricCsv, compareMetricObservations, metricCsvTemplate } from '../electron/core/content-intelligence/metricsDomain.ts';
import { canonicalPublicationUrl, publicationForWorkspace, createContentMetricsService } from '../electron/core/content-intelligence/metricsService.ts';
import type { CreationWorkspace } from '../shared/creationWorkspace.ts';
import type { PublicationJobView } from '../shared/publication.ts';

const mapping = Object.fromEntries(MetricCsvFields.map(key => [key, key]));
const start = Date.parse('2026-10-01T00:00:00Z');
const input = (id = 'pub-one', value = 10): MetricInput => ({ publicationLinkId: id, metric: { key: 'likes', unit: 'count', definition: '观察窗口内新增点赞次数，平台后台导出' },
    value, window: { startAt: start, endAt: start + 86400000, timeZone: 'Asia/Shanghai', alignment: 'calendar' }, observedAt: start + 86400000, confounders: [], sourceNote: '合成测试观测，不是真实业绩' });
const csv = (items: MetricInput[]) => metricCsvTemplate + items.map(value => [value.publicationLinkId, value.metric.key, value.metric.definition, value.metric.unit, value.value,
    new Date(value.window.startAt).toISOString(), new Date(value.window.endAt).toISOString(), value.window.timeZone, value.window.alignment,
    value.window.ageStartMs === undefined ? '' : value.window.ageStartMs / 3600000, value.window.ageEndMs === undefined ? '' : value.window.ageEndMs / 3600000,
    value.confounders.join('|'), value.sourceNote, value.observedAt === undefined ? '' : new Date(value.observedAt).toISOString()].map(cell => '"' + String(cell).replaceAll('"', '""') + '"').join(',')).join('\r\n');
const linkInput = (workspaceId = 'work-one', externalWorkId = '100') => ({ workspaceId, workspaceRevision: 'rev-one', platform: 'tiktok' as const,
    accountAlias: 'test-alias', externalWorkId, origin: 'manual' as const, status: 'declared-published' as const, sourceNote: '合成测试手工声明，不是真实发布', observedAt: start });
function fixture(t: any) {
    const db = new DatabaseSync(':memory:'); t.after(() => db.close());
    db.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY); INSERT INTO spaces VALUES ('a'), ('中文空间'); CREATE TABLE legacy_work(id TEXT); INSERT INTO legacy_work VALUES ('unchanged');");
    initializeContentIntelligence(db); initializeContentMetrics(db); initializeContentMetrics(db);
    let space = 'a'; const repo = createContentMetricsRepository(db, () => space);
    return { db, repo, switch: (value: string) => { space = value; } };
}
function importRows(repo: ReturnType<typeof createContentMetricsRepository>, items: MetricInput[], requestId = 'one') {
    const payload = { csv: csv(items), mapping }; const preview = repo.preview(payload);
    return repo.importCsv({ ...payload, requestId, previewDigest: preview.digest, confirmed: true, reviseConflicts: false });
}
test('metric schemas reject malicious fields, invalid windows, decimals for counts, unsafe values and invalid zones', () => {
    assert.equal(MetricInputSchema.parse(input()).value, 10);
    for (const value of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(MetricInputSchema.safeParse({ ...input(), value }).success, false);
    assert.equal(MetricInputSchema.safeParse({ ...input(), metric: { ...input().metric, unit: 'ratio' }, value: 1.1 }).success, false);
    assert.equal(MetricInputSchema.safeParse({ ...input(), spaceId: 'other' }).success, false);
    assert.equal(MetricWindowSchema.safeParse({ ...input().window, endAt: start }).success, false);
    assert.equal(MetricWindowSchema.safeParse({ ...input().window, timeZone: 'wrong' }).success, false);
    assert.equal(MetricWindowSchema.safeParse({ ...input().window, alignment: 'post-age' }).success, false);
    assert.equal(MetricWindowSchema.safeParse({ ...input().window, ageStartMs: 0 }).success, false);
    assert.equal(MetricWindowSchema.safeParse({ ...input().window, alignment: 'post-age', ageStartMs: 0, ageEndMs: 86400000 }).success, true);
    assert.equal(ManualPublicationLinkSchema.safeParse({ ...linkInput(), expectedRevision: 'rev-one', requestId: 'one', origin: 'receipt', sourceNote: 'x' }).success, false);
});
test('CSV mapping, quoted commas/newlines, BOM and exact values are parsed without formula evaluation', () => {
    const value = { ...input(), sourceNote: '合成 "引用",含逗号\n第二行', confounders: ['付费流量未知', '发布时间不同'] };
    assert.deepEqual(readMetricCsv({ csv: '\uFEFF' + csv([value]), mapping }).rows[0].input, value);
    const mapped = { ...mapping, value: '数值' }; const renamed = csv([value]).replace(',value,', ',数值,');
    assert.equal(readMetricCsv({ csv: renamed, mapping: mapped }).rows[0].input?.value, 10);
    const formula = csv([input()]).replace('"10"', '"=1+9"'); assert.ok(readMetricCsv({ csv: formula, mapping }).rows[0].error);
    assert.ok(readMetricCsv({ csv: csv([input()]).replace('2026-10-01T00:00:00.000Z', '2026-10-01 00:00:00'), mapping }).rows[0].error);
    assert.ok(readMetricCsv({ csv: csv([input()]).replace('2026-10-01T00:00:00.000Z', '2026-02-31T00:00:00.000Z'), mapping }).rows[0].error);
    assert.ok(readMetricCsv({ csv: csv([input()]).replace('2026-10-01T00:00:00.000Z', '2026-10-01T08:00:00.000+08:00'), mapping }).rows[0].input);
    for (const value of ['a,a\nx,y', 'a,b\n"x"oops,y', 'a\n"unclosed']) assert.throws(() => value.startsWith('a,a') ? readMetricCsv({ csv: value, mapping }) : parseMetricCsv(value));
    assert.throws(() => parseMetricCsv('x'.repeat(1000001)));
    assert.throws(() => parseMetricCsv('a\n' + 'b\n'.repeat(1001)));
    assert.throws(() => readMetricCsv({ csv: csv([input()]), mapping: { ...mapping, value: 'unit' } }));
});
test('additive migration preserves legacy data; preview is read-only; confirmed imports are atomic and idempotent', t => {
    const h = fixture(t); const link = h.repo.recordPublication(linkInput()); assert.deepEqual(h.repo.recordPublication(linkInput()), link);
    const row = input(link.id); const payload = { csv: csv([row, row]), mapping }; const preview = h.repo.preview(payload);
    assert.deepEqual(preview.rows.map(row => row.status), ['new', 'duplicate']); assert.equal(h.repo.observations().length, 0);
    const confirmed = { ...payload, requestId: 'import', previewDigest: preview.digest, confirmed: true, reviseConflicts: false };
    assert.throws(() => h.repo.importCsv({ ...confirmed, confirmed: false }));
    const result = h.repo.importCsv(confirmed); assert.equal(result.changed.length, 1); assert.equal(result.duplicates, 1);
    assert.deepEqual(h.repo.importCsv(confirmed), result); assert.equal(h.repo.observations().length, 1);
    assert.throws(() => h.repo.importCsv({ ...confirmed, csv: csv([input(link.id, 11)]) }), /同一请求/);
    assert.equal(h.repo.preview({ csv: csv([row]), mapping }).rows[0].status, 'duplicate');
    assert.equal(h.db.prepare('SELECT id FROM legacy_work').get()!.id, 'unchanged');
    initializeContentMetrics(h.db); assert.equal(h.repo.observations().length, 1);
});
test('disk database reopens with observation audit intact and legacy rows untouched', t => {
    const directory = mkdtempSync(path.join(tmpdir(), 'gardenflow-metrics-'));
    const file = path.join(directory, 'legacy.db'); let db = new DatabaseSync(file);
    t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
    db.exec("CREATE TABLE spaces(id TEXT PRIMARY KEY); INSERT INTO spaces VALUES ('a'); CREATE TABLE legacy_work(id TEXT); INSERT INTO legacy_work VALUES ('old');");
    initializeContentIntelligence(db); initializeContentMetrics(db); let repo = createContentMetricsRepository(db, () => 'a');
    const link = repo.recordPublication(linkInput()); const original = importRows(repo, [input(link.id)]).changed[0]; db.close();
    db = new DatabaseSync(file); initializeContentIntelligence(db); initializeContentMetrics(db); repo = createContentMetricsRepository(db, () => 'a');
    assert.deepEqual(repo.observation(original.id), original); assert.deepEqual(repo.publication(link.id), link); assert.equal(db.prepare('SELECT id FROM legacy_work').get()!.id, 'old');
});
test('conflicts require a current preview and explicit revision confirmation; all prior values remain auditable', t => {
    const h = fixture(t); const link = h.repo.recordPublication(linkInput()); const original = importRows(h.repo, [input(link.id)]).changed[0];
    const payload = { csv: csv([input(link.id, 20)]), mapping }; const preview = h.repo.preview(payload); assert.equal(preview.rows[0].status, 'conflict');
    const request = { ...payload, requestId: 'revise', previewDigest: preview.digest, confirmed: true, reviseConflicts: false };
    assert.throws(() => h.repo.importCsv(request), /审计版本/); assert.equal(h.repo.observation(original.id).revision, 1);
    const revised = h.repo.importCsv({ ...request, reviseConflicts: true }).changed[0]; assert.equal(revised.revision, 2);
    assert.equal(h.repo.history(original.id).length, 2); assert.equal(h.repo.observation(original.id, 1).input.value, 10);
    assert.throws(() => h.repo.importCsv({ ...request, requestId: 'stale', reviseConflicts: true }), /预览/);
    const mixed = { csv: csv([input(link.id, 25), input('missing')]), mapping }; const invalid = h.repo.preview(mixed);
    assert.ok(invalid.rows.some(row => row.status === 'error'));
    assert.throws(() => h.repo.importCsv({ ...mixed, requestId: 'atomic', previewDigest: invalid.digest, confirmed: true, reviseConflicts: true }), /错误行/);
    assert.equal(h.repo.history(original.id).length, 2);
    const duplicates = h.repo.preview({ csv: csv([input(link.id, 30), input(link.id, 40), input(link.id, 30)]), mapping });
    assert.ok(duplicates.rows.every(row => row.status === 'error'));
});
test('publication and observation lookup, imports, history and cleanup are strictly space scoped', t => {
    const h = fixture(t); const link = h.repo.recordPublication(linkInput()); const first = importRows(h.repo, [input(link.id)]).changed[0]; h.switch('中文空间');
    assert.deepEqual(h.repo.publications(), []); assert.deepEqual(h.repo.observations(), []);
    assert.throws(() => h.repo.publication(link.id), /当前空间/); assert.throws(() => h.repo.history(first.id), /当前空间/);
    assert.equal(h.repo.preview({ csv: csv([input(link.id)]), mapping }).rows[0].status, 'error');
    const other = h.repo.recordPublication(linkInput()); importRows(h.repo, [input(other.id)]);
    deleteContentMetricsSpace(h.db, 'a'); assert.equal(h.repo.observations().length, 1); h.switch('a'); assert.deepEqual(h.repo.publications(), []);
    h.switch('missing'); assert.throws(() => h.repo.observations(), /空间不存在/);
});
test('deterministic comparisons refuse incompatible observations and zero denominators return N/A', () => {
    const makeLink = (id: string, ext: string): PublicationLink => ({ ...linkInput('work-' + id, ext), id, spaceId: 'a', createdAt: 1 });
    const a = makeLink('a', '1'); const b = makeLink('b', '2');
    const makeObs = (id: string, value: number): MetricObservation => ({ id: 'obs-' + id, spaceId: 'a', revision: 1, input: input(id, value), importDigest: ciDigest('synthetic'), recordedAt: 1 });
    const base = makeObs('a', 10); const next = makeObs('b', 15);
    assert.equal(compareMetricObservations(base, next, a, b).relativeChange, .5);
    assert.equal(compareMetricObservations(makeObs('a', 0), next, a, b).relativeChange, null);
    assert.equal(compareMetricObservations({ ...base, input: { ...base.input, observedAt: undefined } }, next, a, b).interpretation, 'insufficient');
    assert.equal(compareMetricObservations({ ...base, input: { ...base.input, observedAt: start } }, next, a, b).comparable, false);
    for (const changed of [{ ...b, platform: 'douyin' as const }, { ...b, accountAlias: 'different' }, { ...b, spaceId: 'different' }, { ...b, externalWorkId: '1' }]) {
        const result = compareMetricObservations(base, next, a, changed); assert.equal(result.comparable, false); assert.equal(result.difference, null); assert.equal(result.interpretation, 'insufficient');
    }
    for (const changed of [{ ...next.input, metric: { ...next.input.metric, definition: '不同口径' } }, { ...next.input, window: { ...next.input.window, endAt: start + 3600000 } }, { ...next.input, window: { ...next.input.window, timeZone: 'UTC' } }]) {
        assert.equal(compareMetricObservations(base, { ...next, input: changed }, a, b).comparable, false);
    }
    const age = { ...base, input: { ...base.input, window: { ...base.input.window, alignment: 'post-age' as const, ageStartMs: 0, ageEndMs: 86400000 }, confounders: ['未知付费流量'] } };
    const ageNext = { ...next, input: { ...next.input, observedAt: start + 2 * 86400000, window: { ...age.input.window, startAt: start + 86400000, endAt: start + 2 * 86400000 } } };
    const result = compareMetricObservations(age, ageNext, a, b); assert.equal(result.comparable, true); assert.deepEqual(result.confounders, ['未知付费流量']); assert.equal(result.interpretation, 'observational');
});
test('legacy timestamp-less CSV remains readable and idempotent without inventing an observation time', t => {
    const h = fixture(t); const link = h.repo.recordPublication(linkInput());
    const current = csv([input(link.id)]); const rows = parseMetricCsv(current).map(row => row.slice(0, -1));
    const legacyCsv = rows.map(row => row.map(cell => '"' + cell.replaceAll('"', '""') + '"').join(',')).join('\n');
    const legacyMapping = { ...mapping } as Record<string, string>; delete legacyMapping.observedAt;
    const payload = { csv: legacyCsv, mapping: legacyMapping }; const preview = h.repo.preview(payload);
    assert.equal(preview.rows[0].input?.observedAt, undefined);
    const request = { ...payload, requestId: 'legacy-import', previewDigest: preview.digest, confirmed: true, reviseConflicts: false };
    const result = h.repo.importCsv(request); assert.deepEqual(h.repo.importCsv(request), result); assert.equal(result.changed[0].input.observedAt, undefined);
    const explicitBlank = h.repo.preview({ csv: legacyCsv, mapping: { ...legacyMapping, observedAt: '' } });
    const normalized = h.repo.preview(payload); assert.equal(explicitBlank.digest, normalized.digest);
    const window = { startAt: start, endAt: start + 2 * 365 * 86400000, timeZone: 'UTC', alignment: 'post-age', ageStartMs: 0, ageEndMs: 2 * 365 * 86400000 };
    assert.equal(MetricWindowSchema.safeParse(window).success, true);
});

const work = { id: 'work', spaceId: 'a', platform: 'tiktok', revision: 'revision', native: { kind: 'video', projectId: 'native' } } as CreationWorkspace;
const job = { id: 'job', platform: 'tiktok', publishStatus: 'published', contentDigest: 'a'.repeat(64), updatedAt: start,
    receiptSource: 'tiktok-studio-posts', receiptUrl: 'https://www.tiktok.com/@synthetic/video/123?token=redacted',
    context: { spaceId: 'a', jobId: 'job', platform: 'tiktok', accountId: 'private-account', contentDigest: 'a'.repeat(64),
        snapshot: { spaceId: 'a', platform: 'tiktok', source: { kind: 'video', projectId: 'native' }, revision: 'native-revision', semanticDigest: 'b'.repeat(64) } } } as PublicationJobView;
test('read-only publication adapter rejects exports, unknown submission, wrong work/account/space and strips URL secrets', () => {
    const candidate = publicationForWorkspace(job, work, 'a')!; assert.equal(candidate.origin, 'receipt'); assert.equal(candidate.externalWorkId, '123');
    assert.equal(candidate.url, 'https://www.tiktok.com/@synthetic/video/123'); assert.equal(candidate.nativeRevision, 'native-revision'); assert.ok(!JSON.stringify(candidate).includes('private-account'));
    for (const publishStatus of ['not_submitted', 'unknown']) assert.equal(publicationForWorkspace({ ...job, publishStatus } as PublicationJobView, work, 'a'), null);
    assert.equal(publicationForWorkspace(job, { ...work, spaceId: 'other' }, 'a'), null);
    assert.equal(publicationForWorkspace(job, { ...work, native: { kind: 'video', projectId: 'other' } }, 'a'), null);
    assert.equal(publicationForWorkspace({ ...job, context: { ...job.context!, accountId: '' } }, work, 'a'), null);
    assert.equal(publicationForWorkspace({ ...job, contentDigest: 'different' }, work, 'a'), null);
    assert.equal(publicationForWorkspace({ ...job, receiptSource: 'untrusted' }, work, 'a')?.origin, 'submission');
    const wrongPlatform = { ...job, platform: 'xiaohongshu', receiptUrl: 'https://www.xiaohongshu.com/explore/abc', context: { ...job.context!, platform: 'xiaohongshu', snapshot: { ...job.context!.snapshot, platform: 'xiaohongshu', source: { kind: 'note', path: 'test.redpost' } } } } as PublicationJobView;
    assert.equal(publicationForWorkspace(wrongPlatform, { ...work, platform: 'xiaohongshu', native: { kind: 'note', path: 'test.redpost' } }, 'a')?.origin, 'submission');
    for (const value of ['http://www.tiktok.com/@a/video/123', 'https://evil.test/@a/video/123', 'https://www.tiktok.com/creator-center', 'https://user:pass@www.tiktok.com/@a/video/123']) assert.equal(canonicalPublicationUrl('tiktok', value), null);
});
test('manual publication links retain explicit provenance and cannot forge trusted receipt or use another space work', async t => {
    const h = fixture(t); const service = createContentMetricsService(h.repo, { readWork: async () => work, jobs: () => [job] });
    const request = { requestId: 'manual', workspaceId: work.id, expectedRevision: work.revision, platform: 'tiktok', accountAlias: '脱敏测试账号', externalWorkId: '123', url: 'https://www.tiktok.com/@synthetic/video/123', sourceNote: '合成测试用户声明', observedAt: start };
    const result = await service.attachManual(request); assert.equal(result.origin, 'manual'); assert.equal(result.status, 'declared-published'); assert.deepEqual(await service.attachManual(request), result);
    await assert.rejects(service.attachManual({ ...request, origin: 'receipt' }));
    await assert.rejects(service.attachManual({ ...request, requestId: 'manual-wrong-url', url: 'https://www.tiktok.com/@synthetic/video/124' }), /不一致/);
    await assert.rejects(service.attachManual({ ...request, requestId: 'manual-stale-version', expectedRevision: 'old' }), /版本/);
    const synced = await service.syncWork(work.id); assert.equal(synced.length, 2); assert.equal((await service.syncWork(work.id)).length, 2);
    const editedService = createContentMetricsService(h.repo, { readWork: async () => ({ ...work, revision: 'changed-after-publication' }), jobs: () => [job] });
    const afterEdit = await editedService.syncWork(work.id); assert.equal(afterEdit.length, 2); assert.equal(afterEdit.find(link => link.origin === 'receipt')?.workspaceRevision, 'revision');
    h.switch('中文空间'); await assert.rejects(service.attachManual(request), /空间/); await assert.rejects(service.syncWork(work.id), /空间/);
});

test('historical external links import real-shaped observations without inventing a workspace or touching a native editor', t => {
    const h = fixture(t); let nativeReads = 0;
    const service = createContentMetricsService(h.repo, { readWork: async () => { nativeReads++; throw new Error('must not read a fabricated work'); }, jobs: () => [] });
    const request = { requestId: 'external', platform: 'xiaohongshu', accountAlias: '脱敏测试账号', externalWorkId: 'abcdef123456',
        title: '合成历史作品', contentKind: 'video', url: 'https://www.xiaohongshu.com/explore/abcdef123456?xsec_token=private-test-token', sourceNote: '合成外部作品声明，原工程不可用', observedAt: start };
    const first = service.attachExternal(request); assert.equal(first.workspaceId, undefined); assert.equal(first.workspaceRevision, undefined); assert.equal(first.nativeRevision, undefined);
    assert.equal(first.origin, 'manual'); assert.equal(first.url, 'https://www.xiaohongshu.com/explore/abcdef123456'); assert.deepEqual(service.attachExternal(request), first); assert.equal(nativeReads, 0);
    assert.equal(h.repo.publications().length, 1); assert.equal(h.repo.publications('work-one').length, 0);
    const imported = importRows(h.repo, [input(first.id)]); assert.equal(imported.changed.length, 1);
    assert.equal(h.db.prepare('SELECT id FROM legacy_work').get()!.id, 'unchanged');
    assert.throws(() => service.attachExternal({ ...request, title: 'changed' }), /同一请求/);
    for (const extra of [{ workspaceId: 'fabricated' }, { spaceId: 'other' }, { origin: 'receipt' }, { nativeRevision: 'fake' }]) assert.equal(ExternalPublicationLinkSchema.safeParse({ ...request, ...extra }).success, false);
    for (const extra of [{ origin: 'receipt', status: 'published' }, { nativeRevision: 'fake' }, { workspaceId: 'missing-revision' }, { jobId: 'fake' }]) assert.equal(PublicationLinkSchema.safeParse({ ...first, ...extra }).success, false);
    assert.throws(() => service.attachExternal({ ...request, requestId: 'url-mismatch', externalWorkId: 'different' }), /不一致/);
    h.switch('中文空间'); assert.equal(h.repo.publications().length, 0); assert.throws(() => h.repo.publication(first.id), /当前空间/);
    const scoped = service.attachExternal(request); assert.notEqual(scoped.id, first.id); assert.equal(scoped.spaceId, '中文空间');
});
test('external observation comparisons retain unknown or differing format limits even when dates and numeric units match', t => {
    const h = fixture(t); const service = createContentMetricsService(h.repo, { readWork: async () => work, jobs: () => [] });
    const request = { requestId: 'external-a', platform: 'xiaohongshu', accountAlias: '脱敏测试账号', externalWorkId: 'abcdef111', title: '合成历史作品', contentKind: 'video', sourceNote: '合成外部作品声明', observedAt: start };
    const first = service.attachExternal(request); const second = service.attachExternal({ ...request, requestId: 'external-b', externalWorkId: 'abcdef222' });
    const imported = importRows(h.repo, [input(first.id, 100), input(second.id, 150)]).changed;
    assert.equal(compareMetricObservations(imported[0], imported[1], first, second).relativeChange, .5);
    for (const externalContentKind of ['unknown', 'image-set'] as const) {
        const compared = compareMetricObservations(imported[0], imported[1], first, { ...second, externalContentKind });
        assert.equal(compared.interpretation, 'insufficient'); assert.equal(compared.relativeChange, null); assert.ok(compared.reasons.some(value => value.includes('形式')));
    }
});
test('manual links distinguish native versions with unchanged workspace revisions and preserve legacy identities on replay', async t => {
    const h = fixture(t); let nativeRevision = 'native-one';
    const service = createContentMetricsService(h.repo, { readWork: async () => work, jobs: () => [job], readNativeRevision: async () => nativeRevision });
    const request = { requestId: 'old-native', workspaceId: work.id, expectedRevision: work.revision, platform: work.platform, accountAlias: '脱敏测试账号', externalWorkId: '123', sourceNote: '合成人工版本声明', observedAt: start };
    const first = await service.attachManual(request);
    const legacyId = 'pub_' + ciDigest(['a', work.id, work.revision, work.platform, request.accountAlias, '123', undefined, 'manual', 'declared-published']);
    assert.equal(first.id, legacyId);
    nativeRevision = 'native-two'; const second = await service.attachManual({ ...request, requestId: 'new-native' });
    assert.notEqual(first.id, second.id); assert.equal(h.repo.publication(first.id).nativeRevision, 'native-one');
    assert.equal(second.nativeRevision, 'native-two'); assert.deepEqual(await service.attachManual(request), first);
    assert.deepEqual(await service.attachManual({ ...request, requestId: 'new-native' }), second);
    const noLongerAvailable = createContentMetricsService(h.repo, { readWork: async () => { throw new Error('later source unavailable'); }, jobs: () => [] });
    assert.deepEqual(await noLongerAvailable.attachManual(request), first);
    await assert.rejects(noLongerAvailable.attachManual({ ...request, sourceNote: 'same request changed' }), /同一请求/);
    assert.equal((await service.syncWork(work.id)).length, 3); assert.equal((await service.syncWork(work.id)).length, 3);
    assert.throws(() => h.repo.recordPublication({ ...linkInput(work.id, '123'), workspaceRevision: work.revision, accountAlias: request.accountAlias, nativeRevision: 'native-two', sourceNote: 'different provenance' }), /冲突/);
});
