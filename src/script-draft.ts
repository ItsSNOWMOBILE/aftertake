import { z } from 'zod';

export const scriptRevision = 'aftertake-script/1';
export const scriptModelRevision = 'b467368d16b75df14055562fe927ae8e1f15f7ef';
export const scriptRequestSchema = z
  .object({
    brief: z.string().trim().min(10).max(1600),
    closingLine: z.string().trim().max(100).default(''),
    variation: z.number().int().min(0).max(999).default(0),
    pictures: z
      .array(
        z.object({
          key: z.string().min(1).max(100),
          name: z.string().trim().min(1).max(160),
          seconds: z.number().min(0.25).max(600),
        }),
      )
      .min(1)
      .max(16),
  })
  .refine(
    (input) => new Set(input.pictures.map((p) => p.key)).size === input.pictures.length,
    'Each picture needs a distinct script row.',
  );
export const scriptResultSchema = z.object({
  lines: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(120)
        .refine((line) => !/[\r\n\x00-\x1f]/.test(line), 'A draft line must be one spoken line.'),
    )
    .min(1)
    .max(16),
  receipt: z.object({
    model: z.literal('Qwen3-4B / OpenVINO INT4'),
    revision: z.literal(scriptModelRevision),
    weightsSha256: z.string().regex(/^[a-f0-9]{64}$/),
    runtime: z.string().min(1).max(200),
    device: z.literal('CPU'),
    deviceName: z.string().min(1).max(200),
    loadSeconds: z.number().nonnegative(),
    generationSeconds: z.number().nonnegative(),
    structuredOutput: z.literal(true),
  }),
});
export type ScriptRequest = z.infer<typeof scriptRequestSchema>;
export type ScriptResult = z.infer<typeof scriptResultSchema>;
export type ScriptDraft = {
  id: string;
  requestDigest: string;
  request: ScriptRequest;
  state: 'drafting' | 'ready' | 'failed' | 'interrupted';
  createdAt: string;
  updatedAt: string;
  result?: ScriptResult;
  error?: string;
};

export function checkedScriptResult(input: unknown, request: ScriptRequest) {
  const result = scriptResultSchema.parse(input);
  if (result.lines.length !== request.pictures.length)
    throw Error(
      'The local model returned the wrong number of lines. Keep the brief and draft another version.',
    );
  if (request.closingLine && result.lines.at(-1) !== request.closingLine)
    throw Error('The local model changed the requested closing line. Draft another version.');
  return result;
}
