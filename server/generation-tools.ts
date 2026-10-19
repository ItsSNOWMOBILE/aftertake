import { z } from 'zod';
import { createHash } from 'node:crypto';
import { recipeSchema, type Clip, type Engine } from '../src/domain.js';
import { imageRequestSchema } from '../src/image-generation.js';
import { videoRequestSchema } from '../src/video-generation.js';
import { frameEditRequestSchema } from '../src/frame-edit.js';
import type { FilmAsset } from '../src/film.js';

type Result = { data: any; images?: { data: string; mimeType: string }[] };
type Register = (
  name: string,
  description: string,
  schema: z.ZodType,
  run: (input: any) => Promise<Result>,
  readOnly?: boolean,
) => void;
type Generation = {
  id: string;
  state: string;
  progress?: number | null;
  stage?: string;
  error?: string;
  jobId?: string;
  requestKey?: string;
  requestDigest?: string;
  request?: { name?: string; prompt?: string; clip?: Clip };
  recipe?: { name?: string };
  clip?: Clip;
  output?: string;
  workflow?: Record<string, unknown>;
};
const kind = z.enum(['image', 'video', 'frame', 'take']),
  requestId = z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9_-]+$/),
  uuid = z.string().uuid(),
  sha = z.string().regex(/^[a-f0-9]{64}$/);
type Kind = z.infer<typeof kind>;
const routes = {
  image: '/api/images',
  video: '/api/videos',
  frame: '/api/frame-edits',
  take: '/api/renders',
} as const;
const terminal = new Set(['succeeded', 'failed', 'canceled', 'expired', 'output_error']);
const key = (type: Kind, id: string) =>
  `agent-${type}-` + createHash('sha256').update(id).digest('hex');

/** Only the selected studio's canonical media route can be used as a source. */
export function clipMediaRoute(clip: Clip) {
  uuid.parse(clip.id);
  if (
    !new RegExp('^/media/' + clip.id + '\\.(png|jpg|jpeg|webp|mp4|mov|webm|mkv|m4v)$', 'i').test(
      clip.url,
    )
  )
    throw Error('The source has no canonical studio media route. Reimport it in the studio.');
  return clip.url;
}

