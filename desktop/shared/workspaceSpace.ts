import { z } from 'zod';

// Existing db.generateSpaceId retains Chinese names; space IDs are not file/object IDs.
// Authorization still requires an actual row in spaces and the captured main-process context.
export const WorkspaceSpaceIdSchema = z.string().regex(/^[a-zA-Z0-9_\u4e00-\u9fa5-]{1,160}$/);
