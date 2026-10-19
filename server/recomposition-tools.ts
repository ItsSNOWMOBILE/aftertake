import { z } from 'zod';
import { recompositionRequestSchema, type RecompositionJob } from '../src/recomposition.js';
import type { Render } from '../src/domain.js';

type Register = (
  name: string,
  description: string,
  schema: z.ZodType,
  run: (input: any) => Promise<{ data: unknown }>,
  readOnly?: boolean,
) => void;
const requestId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);

export function registerRecompositionTools({
  tool,
  api,
}: {
  tool: Register;
  api: <T = any>(route: string, body?: unknown, key?: string) => Promise<T>;
}) {
  tool(
    'aftertake_refine_blend',
    'Refine a completed native region VFX or masked edit using its saved raw generation. Changes only the final painted area and source color matching, preserving source timing and audio. Runs CPU pixel composition without invoking a model or the Comfy graph. The original take remains. Omit compositeRegion to restore its generation region. Keep a stable requestId and read status before retrying after a timeout; inspect the completed output before using it in Film.',
    z.object({ requestId, request: recompositionRequestSchema }),
    async (input) => ({
      data: await api('/api/recompositions', input.request, input.requestId),
    }),
    false,
  );
  tool(
    'aftertake_blend_status',
    'Read a saved CPU blend refinement by record ID or original requestId. Returns its separate processing receipt and completed take when available; never regenerates or restarts work.',
    z
      .object({ id: z.string().uuid().optional(), requestId: requestId.optional() })
      .refine(
        (input) => Boolean(input.id) !== Boolean(input.requestId),
        'Choose exactly one record ID or requestId.',
      ),
    async (input) => {
      const job = await api<RecompositionJob>(
        input.id
          ? '/api/recompositions/' + input.id
          : '/api/recompositions/by-key/' + input.requestId,
      );
      return {
        data: {
          job,
          ...(job.state === 'succeeded' && job.renderId
            ? { take: await api<Render>('/api/renders/' + job.renderId) }
            : {}),
        },
      };
    },
  );
  tool(
    'aftertake_cancel_blend',
    'Cancel an existing CPU blend refinement. Keeps the original take and saved raw generation; does not submit another job.',
    z.object({ id: z.string().uuid() }),
    async (input) => ({ data: await api('/api/recompositions/' + input.id + '/cancel', {}) }),
    false,
  );
}
