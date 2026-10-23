import { MetricCsvFields, MetricCsvPreviewSchema, MetricInputSchema, type MetricInput, type MetricObservation, type PublicationLink, type MetricComparison } from '../../../shared/contentExperiments.ts';
import { ciDigest } from './repository.ts';

export const metricIdentity = (input: MetricInput) => ciDigest([input.publicationLinkId, input.metric.key, input.window]);
export const metricCsvTemplate = MetricCsvFields.join(',') + '\n';

// Bounded RFC 4180 parser. No formulas or scripts are evaluated, and no file paths are accepted.
export function parseMetricCsv(csv: string): string[][] {
    if (csv.length > 1000000) throw new Error('CSV 超过 100 万字符');
    csv = csv.replace(/^\uFEFF/, '');
    const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false; let closed = false;
    const cell = () => { row.push(field); field = ''; closed = false; if (row.length > 50) throw new Error('CSV 列数超过 50'); };
    const line = () => { cell(); rows.push(row); row = []; if (rows.length > 1001) throw new Error('CSV 最多 1000 条观测'); };
    for (let index = 0; index < csv.length; index++) {
        const char = csv[index];
        if (quoted) {
            if (char === '"' && csv[index + 1] === '"') { field += '"'; index++; }
            else if (char === '"') { quoted = false; closed = true; }
            else field += char;
        } else if (char === ',') cell();
        else if (char === '\r' || char === '\n') { if (char === '\r' && csv[index + 1] === '\n') index++; line(); }
        else if (char === '"' && !field && !closed) quoted = true;
        else { if (closed || char === '"') throw new Error('CSV 引号格式错误'); field += char; }
    }
    if (quoted) throw new Error('CSV 引号未闭合');
    if (field || row.length || closed) line();
    return rows;
}
const csvTime = (value: string): number => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('时间须为带时区偏移的 ISO 时间');
    const time = Date.parse(value);
    const offset = value.endsWith('Z') ? 0 : (value.at(-6) === '-' ? -1 : 1) * (Number(value.slice(-5, -3)) * 60 + Number(value.slice(-2))) * 60000;
    if (!Number.isFinite(time) || time < 0 || new Date(time + offset).toISOString().slice(0, 19) !== value.slice(0, 19)) throw new Error('时间无效');
    return time;
};
const csvNumber = (value: string): number => {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error('数值须为非负十进制数字，不接受公式或千分位'); return Number(value);
};
export function readMetricCsv(input: unknown) {
    const request = MetricCsvPreviewSchema.parse(input); const [headers = [], ...data] = parseMetricCsv(request.csv);
    if (new Set(headers).size !== headers.length || !headers.length) throw new Error('CSV 标题缺失或重复');
    const mapped = MetricCsvFields.map(field => request.mapping[field]);
    if (new Set(mapped).size !== mapped.length || mapped.some(name => !headers.includes(name))) throw new Error('字段映射缺失或重复');
    const rows = data.map((cells, index) => {
        try {
            if (cells.length !== headers.length) throw new Error('列数与标题不一致');
            const get = (field: typeof MetricCsvFields[number]) => cells[headers.indexOf(request.mapping[field])].trim();
            const alignment = get('alignment');
            const value = MetricInputSchema.parse({ publicationLinkId: get('publicationLinkId'),
                metric: { key: get('metric'), definition: get('definition'), unit: get('unit') }, value: csvNumber(get('value')),
                window: { startAt: csvTime(get('start')), endAt: csvTime(get('end')), timeZone: get('timeZone'), alignment,
                    ...(get('ageStartHours') ? { ageStartMs: csvNumber(get('ageStartHours')) * 3600000 } : {}),
                    ...(get('ageEndHours') ? { ageEndMs: csvNumber(get('ageEndHours')) * 3600000 } : {}) },
                confounders: get('confounders') ? get('confounders').split('|') : [], sourceNote: get('sourceNote') });
            return { row: index + 2, input: value };
        } catch (error) { return { row: index + 2, error: error instanceof Error && error.name !== 'ZodError' ? error.message : '观测字段不符合契约' }; }
    });
    return { headers, rows };
}

export function compareMetricObservations(baseline: MetricObservation, variant: MetricObservation, baseLink: PublicationLink, variantLink: PublicationLink): MetricComparison {
    const reasons: string[] = []; const a = baseline.input; const b = variant.input;
    if (baseline.spaceId !== variant.spaceId || baseLink.spaceId !== baseline.spaceId || variantLink.spaceId !== variant.spaceId) reasons.push('空间不同');
    if (a.publicationLinkId !== baseLink.id || b.publicationLinkId !== variantLink.id) reasons.push('观测与发布关联不匹配');
    if (baseLink.platform !== variantLink.platform) reasons.push('平台不同');
    if (baseLink.accountAlias !== variantLink.accountAlias) reasons.push('账号别名不同');
    if (baseLink.id === variantLink.id || baseLink.externalWorkId === variantLink.externalWorkId) reasons.push('须为两个不同作品');
    if (ciDigest(a.metric) !== ciDigest(b.metric)) reasons.push('指标定义或单位不同');
    if (a.window.timeZone !== b.window.timeZone || a.window.alignment !== b.window.alignment) reasons.push('窗口时间区或对齐方式不同');
    if (a.window.alignment === 'calendar' ? a.window.startAt !== b.window.startAt || a.window.endAt !== b.window.endAt
        : a.window.ageStartMs !== b.window.ageStartMs || a.window.ageEndMs !== b.window.ageEndMs) reasons.push('观察窗口不可比');
    const comparable = !reasons.length;
    const relative = a.value === 0 ? null : (b.value - a.value) / a.value;
    return { comparable, reasons, baseline: comparable ? a.value : null, variant: comparable ? b.value : null,
        difference: comparable ? b.value - a.value : null,
        relativeChange: comparable && relative !== null && Number.isFinite(relative) ? relative : null,
        confounders: [...new Set([...a.confounders, ...b.confounders])], interpretation: comparable ? 'observational' : 'insufficient' };
}
