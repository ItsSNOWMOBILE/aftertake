import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileEditPlan, contentDigest, editPlanSchema, type PlanPicture } from './edit-plan.js';
import {
  narrationSchema,
  portableVoiceSource,
  filmManifestSchema,
  filmRequestSchema,
  filmTimeline,
  filmRenderRevision,
  type Film,
  type FilmAsset,
} from '../src/film.js';
import { displayDimensions, renderDimensions, type Render, type Clip } from '../src/domain.js';
import { clipMediaRoute, registerGenerationTools } from './generation-tools.js';
import { registerCharacterTools } from './character-tools.js';
import { registerEffectsTools } from './effects-tools.js';
import { registerRecompositionTools } from './recomposition-tools.js';
import { scriptRequestSchema } from '../src/script-draft.js';
import { toolAnnotations } from './tool-annotations.js';
import { resolveMediaRuntime } from './media-runtime.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function option(name: string, fallback: string) {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1] || fallback;
}
const endpoint = new URL(
  option('--url', process.env.AFTERTAKE_STUDIO_URL || 'http://127.0.0.1:4310'),
);
if (
  endpoint.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost'].includes(endpoint.hostname) ||
  endpoint.username ||
  endpoint.password ||
  endpoint.pathname !== '/' ||
  endpoint.search ||
  endpoint.hash
)
  throw Error('Use a loopback http://127.0.0.1:PORT studio URL.');
