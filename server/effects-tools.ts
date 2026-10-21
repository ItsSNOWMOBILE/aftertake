import { z } from 'zod';
import { subjectEffectRequestSchema, type SubjectEffectJob } from '../src/subject-effects.js';
import { finishingRequestSchema, type FinishingJob } from '../src/finishing.js';
import { depthEffectRequestSchema, type DepthEffectJob } from '../src/depth-effects.js';
import {
  layerStackRequestSchema,
  layerStackRecipeSchema,
  type LayerStackJob,
} from '../src/layer-stack.js';

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
const family = z.enum(['subject', 'finishing', 'depth', 'layers']);
const route = (kind: z.infer<typeof family>) =>
  kind === 'layers'
    ? '/api/layer-stacks'
    : kind === 'subject'
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
    'Inspect saved subject, finishing, still-image depth and layered-image jobs, plus imported image assets. Layer compositing, reusing a completed person selection and color finishing are CPU pixel operations. Estimating new depth requires the native CUDA BF16 engine.',
    z.object({}),
    async () => {
      const [subjects, finishing, depth, layers, assets, clips] = await Promise.all([
        api<SubjectEffectJob[]>('/api/subject-effects'),
        api<FinishingJob[]>('/api/finishing'),
        api<DepthEffectJob[]>('/api/depth-effects'),
        api<LayerStackJob[]>('/api/layer-stacks'),
        api('/api/films/assets'),
        api('/api/clips'),
      ]);
      return {
        data: {
          subjects,
          finishing,
          depth,
          layers,
          assets,
          clips,
          workflow: [
            'Track and visually review a person first with the character tools. Keep the exact saved mask hash.',
            'Duplicate original subject pixels with explicit copies, transforms and edge controls. Empty copies plus background settings makes a focus-only edit.',
            'Color finishing adjusts existing source pixels. Inspect an exact processed preview frame before exporting a whole clip.',
            'Layer stacks combine up to eight still-image and adjustment layers, bottom first. Import exact image assets with aftertake_import_media into Film; keep their SHA256 hashes. Masks follow image transforms. Preview the actual composited PNG before exporting.',
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
    'Copy the reviewed person into up to four offset, scaled, rotated or flipped positions, retaining source sound once. Optional copy.color makes a solid hex-color silhouette; copy.behindSubject keeps the current tracked person in front, for colored mask echoes. Optional blur/exposure affects the background. No diffusion or identity regeneration. Review cutout edges and occlusion in the output.',
    z.object({ requestId, request: subjectEffectRequestSchema }),
    async (input) => ({
      data: await api('/api/subject-effects/duplicates', input.request, input.requestId),
    }),
    false,
  );
  tool(
    'aftertake_finish_media',
    'Save a color-finished image or video with editable, hash-bound settings: exposure, contrast, white balance, eight-channel HSL, master/RGB curves, an imported display-sRGB .cube LUT, film look, sharpness, optical effects, vignette and grain. Redactions blur, pixelate or fill boxes, or every place a sampled detail (a name or key in a screen recording) appears; the receipt counts what was hidden. Retains original video timing and audio. An active LUT needs its exact companion file already imported in Color & finish. Does not alter generated object geometry.',
    z.object({ requestId, request: finishingRequestSchema }),
    async (input) => ({ data: await api('/api/finishing', input.request, input.requestId) }),
    false,
  );
  tool(
    'aftertake_effect_status',
    'Read an existing subject, finishing, still-image depth or layer-stack job by record ID or stable requestId. Status can resume tracking accepted work; it never submits a new generation.',
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
        : (
            await api<(SubjectEffectJob | FinishingJob | DepthEffectJob | LayerStackJob)[]>(path)
          ).find((item) => item.requestKey === input.requestId);
      if (!job) throw Error('No saved effect matches this request.');
      return { data: job };
    },
  );
  tool(
    'aftertake_compose_layers',
    'Compose up to eight still-image and adjustment layers with 27 blend modes, opacity, transforms, clipping and shape or image masks. Request layers are bottom first. Uses exact imported image-asset SHA256 bindings and the shared color pipeline; does not generate images or process video layers. Read status before retrying after a timeout. Save the recipe and exact image/mask companions for reproduction.',
    z.object({ requestId, request: layerStackRequestSchema }),
    async (input) => ({ data: await api('/api/layer-stacks', input.request, input.requestId) }),
    false,
  );
  tool(
    'aftertake_resolve_layers',
    'Rebind a portable layer-stack recipe to matching imported image assets by exact SHA256, without composing or generating anything. Import all source and mask images first; UUIDs can differ between machines. Returns a validated request for preview or composition.',
    z.object({ recipe: layerStackRecipeSchema }),
    async (input) => ({ data: await api('/api/layer-stacks/resolve', input.recipe) }),
  );
  tool(
    'aftertake_preview_layers',
    'Inspect the actual composited still-image PNG using the same layers, masks, transforms, blend modes and adjustment pipeline as export. Does not save a finished clip. Review transparency, edges and color before composing.',
    z.object({ request: layerStackRequestSchema }),
    async (input) => {
      const response = await fetch(base + '/api/layer-stacks/preview', {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input.request),
        signal: AbortSignal.timeout(305000),
      });
      if (!response.ok)
        throw Error((await response.json()).error || 'The layer preview is unavailable.');
      if (!response.headers.get('content-type')?.startsWith('image/png'))
        throw Error('The layer preview did not return a PNG.');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 20 * 1024 * 1024)
        throw Error('The preview exceeds the review image limit.');
      return {
        data: {
          canvas: input.request.canvas,
          layerCount: input.request.layers.length,
          review: 'Actual composited still-image preview; no video layers or generation.',
        },
        images: [{ data: bytes.toString('base64'), mimeType: 'image/png' }],
      };
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
