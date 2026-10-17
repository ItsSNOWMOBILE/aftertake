import { z } from 'zod';
import { clipSchema, type Clip } from './domain.js';

export const frameEditRequestSchema = z.object({
  format: z.literal('aftertake-frame-edit/1'), clip: clipSchema,
  trimStart: z.number().min(0).max(3600),
  subject: clipSchema.extend({ kind: z.literal('image') }).optional(),
  prompt: z.string().trim().min(5).max(2000),
  seed: z.number().int().min(0).max(2 ** 32 - 1),
  mode: z.enum(['fast', 'detail']),
}).refine(value => value.clip.kind === 'image' ? value.trimStart === 0 : value.trimStart < value.clip.duration,
  'Choose a starting frame inside the source clip.');
export type FrameEditRequest = z.infer<typeof frameEditRequestSchema>;
export type FrameEdit = {
  id: string; request: FrameEditRequest; state: string; progress: number | null;
  createdAt: string; updatedAt: string; jobId?: string; stage?: string; error?: string;
  workflow: Record<string, unknown>; clip?: Clip;
};
export const frameEditTerminal = new Set(['succeeded', 'failed', 'canceled', 'expired', 'output_error']);
export const frameEditBusy = (edit: FrameEdit) => !frameEditTerminal.has(edit.state);
