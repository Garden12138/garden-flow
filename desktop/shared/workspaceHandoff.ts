import { z } from 'zod';

/** Browser extensions can open a workspace page, never trigger generation or publication. */
export const DesktopOpenSchema = z.object({
    destination: z.enum(['materials', 'products', 'publication']),
    entityKind: z.enum(['redbook-note', 'youtube-video', 'document-source']).optional(),
    entityId: z.string().min(1).max(500).optional(),
    spaceId: z.string().min(1).max(160).optional(),
}).strict();
export function desktopOpenRoute(input: z.infer<typeof DesktopOpenSchema>) {
    return input.destination === 'publication'
        ? { section: 'publish', page: 'tasks', ...(input.entityId ? { entityId: input.entityId, ...(input.entityKind ? { entityKind: input.entityKind } : {}) } : {}) }
        : { section: 'library', page: input.destination, ...(input.entityId ? { entityId: input.entityId, ...(input.entityKind ? { entityKind: input.entityKind } : {}) } : {}) };
}