export function registerGenerationTools(context: {
  tool: Register;
  api: <T = any>(route: string, body?: unknown, key?: string) => Promise<T>;
  bytes: (route: string) => Promise<Buffer>;
  base: string;
}) {
  const { tool, api, bytes, base } = context,
    hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
  async function currentStudio(type?: Kind) {
    const workspace = await api('/api/workspace');
    if (workspace.generationProtocol !== 1)
      throw Error(
        'Restart the local studio with the current Aftertake code before using agent generation. Its persistent request-key protocol is required.',
      );
    if (type === 'video' && workspace.textVideoProtocol !== 1)
      throw Error('Restart the studio with text-to-video support before creating a video.');
    return workspace;
  }
  function summary(type: Kind, value: Generation) {
    return {
      kind: type,
      id: value.id,
      state: value.state,
      progress: value.progress,
      stage: value.stage,
      error: value.error,
      jobId: value.jobId,
      requestKey: value.requestKey,
      requestDigest: value.requestDigest,
      clip: value.clip,
      renderId: type === 'take' && value.state === 'succeeded' ? value.id : undefined,
      video: value.output ? base + value.output : undefined,
      recipe:
        type === 'take'
          ? base + routes.take + '/' + value.id
          : base + routes[type] + '/' + value.id + '/recipe',
    };
  }
  async function lookup(type: Kind, id: string) {
    const records = await api<Generation[]>(routes[type]);
    return records.find((record) => record.requestKey === key(type, id));
  }
  async function generate(type: Kind, id: string, input: unknown) {
    const workspace = await currentStudio(type);
    if (
      type === 'take' &&
      input !== null &&
      typeof input === 'object' &&
      'compositeRegion' in input &&
      input.compositeRegion &&
      workspace.compositeRegionProtocol !== 1
    )
      throw Error(
        'Restart the local studio with separate final blend area support before rendering this recipe.',
      );
    const result = await api<Generation>(routes[type], input, key(type, id));
    if (result.requestKey !== key(type, id))
      throw Error(
        'The studio did not retain this operation key. Inspect generation status before doing anything else.',
      );
    return {
      data: {
        requestId: id,
        ...summary(type, result),
        next: 'Keep this request ID and poll aftertake_generation_status. Repeating the identical request rejoins this record. Review actual output frames before assembling the film.',
      },
    };
  }
  tool(
    'aftertake_generation_workspace',
    'List generation source clips and actual image, frame-edit and video jobs. Optionally check one local model profile. This reads native state and starts no generation.',
    z.object({
      query: z.string().max(200).default(''),
      limit: z.number().int().min(1).max(50).default(25),
      profile: z
        .enum([
          'image-gen',
          'text-video',
          'frame-edit',
          'inpaint',
          'cinema',
          'motion',
          'motion-transfer',
          'structure',
        ])
        .optional(),
    }),
    async ({ query, limit, profile }) => {
      const workspace = await currentStudio();
      if (profile === 'text-video' && workspace.textVideoProtocol !== 1)
        throw Error('Restart the studio with text-to-video support.');
      const [sources, images, videos, frames, takes] = await Promise.all([
        api<Clip[]>('/api/clips'),
        api<Generation[]>(routes.image),
        workspace.textVideoProtocol === 1 ? api<Generation[]>(routes.video) : Promise.resolve([]),
        api<Generation[]>(routes.frame),
        api<Generation[]>(routes.take),
      ]);
      const matches = (name: string) => name.toLowerCase().includes(query.toLowerCase()),
        name = (r: Generation) => r.request?.name || r.recipe?.name || r.request?.prompt || '';
      return {
        data: {
          studio: base,
          persistentRequestsSupported: workspace.generationProtocol === 1,
          textVideoSupported: workspace.textVideoProtocol === 1,
          sources: sources.filter((c) => matches(c.name)).slice(0, limit),
          generations: (
            [
              ['image', images],
              ['video', videos],
              ['frame', frames],
              ['take', takes],
            ] as const
          ).flatMap(([type, records]) =>
            records
              .filter((r) => matches(name(r)))
              .slice(0, limit)
              .map((r) => summary(type, r)),
          ),
          engine: profile ? await api<Engine>('/api/engine?pipeline=' + profile) : undefined,
          note: 'A completed take can be used by renderId in a film plan. Text-to-video returns a source clipId; use aftertake_use_source to bring it, another source or a generated still into Film.',
        },
      };
    },
  );
  tool(
    'aftertake_generate_image',
    'Create a real Z-Image Turbo image through the native Comfy SDK workflow. Give this deliberate operation a stable requestId; keep the same ID and inputs after a timeout or reconnect.',
    z.object({ requestId, request: imageRequestSchema }),
    async (input) => generate('image', input.requestId, input.request),
    false,
  );
  tool(
    'aftertake_generate_video',
    'Generate native LTX-2.5 video directly from text, with optional synchronized model-generated sound. No source image or footage is used. Keep the same requestId and inputs after timeouts; inspect the resulting clip before Film handoff.',
    z.object({ requestId, request: videoRequestSchema }),
    async (input) => generate('video', input.requestId, input.request),
    false,
  );
  tool(
    'aftertake_edit_frame',
    'Create a Qwen edited frame from a canonical studio source and optional subject reference. Keep the same requestId and inputs when rejoining; inspect the resulting image before using it as a video guide.',
    z.object({ requestId, request: frameEditRequestSchema }),
    async (input) => generate('frame', input.requestId, input.request),
    false,
  );
  tool(
    'aftertake_render_take',
    'Render a real native video recipe: reference animation, painted region editing, or motion transfer. Uses the same asset validation, model profiles, SDK workflow and reviewed output path as the UI. Give each deliberate revision its own requestId.',
    z.object({ requestId, recipe: recipeSchema }),
    async (input) => generate('take', input.requestId, input.recipe),
    false,
  );
  tool(
    'aftertake_generation_status',
    'Rejoin a persisted generation by kind and the original requestId, including after reconnect. Reads actual native state; a timeout is not cancellation and no new generation starts.',
    z.object({ kind, requestId, includeWorkflow: z.boolean().default(false) }),
    async (input) => {
      await currentStudio(input.kind);
      const found = await lookup(input.kind, input.requestId);
      if (!found)
        return {
          data: {
            kind: input.kind,
            requestId: input.requestId,
            state: 'not_found',
            note: 'No native record with this operation key is visible. Repeating the original request with the same ID and inputs can safely admit or rejoin it; do not invent a new ID because of a timeout.',
          },
        };
      const value =
        input.kind === 'take' ? await api<Generation>(routes.take + '/' + found.id) : found;
      return {
        data: {
          requestId: input.requestId,
          ...summary(input.kind, value),
          ...(input.includeWorkflow
            ? {
                request: value.request || value.recipe,
                workflow: value.workflow,
                workflowRole:
                  value.state === 'succeeded'
                    ? 'verified completed output'
                    : 'planned; output not verified',
              }
            : {}),
        },
      };
    },
  );
  tool(
    'aftertake_generation_action',
    'Cancel an active generation or reconcile a recorded uncertain admission using its original native job/key. Reconciliation never changes its inputs. Use status to observe completion; terminal records are retained.',
    z.object({ kind, requestId, action: z.enum(['cancel', 'reconcile']) }),
    async (input) => {
      await currentStudio(input.kind);
      const found = await lookup(input.kind, input.requestId);
      if (!found)
        throw Error(
          'No native generation with this request ID was found. Check status and retain the original request.',
        );
      if (input.action === 'cancel' && terminal.has(found.state))
        return {
          data: {
            requestId: input.requestId,
            ...summary(input.kind, found),
            note: 'This generation is already terminal.',
          },
        };
      const value = await api<Generation>(
        routes[input.kind as Kind] + '/' + uuid.parse(found.id) + '/' + input.action,
        {},
      );
      return { data: { requestId: input.requestId, ...summary(input.kind, value) } };
    },
    false,
  );
  tool(
    'aftertake_use_source',
    'Bring a canonical studio image or video, including a completed character take, into Film without changing its bytes. Requires the inspected source hash and reuses an existing verified film asset. Ordinary video takes can also be used directly by renderId.',
    z.object({ clipId: uuid, sha256: sha }),
    async (input) => {
      const source = (await api<Clip[]>('/api/clips')).find((clip) => clip.id === input.clipId);
      if (!source || source.sha256 !== input.sha256)
        throw Error('The selected source is missing or its content changed. Inspect it again.');
      const data = await bytes(clipMediaRoute(source));
      if (hash(data) !== source.sha256)
        throw Error('The source bytes differ from their saved receipt.');
      const assets = await api<FilmAsset[]>('/api/films/assets');
      for (const asset of assets.filter(
        (asset) => asset.kind !== 'audio' && asset.sha256 === source.sha256,
      )) {
        const id = uuid.parse(asset.id);
        try {
          if (hash(await bytes('/api/films/assets/' + id + '/media')) === source.sha256)
            return { data: { asset, reused: true, sourceClipId: source.id } };
        } catch {
          /* A missing earlier copy does not hide a usable source. */
        }
      }
      const extension = source.url.slice(source.url.lastIndexOf('.')),
        name = source.name.replace(/\.[a-z0-9]+$/i, '') + extension;
      const response = await fetch(base + '/api/films/assets?name=' + encodeURIComponent(name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(data),
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
      });
      const asset = await response.json();
      if (!response.ok) throw Error(asset.error || 'The source could not be imported into Film.');
      if (asset.sha256 !== source.sha256) throw Error('The film asset differs from its source.');
      return { data: { asset, reused: false, sourceClipId: source.id } };
    },
    false,
  );
}
