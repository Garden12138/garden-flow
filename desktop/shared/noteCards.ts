import { z } from 'zod';

export const CARD_WIDTH = 1440;
export const CARD_HEIGHT = 1920;
export const CARD_TEMPLATE_VERSION = 1;
export const CARD_FONT_VERSION = 'noto-sans-sc-400-700-v1';
export const CreationPresetSchema = z.enum(['free', 'article', 'diagram', 'tutorial']);
export type CreationPreset = z.infer<typeof CreationPresetSchema>;
export const PRESET_LABELS: Record<CreationPreset, string> = { free: '自由创作', article: '文章转卡片', diagram: '知识图解', tutorial: '步骤教程' };
export const SourceRefSchema = z.object({ id: z.string().min(1).max(160), version: z.string().min(1).max(160), name: z.string().max(240) }).strict();
export type SourceRef = z.infer<typeof SourceRefSchema>;
export const CardStyleSchema = z.object({
    background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#FAF8F3'), foreground: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#202925'),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#C05640'), fontScale: z.number().min(0.7).max(1.3).default(1),
    mode: z.enum(['text', 'mixed']).default('text'),
}).strict();
export const CreationConfigSchema = z.object({
    presetId: CreationPresetSchema.default('free'), presetVersion: z.literal(1).default(1),
    inputMode: z.enum(['manual', 'article']).default('manual'), expression: z.enum(['free', 'diagram', 'tutorial']).default('free'),
    sourceRefs: z.array(SourceRefSchema).max(20).default([]), brief: z.string().max(12000).default(''), audience: z.string().max(1000).default(''), style: CardStyleSchema.default({}),
}).strict();
export type CreationConfig = z.infer<typeof CreationConfigSchema>;
export function presetConfig(presetId: CreationPreset, current = CreationConfigSchema.parse({})): CreationConfig {
    return { ...current, presetId, presetVersion: 1, inputMode: presetId === 'article' || current.sourceRefs.length ? 'article' : 'manual', expression: presetId === 'diagram' ? 'diagram' : presetId === 'tutorial' ? 'tutorial' : 'free' };
}
export const CARD_LAYOUT_LABELS = { cover: '封面', text: '标题正文', split: '图文分栏', comparison: '对比', steps: '步骤 / 线性流程', checklist: '总结清单' } as const;
export const CardLayoutSchema = z.enum(['cover', 'text', 'split', 'comparison', 'steps', 'checklist']);
const text = z.string().max(12000);
const item = z.object({ id: z.string().min(1).max(160), title: z.string().max(500), text: text.default(''), assetId: z.string().max(160).optional() }).strict();
export const CardBlockSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text, emphasis: z.array(z.string().max(500)).max(30).default([]) }).strict(),
    z.object({ type: z.literal('image'), assetId: z.string().max(160), fit: z.enum(['contain', 'cover']).default('contain'), x: z.number().min(0).max(100).default(50), y: z.number().min(0).max(100).default(50) }).strict(),
    z.object({ type: z.literal('comparison'), columns: z.array(z.string().max(200)).length(2), rows: z.array(z.object({ label: z.string().max(200), left: text, right: text }).strict()).max(20) }).strict(),
    z.object({ type: z.literal('steps'), items: z.array(item).max(20) }).strict(),
    z.object({ type: z.literal('checklist'), items: z.array(text).max(30), closing: text.default('') }).strict(),
]);
export type CardBlock = z.infer<typeof CardBlockSchema>;
export const PageSourceSchema = SourceRefSchema.extend({ location: z.string().max(240) });
export const CardPageFieldsSchema = z.object({ layout: CardLayoutSchema, blocks: z.array(CardBlockSchema).max(30), sourceRefs: z.array(PageSourceSchema).max(40).default([]) });
export function blockCopy(blocks: CardBlock[]): string {
    return blocks.map(block => block.type === 'text' ? block.text : block.type === 'steps' ? block.items.map((item, index) => `${index + 1}. ${item.title}\n${item.text}`).join('\n') : block.type === 'comparison' ? [block.columns.join(' / '), ...block.rows.map(row => `${row.label}: ${row.left} / ${row.right}`)].join('\n') : block.type === 'checklist' ? [...block.items, block.closing].filter(Boolean).join('\n') : '').filter(Boolean).join('\n\n');
}
export const NoteCardTurnSchema = z.object({ path: z.string().min(1).max(2000), spaceId: z.string().min(1), requestId: z.string().min(1).max(160), expectedRevision: z.number().int().nonnegative(), expectedDraftEpoch: z.number().int().nonnegative(), selectedId: z.string().max(160).optional(), policy: z.enum(['direct', 'propose']).default('direct') }).strict();
export type NoteCardTurn = z.infer<typeof NoteCardTurnSchema>;
export const NoteCardContentSchema = z.object({
    finalTitle: z.string().max(200), body: text, hashtags: z.array(z.string().max(80)).max(30), creationConfig: CreationConfigSchema,
    imagePages: z.array(z.object({ id: z.string().min(1).max(160), index: z.number().int().min(1).max(20), title: z.string().max(500), copy: text.default(''), visualBrief: text.default(''), imagePrompt: text.default(''), mediaSlotId: z.string().min(1).max(160), layout: CardLayoutSchema.optional(), blocks: z.array(CardBlockSchema).max(30).optional(), sourceRefs: z.array(PageSourceSchema).max(40).default([]) }).strict()).max(20),
}).strict().superRefine((value, ctx) => { if (new Set(value.imagePages.map(page => page.id)).size !== value.imagePages.length || new Set(value.imagePages.map(page => page.mediaSlotId)).size !== value.imagePages.length) ctx.addIssue({ code: 'custom', message: '页面与媒体槽位 ID 必须唯一' }); });
export type NoteCardContent = z.infer<typeof NoteCardContentSchema>;
export interface NoteCardRuntime {
    draftEpoch: number;
    undo: NoteCardContent[];
    receipts: Array<{ id: string; digest: string }>;
    unapplied: Array<{ id: string; content: NoteCardContent; reason: string }>;
    proposal?: { id: string; basedOnRevision: number; basedOnEpoch: number; content: NoteCardContent };
    generations?: Array<{ requestId: string; pageId: string; jobId?: string; status: 'generating' | 'succeeded' | 'failed'; assetId?: string; error?: string }>;
}
export function cardContent(value: { finalTitle: string; body: string; hashtags: string[]; creationConfig?: CreationConfig; imagePages: unknown[] }): NoteCardContent {
    return NoteCardContentSchema.parse({ finalTitle: value.finalTitle, body: value.body, hashtags: value.hashtags, creationConfig: value.creationConfig || {}, imagePages: value.imagePages });
}
export function newCardPage(layout: z.infer<typeof CardLayoutSchema> = 'text', id = crypto.randomUUID()): NoteCardContent['imagePages'][number] {
    const blocks: CardBlock[] = layout === 'steps' ? [{ type: 'steps', items: [] }] : layout === 'comparison' ? [{ type: 'comparison', columns: ['方案 A', '方案 B'], rows: [] }] : layout === 'checklist' ? [{ type: 'checklist', items: [], closing: '' }] : [{ type: 'text', text: '', emphasis: [] }];
    return { id, index: 1, title: '', copy: '', visualBrief: '', imagePrompt: '', mediaSlotId: `card-${id}`, layout, blocks, sourceRefs: [] };
}
