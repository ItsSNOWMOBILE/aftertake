import { z } from 'zod';
import { subjectEffectRequestSchema, type SubjectEffectJob } from '../src/subject-effects.js';
import { finishingRequestSchema, type FinishingJob } from '../src/finishing.js';
import { depthEffectRequestSchema, type DepthEffectJob } from '../src/depth-effects.js';

type Register = (
  name: string,
  description: string,
  schema: z.ZodType,
  run: (input: any) => Promise<{ data: unknown; images?: { data: string; mimeType: string }[] }>,
  readOnly?: boolean,
) => void;
const requestId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
const uuid = z.string().uuid();
const family = z.enum(['subject', 'finishing', 'depth']);
const route = (kind: z.infer<typeof family>) =>
  kind === 'subject'
    ? '/api/subject-effects'
    : kind === 'depth'
      ? '/api/depth-effects'
      : '/api/finishing';
export function registerEffectsTools({
  tool,
  api,
  base,
}: {
  tool: Register;
  api: <T = any>(route: string, body?: unknown, key?: string) => Promise<T>;
  base: string;
}) {
  tool(
    'aftertake_effects_workspace',
    'Inspect saved subject, finishing and still-image depth jobs. Reusing a completed person selection and color finishing are CPU pixel operations. Estimating new depth requires the native CUDA BF16 engine.',
    z.object({}),
    async () => {
      const [subjects, finishing, depth, clips] = await Promise.all([
        api<SubjectEffectJob[]>('/api/subject-effects'),
        api<FinishingJob[]>('/api/finishing'),
        api<DepthEffectJob[]>('/api/depth-effects'),
        api('/api/clips'),
      ]);
      return {
        data: {
          subjects,
          finishing,
          depth,
          clips,
          workflow: [
            'Track and visually review a person first with the character tools. Keep the exact saved mask hash.',
            'Duplicate original subject pixels with explicit copies, transforms and edge controls. Empty copies plus background settings makes a focus-only edit.',
            'Color finishing adjusts existing source pixels. Inspect an exact processed preview frame before exporting a whole clip.',
            'Depth effects estimate a still-image depth field with pinned DA3 Small BF16 weights, then apply lens blur, haze or directional lighting. Video depth effects are not supported.',
            'Each output is a normal studio clip: inspect it and use aftertake_use_source to bring it into Film.',
            'Save the effect recipe. Subject effects also need its three hash-bound media files to reproduce on another machine.',
            'Stable requestIds rejoin the same operation. After a timeout, read status before starting different work.',
          ],
        },
      };
    },
  );
  tool(
    'aftertake_depth_effect',
    'Apply depth-based lens blur, atmospheric haze and a directional virtual light to one still image. DA3 Small estimates real depth on native CUDA BF16; pixel effects retain the source canvas. No video depth support. Inspect the depth and finished image before using it as an animation reference.',
    z.object({ requestId, request: depthEffectRequestSchema }),
    async (input) => ({ data: await api('/api/depth-effects', input.request, input.requestId) }),
    false,
  );
  tool(
    'aftertake_duplicate_subject',
    'Copy the reviewed person from the original video into up to four offset, scaled, rotated or flipped positions, retaining original sound once. Optional blur/exposure affects the background through the tracked mask. No diffusion or identity regeneration. Review cutout edges and occlusion in the actual output.',
    z.object({ requestId, request: subjectEffectRequestSchema }),
    async (input) => ({
      data: await api('/api/subject-effects/duplicates', input.request, input.requestId),
    }),
    false,
  );
  tool(
    'aftertake_finish_media',
    'Save a color-finished image or video with editable, hash-bound settings: exposure, contrast, saturation, white balance, film look, sharpness, vignette and deterministic grain. Retains original video timing and audio. Does not alter generated object geometry.',
    z.object({ requestId, request: finishingRequestSchema }),
    async (input) => ({ data: await api('/api/finishing', input.request, input.requestId) }),
    false,
  );
  tool(
    'aftertake_effect_status',
    'Read an existing subject, finishing or still-image depth job by record ID or stable requestId. Status can resume tracking accepted work; it never submits a new generation.',
    z
      .object({ kind: family, id: uuid.optional(), requestId: requestId.optional() })
      .refine(
        (value) => Boolean(value.id) !== Boolean(value.requestId),
        'Choose exactly one record ID or requestId.',
      ),
    async (input) => {
      const path = route(input.kind);
      const job = input.id
        ? await api(path + '/' + input.id)
        : (await api<(SubjectEffectJob | FinishingJob | DepthEffectJob)[]>(path)).find(
            (item) => item.requestKey === input.requestId,
          );
      if (!job) throw Error('No saved effect matches this request.');
      return { data: job };
    },
  );
  tool(
    'aftertake_depth_action',
    'Cancel accepted depth estimation or reconcile its uncertain connection using the original stable request key. Recovery never changes its source or settings.',
    z.object({ id: uuid, action: z.enum(['cancel', 'reconcile']) }),
    async (input) => ({
      data: await api('/api/depth-effects/' + input.id + '/' + input.action, {}),
    }),
    false,
  );
  tool(
    'aftertake_effect_recipe',
    'Read an editable effect recipe and its media bindings. A subject recipe requires original source, prepared video and lossless tracked mask; keep all three exact hashes when moving workspaces.',
    z.object({ kind: family, id: uuid }),
    async (input) => ({
      data: {
        recipe: await api(route(input.kind) + '/' + input.id + '/recipe'),
        ...(input.kind === 'subject'
          ? {
              media: Object.fromEntries(
                ['source', 'prepared', 'mask'].map((role) => [
                  role,
                  route(input.kind) + '/' + input.id + '/media/' + role,
                ]),
              ),
            }
          : {}),
      },
    }),
  );
  tool(
    'aftertake_cancel_finishing',
    'Cancel an active local color-finishing export. This stops its worker; read the returned status before reusing the output.',
    z.object({ id: uuid }),
    async (input) => ({ data: await api('/api/finishing/' + input.id + '/cancel', {}) }),
    false,
  );
  tool(
    'aftertake_preview_finish',
    'Inspect an actual processed frame with the same settings and pixel pipeline as a final finishing export. Returns a PNG for visual review. Does not create a finished clip or certify the whole video.',
    z.object({ request: finishingRequestSchema, time: z.number().min(0).max(3600) }),
    async (input) => {
      const response = await fetch(base + '/api/finishing/preview', {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(305000),
      });
      if (!response.ok)
        throw Error((await response.json()).error || 'The finishing preview is unavailable.');
      if (!response.headers.get('content-type')?.startsWith('image/png'))
        throw Error('The finishing preview did not return a PNG.');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 10 * 1024 * 1024)
        throw Error('The preview exceeds the review image limit.');
      return {
        data: {
          time: input.time,
          sourceSHA256: input.request.clip.sha256,
          settings: input.request.settings,
          review: 'One actual processed frame; review full motion and audio separately.',
        },
        images: [{ data: bytes.toString('base64'), mimeType: 'image/png' }],
      };
    },
  );
}