const base = endpoint.origin;
const mediaRoot = await realpath(option('--media-root', root));
const state = path.resolve(
  option('--state-dir', path.join(root, '.data/agent-plans')),
  createHash('sha256').update(base).digest('hex').slice(0, 12),
);
const pythonSuffix = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
const enginePython = path.join(root, '.runtime/venv', pythonSuffix);
const python = await resolveMediaRuntime({
  root,
  filmPython: path.join(root, '.runtime/film-venv', pythonSuffix),
  enginePython,
  override: option('--python', process.env.AFTERTAKE_PYTHON || ''),
});
await mkdir(state, { recursive: true });
const exec = promisify(execFile),
  uuid = z.string().uuid(),
  digest = z.string().regex(/^[a-f0-9]{64}$/);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function api<T = any>(route: string, body?: unknown, key?: string): Promise<T> {
  const response = await fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'error',
    headers:
      body === undefined
        ? undefined
        : { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(270000),
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error || `Studio request failed (${response.status}).`);
  return value;
}
async function bytes(route: string) {
  const response = await fetch(base + route, {
    redirect: 'error',
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw Error(`Media unavailable (${response.status}).`);
  if (Number(response.headers.get('content-length') || 0) > 100 * 1024 * 1024)
    throw Error('Review media must be under 100 MB.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 100 * 1024 * 1024) throw Error('Review media must be under 100 MB.');
  return buffer;
}
async function persist(id: string, value: unknown) {
  const file = path.join(state, id + '.json'),
    temp = file + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(value, null, 2));
  await rename(temp, file);
  return file;
}
async function planFile(id: string) {
  const value = JSON.parse(await readFile(path.join(state, id + '.json'), 'utf8'));
  if (value.base !== base || value.id !== id)
    throw Error('This plan belongs to a different workspace.');
  return value;
}
function retainedFilmDraft(project: unknown, resolved: unknown) {
  const draft = filmRequestSchema.parse(resolved);
  const editContent = (value: z.infer<typeof filmRequestSchema>) => ({
    ...value,
    shots: value.shots.map(({ assetId: _asset, renderId: _render, ...edit }) => edit),
    audio: value.audio?.map(({ assetId: _asset, ...edit }) => edit),
    graphics: value.graphics?.map(({ assetId: _asset, ...edit }) => edit),
  });
  if (
    contentDigest(editContent(draft)) !==
    contentDigest(editContent(filmRequestSchema.parse(project)))
  )
    throw Error(
      'The studio did not retain every edit setting. Restart it with the matching app version before saving or exporting this project.',
    );
  return draft;
}
async function inventory() {
  const [assets, takes, films] = await Promise.all([
    api<FilmAsset[]>('/api/films/assets'),
    api<Render[]>('/api/renders'),
    api<Film[]>('/api/films'),
  ]);
  return { assets, takes, films };
}
const filmSummary = (film: Film) => ({
  id: film.id,
  name: film.name,
  state: film.state,
  duration: film.duration,
  error: film.error,
  output: film.output,
  requestKey: film.requestKey,
});
async function pictureMap(
  visuals: { assetId?: string; renderId?: string }[],
  assets: FilmAsset[],
  takes: Render[],
) {
  const map = new Map<string, PlanPicture>();
  for (const shot of visuals) {
    const id = shot.assetId || shot.renderId!;
    if (map.has(id)) continue;
    if (shot.assetId) {
      const asset = assets.find((item) => item.id === id && item.kind !== 'audio');
      if (!asset) throw Error('Import the requested picture as film media first.');
      const actual = await bytes(`/api/films/assets/${id}/media`);
      if (hash(actual) !== asset.sha256)
        throw Error('A film picture changed on disk. Import it again.');
      map.set(id, {
        id,
        kind: asset.kind as 'image' | 'video',
        sha256: asset.sha256,
        duration: asset.duration,
      });
    } else {
      const take = takes.find(
        (item) => item.id === id && item.state === 'succeeded' && item.output,
      );
      if (!take) throw Error('Choose a completed local take.');
      const actual = await bytes(`/outputs/${id}.mp4`);
      map.set(id, {
        id,
        kind: 'video',
        sha256: hash(actual),
        duration: renderDimensions(take.recipe).duration,
      });
    }
  }
  return map;
}
const server = new McpServer({ name: 'aftertake-local-editor', version: '0.1.0' });
function tool(
  name: string,
  description: string,
  schema: z.ZodType,
  run: (input: any) => Promise<{ data: any; images?: { data: string; mimeType: string }[] }>,
  readOnly = true,
) {
  server.registerTool(
    name,
    {
      description,
      inputSchema: schema,
      annotations: toolAnnotations(name, readOnly),
    },
    async (input) => {
      try {
        const { data, images = [] } = await run(input);
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(data, null, 2) },
            ...images.map((image) => ({ type: 'image' as const, ...image })),
          ],
          structuredContent: data,
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: error instanceof Error ? error.message : String(error) },
          ],
        };
      }
    },
  );
}
const guide = {
  workflow: [
    'Inspect the brief and available media. Import only the user-selected files.',
    'Voice each short beat first; use the returned measured duration and hash.',
    'Choose source trims covering the full voice, lead and tail. Preserve source clocks across before/after cuts; do not add accidental zooms.',
    'Save a beat plan. Caption defaults to the actual narration text. Inspect its timing ledger and editable project before exporting.',
    'For authored camera moves, independent typography and music, save a complete native project with aftertake_save_film_edit. This checks the imported media without exporting.',
    'Export that plan once, retain its plan/job IDs and poll status. Repeating an export key rejoins the same native job.',
    'Review decoded frames and audio diagnostics, listen to the film, then revise only the affected beat. Technical checks do not establish visual or editorial quality.',
  ],
  constraints: {
    filmCuts: 48,
    beats: 32,
    seconds: 600,
    fps: 24,
    voice: 'Local Kokoro presets; no identity cloning.',
    inference:
      'Uses native Z-Image, Qwen, LTX, Wan and H3 workflows through the configured Comfy engine. Generate/inspect a reference, render a take, review actual frames, then use its renderId in the same film plan. Generative quality and motion adherence require review.',
  },
  generationWorkflow: [
    'Read aftertake_generation_workspace and check the needed model profile. Voice the short beat before choosing its available video coverage.',
    'Keep a stable requestId for each deliberate image, frame edit or video generation. Status rejoins native records after reconnection.',
    'A timeout is not failure. Reconcile a recorded uncertain admission with aftertake_generation_action using that same requestId.',
    'Inspect the actual generated image with clipId, or finished video with renderId. The user reviews the result before final delivery.',
    'For a completed native region edit with saved raw video, use aftertake_refine_blend to change only its final spatial area or color matching without generating again. Keep its CPU receipt separate from the original executed Comfy graph.',
  ],
  textVideo: {
    setup: 'python scripts/download-models.py --text-video',
    workflow: [
      'Check aftertake_generation_workspace with profile text-video.',
      'Call aftertake_generate_video with a stable requestId and the full shot/action/sound prompt. No source media is required.',
      'Poll aftertake_generation_status with kind video. Inspect its completed clipId using aftertake_inspect_picture; verify generated sound before delivery.',
      'Use aftertake_use_source to bring its clipId into Film, then assemble titles, narration and cuts in the same native project.',
    ],
    limits:
      '2–5 second shots on the native 8n+1 frame grid at 24 fps. Camera movement is prompt guidance; silent delivery omits the generated audio track.',
  },
  scriptDrafting: {
    setup: 'Optional: python scripts/setup-script.py',
    workflow:
      'Describe inspected pictures, request aftertake_draft_script, then poll aftertake_script_status. Review and edit the proposed copy before voicing it. Keep the original request to rejoin it; use aftertake_rejoin_script for an interrupted native worker.',
    limits:
      'Local Qwen3 sees supplied descriptions, not video. Suggestions can invent details. Applying or voicing unreviewed copy is not automatic.',
  },
  planSchema: z.toJSONSchema(editPlanSchema, { unrepresentable: 'any' }),
  reviewBoundary:
    'No social publishing or competition-submission tool is exposed. A user reviews the final film and submits it.',
  characterReplacement: {
    setup: 'python scripts/setup.py --character-swap',
    workflow: [
      'Read aftertake_character_workspace. Use the original identity photo directly, with an optional crop of its actual head; do not redraw the face through the frame editor.',
      'Track the person with aftertake_track_character, then inspect the real overlay with aftertake_inspect_character before accepting its mask.',
      'Call aftertake_replace_character with that mask hash and a separate stable requestId. Reconcile uncertain submissions using their existing record.',
      'Review the resulting identity, hands, occlusions and continuation boundaries. Promote its completed clipId into Film using aftertake_use_source.',
    ],
  },
};
tool(
  'aftertake_editing_guide',
  'Discover the narration-first editing workflow, actual plan schema, constraints and review steps.',
  z.object({}),
  async () => ({ data: guide }),
);
tool(
  'aftertake_workspace',
  'List local film pictures, voice clips, finished takes and exports. IDs and hashes identify media roles; source clips must be imported as film media before use.',
  z.object({
    query: z.string().max(200).default(''),
    limit: z.number().int().min(1).max(50).default(25),
  }),
  async ({ query, limit }) => {
    const { assets, takes, films } = await inventory(),
      matches = (name: string) => name.toLowerCase().includes(query.toLowerCase());
    const ready = [];
    for (const take of takes
      .filter((t) => t.state === 'succeeded' && t.output && matches(t.recipe.name))
      .slice(0, limit))
      ready.push({
        renderId: take.id,
        name: take.recipe.name,
        sha256: hash(await bytes(`/outputs/${take.id}.mp4`)),
        ...renderDimensions(take.recipe),
        ...displayDimensions(take.recipe),
      });
    return {
      data: {
        studio: base,
        filmAssets: assets.filter((a) => matches(a.name)).slice(0, limit),
        finishedTakes: ready,
        films: films
          .filter((f) => matches(f.name))
          .slice(0, limit)
          .map((f) => ({
            id: f.id,
            name: f.name,
            state: f.state,
            duration: f.duration,
            video: f.output ? base + f.output : undefined,
          })),
        totals: {
          filmAssets: assets.length,
          finishedTakes: takes.filter((t) => t.state === 'succeeded').length,
          films: films.length,
        },
      },
    };
  },
);
tool(
  'aftertake_import_media',
  'Import one selected local file for Film editing or studio generation. Paths stay under the configured media root; identical verified bytes are reused. Studio stills are normalized by the same native importer as the UI. No network media URL is accepted.',
  z.object({
    path: z.string().min(1).max(2000),
    destination: z.enum(['film', 'studio']).default('film'),
  }),
  async (input) => {
    const filename = await realpath(path.resolve(mediaRoot, input.path)),
      relative = path.relative(mediaRoot, filename);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative))
      throw Error('Choose a file inside the configured media root.');
    const info = await stat(filename);
    if (!info.isFile() || info.size > 100 * 1024 * 1024)
      throw Error('Choose a regular media file under 100 MB.');
    const data = await readFile(filename),
      sha256 = hash(data);
    if (input.destination === 'studio') {
      const clips = await api<Clip[]>('/api/clips');
      for (const clip of clips.filter(
        (clip) => clip.sha256 === sha256 || clip.originalSha256 === sha256,
      ))
        try {
          if (hash(await bytes(clipMediaRoute(clip))) === clip.sha256)
            return { data: { clip, reused: true, destination: 'studio' } };
        } catch {
          /* A stale copy is not a successful import. */
        }
      const response = await fetch(
        base + '/api/clips?name=' + encodeURIComponent(path.basename(filename)),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: data,
          redirect: 'error',
          signal: AbortSignal.timeout(60000),
        },
      );
      const clip = await response.json();
      if (!response.ok) throw Error(clip.error || 'Source import failed.');
      if (
        (clip.sha256 !== sha256 && clip.originalSha256 !== sha256) ||
        hash(await bytes(clipMediaRoute(clip))) !== clip.sha256
      )
        throw Error('The studio source does not match the selected bytes.');
      return { data: { clip, reused: false, destination: 'studio' } };
    }
    const assets = await api<FilmAsset[]>('/api/films/assets');
    const existing = assets.find((asset) => asset.sha256 === sha256);
    if (existing && hash(await bytes(`/api/films/assets/${existing.id}/media`)) === sha256)
      return { data: { asset: existing, reused: true } };
    const response = await fetch(
      base + '/api/films/assets?name=' + encodeURIComponent(path.basename(filename)),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data,
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
      },
    );
    const asset = await response.json();
    if (!response.ok) throw Error(asset.error || 'Media import failed.');
    if (asset.sha256 !== sha256) throw Error('Imported media does not match the selected file.');
    return { data: { asset, reused: false } };
  },
  false,
);
tool(
  'aftertake_voice',
  'Voice a short beat locally before choosing its picture duration. Set timedWords:true for model word timings used by spoken titles. Exact script/voice/speed/timing requests are reused. A busy/timeout response is not permission to launch a duplicate.',
  narrationSchema,
  async (input) => ({ data: { asset: await api('/api/films/narration', input) } }),
  false,
);
tool(
  'aftertake_inspect_picture',
  'Inspect decoded frames from one Film asset, studio source/generated media, or completed take before choosing trims. Returns the actual content hash and review images; preserves source orientation.',
  z
    .object({
      assetId: uuid.optional(),
      clipId: uuid.optional(),
      renderId: uuid.optional(),
      sha256: digest.optional(),
      times: z.array(z.number().min(0).max(600)).min(1).max(8).default([0]),
    })
    .refine(
      (input) => [input.assetId, input.clipId, input.renderId].filter(Boolean).length === 1,
      'Choose exactly one film asset, studio source or completed take.',
    ),
  async (input) => {
    const clip: Clip | undefined = input.clipId
      ? (await api<Clip[]>('/api/clips')).find((clip) => clip.id === input.clipId)
      : undefined;
    if (input.clipId && !clip)
      throw Error('Choose a source from the current generation workspace.');
    const { assets, takes } = await inventory(),
      asset = assets.find((a) => a.id === input.assetId),
      take = takes.find((t) => t.id === input.renderId && t.state === 'succeeded');
    if ((input.assetId && (!asset || asset.kind === 'audio')) || (input.renderId && !take))
      throw Error('Choose a picture asset or completed take from the current workspace.');
    const id = input.assetId || input.clipId || input.renderId,
      route = clip
        ? clipMediaRoute(clip)
        : asset
          ? `/api/films/assets/${id}/media`
          : `/outputs/${id}.mp4`;
    const data = await bytes(route),
      sha256 = hash(data),
      duration = clip?.duration || asset?.duration || renderDimensions(take!.recipe).duration;
    if (
      (input.sha256 && sha256 !== input.sha256) ||
      (asset && sha256 !== asset.sha256) ||
      (clip && sha256 !== clip.sha256)
    )
      throw Error('The inspected picture differs from its expected bytes.');
    if (
      input.times.some(
        (time: number) =>
          time >= duration || ((clip?.kind === 'image' || asset?.kind === 'image') && time !== 0),
      )
    )
      throw Error('Choose times inside the source video, or zero for a still image.');
    const folder = path.join(state, 'inspect', sha256);
    await mkdir(folder, { recursive: true });
    const source = path.join(
      folder,
      'source' + (clip ? path.extname(clip.url) : asset?.extension || '.mp4'),
    );
    await writeFile(source, data);
    const frames = [],
      images = [];
    for (const time of input.times) {
      const filename = `frame-${String(time).replace('.', '_')}.jpg`,
        file = path.join(folder, filename);
      await exec(
        python,
        [path.join(root, 'scripts/thumbnail.py'), source, file, String(time), '960'],
        { timeout: 30000, windowsHide: true },
      );
      frames.push({ requestedTime: time, file });
      images.push({ mimeType: 'image/jpeg', data: (await readFile(file)).toString('base64') });
    }
    return {
      data: {
        assetId: input.assetId,
        clipId: input.clipId,
        renderId: input.renderId,
        sha256,
        duration,
        frames,
        note: 'Video review frames are decoded at or immediately after the requested source time. Inspect action, framing and any unwanted motion before planning cuts.',
      },
      images,
    };
  },
);
tool(
  'aftertake_save_plan',
  'Compile and persist an editable, content-bound beat plan. Rejects insufficient footage, changed media and overlapping narration; it never truncates a voice or stretches a shot. Does not render.',
  editPlanSchema,
  async (input) => {
    const { assets, takes } = await inventory();
    const pictures = await pictureMap(
      input.beats.flatMap((beat: EditPlanBeat) => beat.visuals),
      assets,
      takes,
    );
    const voices = new Map(assets.filter((a) => a.kind === 'audio').map((a) => [a.id, a]));
    for (const beat of input.beats) {
      if (beat.voice) {
        const voice = voices.get(beat.voice.assetId);
        if (
          !voice ||
          hash(await bytes(`/api/films/assets/${voice.id}/media`)) !== beat.voice.sha256
        )
          throw Error('A voice clip is missing or changed.');
      }
    }
    const compiled = compileEditPlan(input, pictures, voices),
      id = compiled.identity;
    let record;
    try {
      record = await planFile(id);
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
    let changed = !record;
    if (!record) record = { id, base, createdAt: new Date().toISOString(), ...compiled };
    else {
      const audio = record.manifest.audio?.map((track: any) => {
        const voice = voices.get(track.assetId);
        return voice && voice.sha256 === track.sha256 && voice.narration
          ? { ...track, asset: portableVoiceSource(voice) }
          : track;
      });
      if (contentDigest(audio) !== contentDigest(record.manifest.audio)) {
        record = { ...record, manifest: { ...record.manifest, audio } };
        changed = true;
      }
    }
    // Enrich older saved projects while preserving their edit IDs and jobs.
    if (changed) {
      await persist(id, record);
      await writeFile(
        path.join(state, id + '.project.json'),
        JSON.stringify(record.manifest, null, 2),
      );
    }
    return {
      data: {
        planId: id,
        duration: record.duration,
        ledger: record.ledger,
        projectPath: path.join(state, id + '.project.json'),
        state: 'planned',
        note: 'Import the project in Film assembly to edit it. Export only after reviewing the paired beats.',
      },
    };
  },
  false,
);
type EditPlanBeat = { visuals: { assetId?: string; renderId?: string }[] };
tool(
  'aftertake_save_film_edit',
  'Save a complete editable native Film project with cuts, camera keyframes, animated text, shape/image graphic layers and audio. Graphics and titles support editable transform keyframes and easing. Verifies source hashes and timing without rendering. Revise the project to create a new plan ID; export and review through the same plan tools.',
  z.object({ project: filmManifestSchema }),
  async ({ project }) => {
    const draft = retainedFilmDraft(project, await api('/api/films/resolve', project));
    const timeline = filmTimeline(draft.shots);
    const duration = timeline.at(-1)!.end;
    if (draft.titles?.some((title) => title.end > duration + 0.001))
      throw Error('A title ends after the film.');
    if (draft.graphics?.some((graphic) => graphic.end > duration + 0.001))
      throw Error('A graphic ends after the film.');
    if (
      draft.audio?.some(
        (track) => track.start + track.sourceEnd - track.sourceStart > duration + 1 / 24,
      )
    )
      throw Error('An audio track ends after the film.');
    const id = contentDigest({
      format: 'aftertake-agent-film-edit/1',
      rendererRevision: filmRenderRevision,
      project,
    });
    let record;
    try {
      record = await planFile(id);
      if (contentDigest(record.manifest) !== contentDigest(project))
        throw Error('The saved edit differs from its project.');
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (!record) {
      record = {
        id,
        base,
        createdAt: new Date().toISOString(),
        manifest: project,
        duration,
        ledger: timeline.map((cut, index) => ({ shot: index + 1, ...cut })),
      };
      await persist(id, record);
      await writeFile(path.join(state, id + '.project.json'), JSON.stringify(project, null, 2));
    }
    return {
      data: {
        planId: id,
        duration,
        ledger: record.ledger,
        projectPath: path.join(state, id + '.project.json'),
        state: 'planned',
        note: 'This saved edit has not been rendered. Review it in Film assembly before exporting.',
      },
    };
  },
  false,
);
tool(
  'aftertake_export_plan',
  'Export a saved plan through the real native Film renderer. Repeating planId/attempt returns the same job. Increment attempt only after an observed failed export; a timeout is not failure.',
  z.object({ planId: digest, attempt: z.number().int().min(0).max(32).default(0) }),
  async ({ planId, attempt }) => {
    const record = await planFile(planId),
      key = `agent-${planId}-${attempt}`;
    const existing = (await api<Film[]>('/api/films')).find((f) => f.requestKey === key);
    if (existing)
      return {
        data: {
          planId,
          film: filmSummary(existing),
          video: existing.output ? base + existing.output : undefined,
        },
      };
    if (attempt > 0) {
      const previous = (await api<Film[]>('/api/films')).find(
        (f) => f.requestKey === `agent-${planId}-${attempt - 1}`,
      );
      if (previous?.state !== 'failed')
        throw Error(
          'Observe the previous attempt as failed before starting another. Use status to rejoin live or uncertain work.',
        );
    }
    const draft = retainedFilmDraft(
      record.manifest,
      await api('/api/films/resolve', record.manifest),
    );
    const film = await api<Film>('/api/films', draft, key);
    return {
      data: {
        planId,
        film: filmSummary(film),
        video: film.output ? base + film.output : undefined,
      },
    };
  },
  false,
);
tool(
  'aftertake_plan_status',
  'Read authoritative native export state for a saved plan. An empty result means no recorded admission was found, not that any timed-out work was canceled.',
  z.object({ planId: digest }),
  async ({ planId }) => {
    const record = await planFile(planId);
    const films = (await api<Film[]>('/api/films')).filter((f) =>
      f.requestKey?.startsWith(`agent-${planId}-`),
    );
    return {
      data: {
        planId,
        duration: record.duration,
        ledger: record.ledger,
        exports: films.map((f) => ({
          filmId: f.id,
          state: f.state,
          error: f.error,
          duration: f.duration,
          video: f.output ? base + f.output : undefined,
        })),
        projectPath: path.join(state, planId + '.project.json'),
      },
    };
  },
);
tool(
  'aftertake_review_film',
  'Decode an actual completed export and return review frames, audio diagnostics and embedded-project verification. Frame images support visual inspection; metrics alone do not certify editing or generation quality.',
  z.object({ filmId: uuid, times: z.array(z.number().min(0).max(600)).min(1).max(8).optional() }),
  async ({ filmId, times }) => {
    const film = await api<Film>(`/api/films/${filmId}/manifest`);
    if (film.state !== 'ready')
      throw Error('The film is not a completed export. Check plan status.');
    const data = await bytes(`/api/films/${filmId}/video`),
      sha256 = hash(data),
      folder = path.join(state, 'review', sha256);
    await mkdir(folder, { recursive: true });
    const file = path.join(folder, 'film.mp4');
    await writeFile(file, data);
    const requested = times || [
      Math.min(0.5, film.duration / 2),
      film.duration / 2,
      Math.max(0, film.duration - 0.25),
    ];
    if (requested.some((time: number) => time >= film.duration))
      throw Error('Choose review frames inside the film.');
    const request = path.join(folder, 'request.json');
    await writeFile(request, JSON.stringify({ source: file, output: folder, times: requested }));
    const { stdout } = await exec(python, [path.join(root, 'scripts/review-film.py'), request], {
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    const report = JSON.parse(stdout),
      embedded = report.manifest;
    delete report.manifest;
    const differences = [
      'name',
      'aspect',
      'resolution',
      'shots',
      'titles',
      'graphics',
      'audio',
      'sourceVolume',
      'normalizeAudio',
    ].filter(
      (key) =>
        contentDigest({ value: embedded[key] }) !== contentDigest({ value: (film as any)[key] }),
    );
    const embeddedProjectMatches = differences.length === 0;
    if (!embeddedProjectMatches)
      throw Error(
        'The encoded film project differs from its native export record: ' + differences.join(', '),
      );
    const images = [];
    for (const frame of report.frames)
      images.push({
        mimeType: 'image/jpeg',
        data: (await readFile(path.join(folder, frame.file))).toString('base64'),
      });
    return {
      data: {
        filmId,
        sha256,
        video: base + film.output,
        reviewDirectory: folder,
        embeddedProjectMatches,
        ...report,
        review:
          'Inspect all returned frames and listen to the full film before declaring the edit acceptable.',
      },
      images,
    };
  },
);
tool(
  'aftertake_draft_script',
  'Draft one short spoken line per described picture using the optional local open-weight script model. Returns a persisted native draft job. Keep the exact request to rejoin after a timeout. This model sees text descriptions; review its factual details before using its suggestions in a film.',
  scriptRequestSchema,
  async (input) => ({ data: await api('/api/script-drafts', input) }),
  false,
);
tool(
  'aftertake_script_status',
  'Observe the same native script draft by ID. Returns actual proposed lines and the local model receipt when complete; it does not apply text, voice it or start a new draft.',
  z.object({ draftId: uuid }),
  async ({ draftId }) => ({ data: await api('/api/script-drafts/' + draftId) }),
);
tool(
  'aftertake_rejoin_script',
  'Rejoin a script draft interrupted by studio restart, retaining its original request and result cache. The local worker lock prevents a second inference for that same draft if its original process is still finishing.',
  z.object({ draftId: uuid }),
  async ({ draftId }) => ({ data: await api('/api/script-drafts/' + draftId + '/reconcile', {}) }),
  false,
);
registerGenerationTools({ tool, api, bytes, base });
registerCharacterTools({ tool, api, bytes, root, python, state });
registerEffectsTools({ tool, api, base });
registerRecompositionTools({ tool, api });
await server.connect(new StdioServerTransport());
