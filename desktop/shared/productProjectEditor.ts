import { z } from 'zod';
import { ProductCreationTargetSchema, ProductWorkVersionSchema } from './productCreationTarget.ts';
import { ProductVideoEditCommandSchema } from './productVideoProposal.ts';
import { ProductImagePageSchema, ProductImageStyleSchema } from './productImageSet.ts';
import type { VideoEditorV2Project } from './videoAutoEdit';
import type { XhsNoteProjectSnapshot } from './xhsNote';

export const ProductProjectEditorRefSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('video'), projectId: z.string().min(1).max(160) }).strict(),
    z.object({ kind: z.literal('image-set'), path: z.string().min(1).max(2000) }).strict(),
]);
export const ProductProjectEditorBindingSchema = z.object({
    version: z.literal(1), spaceId: z.string().min(1), project: ProductProjectEditorRefSchema,
    productId: z.string().min(1), target: ProductCreationTargetSchema.optional(),
    workVersion: ProductWorkVersionSchema.optional(), selectedId: z.string().max(160).optional(),
}).strict();
const EditablePageSchema = ProductImagePageSchema.omit({ render: true, generation: true });
export const ProductProjectEditOperationSchema = z.union([
    ProductVideoEditCommandSchema,
    z.object({ type: z.literal('voiceover.asset'), sceneId: z.string().min(1), assetId: z.string().min(1) }).strict(),
    z.object({ type: z.literal('audio.volume'), track: z.enum(['music', 'voiceover']), sceneId: z.string().min(1).optional(), volume: z.number().min(0).max(1) }).strict(),
    z.object({ type: z.literal('publication.copy'), title: z.string().trim().min(1).max(200), description: z.string().max(12000), hashtags: z.array(z.string().max(80)).max(30) }).strict(),
    z.object({ type: z.literal('page.update'), pageId: z.string().min(1), changes: EditablePageSchema.omit({ id: true, role: true }).partial().strict() }).strict(),
    z.object({ type: z.literal('page.add'), page: EditablePageSchema.extend({ role: z.literal('content') }).strict(), afterPageId: z.string().min(1).optional() }).strict(),
    z.object({ type: z.literal('page.delete'), pageId: z.string().min(1) }).strict(),
    z.object({ type: z.literal('page.order'), pageIds: z.array(z.string().min(1)).min(1).max(20) }).strict(),
    z.object({ type: z.literal('image.style'), style: ProductImageStyleSchema.partial().strict() }).strict(),
    z.object({ type: z.literal('image.replace'), pages: z.array(EditablePageSchema).min(1).max(20), style: ProductImageStyleSchema }).strict(),
]);
export const ProductProjectEditRequestSchema = z.object({
    binding: ProductProjectEditorBindingSchema, requestId: z.string().min(1).max(160),
    expectedRevision: z.string().min(1), expectedDraftEpoch: z.number().int().nonnegative(),
    operations: z.array(ProductProjectEditOperationSchema).min(1).max(80),
}).strict();
export type ProductProjectEditorRef = z.infer<typeof ProductProjectEditorRefSchema>;
export type ProductProjectEditorBinding = z.infer<typeof ProductProjectEditorBindingSchema>;
export type ProductProjectEditOperation = z.infer<typeof ProductProjectEditOperationSchema>;
export type ProductProjectEditRequest = z.infer<typeof ProductProjectEditRequestSchema>;
export interface ProductProjectEditorSnapshot {
    binding: ProductProjectEditorBinding;
    revision: string;
    draftEpoch: number;
    dirty: boolean;
    undoCount: number;
    video?: VideoEditorV2Project;
    imageSet?: XhsNoteProjectSnapshot;
    publicationCopy?: { title: string; description: string; hashtags: string[] };
}
export interface ProductProjectEditResult extends ProductProjectEditorSnapshot {
    requestId: string;
    summary: string[];
    expiredOutputIds: string[];
    staleVoiceSceneIds: string[];
    reused?: boolean;
}
export interface ProductProjectEditorTurn {
    binding: ProductProjectEditorBinding;
    requestId: string;
    expectedRevision: string;
    expectedDraftEpoch: number;
}
