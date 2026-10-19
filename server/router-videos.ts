import { Router } from 'express';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import path from 'node:path';
import { z } from 'zod';
import { clipSchema } from '../src/domain.js';
import {
  routerTargetSchema,
  routerVideoBusy,
  routerVideoModel,
  routerVideoRequestSchema,
  routerVideoStateSchema,
  type RouterConnectionStatus,
  type RouterVideoGeneration,
  type RouterVideoRequest,
} from '../src/router-video.js';
import {
  createRouterConnection,
  RouterError,
  type RouterClient,
  type RouterLtxInput,
} from './router-client.js';
import { downloadRouterMedia, inspectRouterMedia, type RouterMediaInfo } from './router-media.js';
import { contentDigest } from './edit-plan.js';
import { generationAdmission, generationKeyConflict } from './generation-admission.js';
import { RequestError } from './http-errors.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const submitPath = '/v2/models/ltx/ltx-2-5-fast/requests?reject_unknown_fields=true';
const reconnectMessage = 'Reconnect the original Comfy API key, then check this saved request.';
type Intent = { method: 'POST'; path: typeof submitPath; body: RouterLtxInput; key: string };
type StoredVideo = RouterVideoGeneration & {
  intent: Intent;
  intentDigest: string;
  cancelRequestedAt?: string;
};

export function routerLtxInput(request: RouterVideoRequest): RouterLtxInput {
  return {
    prompt: request.prompt,
    duration: request.seconds,
    resolution: request.aspect === 'portrait' ? '720x1280' : '1280x720',
    fps: 24,
    generate_audio: request.sound,
  };
}

function intentDigest(video: Omit<StoredVideo, 'intentDigest'>) {
  return contentDigest({
    id: video.id,
    target: video.target,
    request: video.request,
    requestKey: video.requestKey,
    requestDigest: video.requestDigest,
    createdAt: video.createdAt,
    intent: video.intent,
  });
}

function assertIntent(video: StoredVideo) {
  const target = routerTargetSchema.safeParse(video.target);
  if (
    !uuid.test(video.id) ||
    !target.success ||
    typeof video.requestKey !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(video.requestKey) ||
    video.requestDigest !== contentDigest(video.request) ||
    video.credentialFingerprint !== target.data.credentialFingerprint ||
    video.intent?.method !== 'POST' ||
    video.intent.path !== submitPath ||
    video.intent.key !== video.id ||
    contentDigest(video.intent.body) !== contentDigest(routerLtxInput(video.request)) ||
    video.intentDigest !== intentDigest(video)
  )
    throw new RequestError(
      'The saved hosted request changed. Keep it for review; no provider action was taken.',
      409,
    );
}

function publicVideo(video: StoredVideo): RouterVideoGeneration {
  return structuredClone({
    id: video.id,
    target: video.target,
    request: video.request,
    requestKey: video.requestKey,
    requestDigest: video.requestDigest,
    providerRequestId: video.providerRequestId,
    credentialFingerprint: video.credentialFingerprint,
    state: video.state,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
    progress: video.progress,
    stage: video.stage,
    error: video.error,
    clip: video.clip,
  });
}

function safeFailure(error: unknown, fallback: string) {
  return error instanceof RouterError || error instanceof RequestError ? error.message : fallback;
}

/** Hosted jobs never enter the native GPU coordinator or modify its SDK client. */
export async function routerVideoRouter(context: {
  root: string;
  data: string;
  python: string;
  connection?: ReturnType<typeof createRouterConnection>;
  now?: () => number;
  persist?: (filename: string, value: StoredVideo) => Promise<void>;
  download?: (url: string) => Promise<Buffer>;
  inspect?: (filename: string) => Promise<RouterMediaInfo>;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}) {
  const router = Router();
  const connection = context.connection || createRouterConnection();
  const now = context.now || Date.now;
  const folder = path.join(context.data, 'router-videos');
  const clips = path.join(context.data, 'clips');
  await Promise.all([folder, clips].map((directory) => mkdir(directory, { recursive: true })));
  const records = new Map<string, StoredVideo>();
  const clients = new Map<string, RouterClient>();
  const active = new Map<string, { controller: AbortController; task: Promise<void> }>();
  const tasks = new Set<Promise<void>>();
  const admissionScope = randomUUID();
  let admitting = false;
  let disconnectedVersion = 0;
  let closed = false;
  let authenticated: boolean | undefined;
  let checkedAt: string | null = null;
  let admissionIssue: string | undefined;

  function status(): RouterConnectionStatus {
    return {
      admissionScope,
      configured: connection.snapshot().configured,
      authenticated,
      checkedAt,
      model: routerVideoModel,
      credentialStorage: 'memory',
      admissionIssue,
    };
  }

  async function persist(video: StoredVideo) {
    video.updatedAt = new Date(now()).toISOString();
    const filename = path.join(folder, video.id + '.json');
    if (context.persist) return context.persist(filename, structuredClone(video));
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(video, null, 2));
      await rename(temporary, filename);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  async function remember(video: StoredVideo) {
    try {
      await persist(video);
    } catch {
      // Retain accepted IDs in memory even while the durable volume is unavailable.
      console.warn(
        'Could not save hosted generation state. The original request remains in memory.',
      );
    }
  }

  function boundClient(video: StoredVideo) {
    assertIntent(video);
    const retained = clients.get(video.id);
    if (retained) return retained;
    const client = connection.capture(video.target.credentialFingerprint);
    clients.set(video.id, client);
    return client;
  }

  async function collect(video: StoredVideo, client: RouterClient, signal: AbortSignal) {
    const result = await client.result(video.providerRequestId!);
    signal.throwIfAborted();
    const bytes = await (context.download || downloadRouterMedia)(result.videoUrl);
    signal.throwIfAborted();
    const filename = path.join(clips, video.id + '.mp4');
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes);
      const media = await inspectRouterMedia(temporary, video.request, context, context.inspect);
      signal.throwIfAborted();
      await rename(temporary, filename);
      const clip = {
        id: video.id,
        name: video.request.name,
        kind: 'video' as const,
        width: media.width,
        height: media.height,
        duration: media.duration,
        hasAudio: media.hasAudio,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        url: `/media/${video.id}.mp4`,
      };
      const metadata = path.join(clips, video.id + '.json');
      const temporaryMetadata = `${metadata}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryMetadata, JSON.stringify(clip, null, 2));
        await rename(temporaryMetadata, metadata);
      } finally {
        await unlink(temporaryMetadata).catch(() => undefined);
      }
      video.clip = clip;
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  function track(video: StoredVideo, client: RouterClient) {
    if (closed || active.has(video.id)) return;
    const controller = new AbortController();
    const task = (async () => {
      let completed = false;
      try {
        assertIntent(video);
        for (;;) {
          if (controller.signal.aborted) return;
          const remote = await client.status(video.providerRequestId!);
          if (controller.signal.aborted) return;
          if (remote.status === 'COMPLETED') {
            completed = true;
            video.state = 'finalizing';
            video.stage = 'Downloading and checking hosted video';
            delete video.error;
            await remember(video);
            await collect(video, client, controller.signal);
            if (controller.signal.aborted) return;
            video.state = 'succeeded';
            video.progress = 1;
            video.stage = 'Ready to add to Film';
            delete video.error;
            await remember(video);
            clients.delete(video.id);
            return;
          }
          if (remote.status === 'FAILED' || remote.status === 'CANCELED') {
            video.state = remote.status === 'CANCELED' ? 'canceled' : 'failed';
            video.stage =
              remote.status === 'CANCELED' ? 'Canceled by provider' : 'Hosted generation failed';
            video.error =
              remote.status === 'FAILED'
                ? 'Comfy reports that this hosted generation failed.'
                : undefined;
            await remember(video);
            clients.delete(video.id);
            return;
          }
          video.state = video.cancelRequestedAt
            ? 'canceling'
            : remote.status === 'IN_QUEUE'
              ? 'queued'
              : 'running';
          video.stage = video.cancelRequestedAt
            ? 'Cancellation requested; checking original request'
            : remote.status === 'IN_QUEUE'
              ? 'Waiting for Comfy Router'
              : 'Generating on hosted LTX';
          delete video.error;
          await remember(video);
          if (context.wait) await context.wait(remote.retryAfterMs, controller.signal);
          else
            await wait(remote.retryAfterMs, undefined, { signal: controller.signal, ref: false });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        video.state = completed ? 'output_error' : 'connection_lost';
        video.error = safeFailure(
          error,
          completed
            ? 'The completed video could not be collected. Check the original request to collect it again.'
            : 'The provider connection was interrupted. Check this original request to continue.',
        );
        await remember(video);
      } finally {
        if (active.get(video.id)?.controller === controller) active.delete(video.id);
      }
    })();
    active.set(video.id, { controller, task });
    tasks.add(task);
    void task.finally(() => tasks.delete(task));
  }

  async function submit(video: StoredVideo, client: RouterClient, version = disconnectedVersion) {
    assertIntent(video);
    if (version !== disconnectedVersion || closed) {
      video.state = video.providerRequestId ? 'connection_lost' : 'submission_unknown';
      video.error = reconnectMessage;
      await remember(video);
      return;
    }
    const result = await client.submit(video.intent.body, video.intent.key);
    // Never discard the accepted handle if the following persistence fails.
    video.providerRequestId = result.requestId;
    video.state = result.status === 'IN_QUEUE' ? 'queued' : 'running';
    delete video.error;
    await remember(video);
    if (version !== disconnectedVersion || closed) {
      video.state = 'connection_lost';
      video.error = reconnectMessage;
      await remember(video);
      return;
    }
    clients.set(video.id, client);
    track(video, client);
  }

  for (const filename of await readdir(folder)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(filename)) continue;
    try {
      const value = JSON.parse(await readFile(path.join(folder, filename), 'utf8')) as StoredVideo;
      value.request = routerVideoRequestSchema.parse(value.request);
      value.state = routerVideoStateSchema.parse(value.state);
      value.target = routerTargetSchema.parse(value.target);
      if (
        filename !== value.id + '.json' ||
        !Number.isFinite(Date.parse(value.createdAt)) ||
        !Number.isFinite(Date.parse(value.updatedAt)) ||
        (value.providerRequestId && !uuid.test(value.providerRequestId))
      )
        throw Error();
      assertIntent(value);
      value.progress = value.progress === 1 ? 1 : null;
      value.stage = undefined;
      value.error =
        value.state === 'failed'
          ? 'Comfy reports that this hosted generation failed.'
          : value.state === 'output_error'
            ? 'Collect the original completed hosted request again.'
            : undefined;
      if (value.clip) {
        value.clip = clipSchema.parse(value.clip);
        if (value.clip.id !== value.id || value.clip.url !== `/media/${value.id}.mp4`)
          throw Error();
      }
      if (value.state === 'succeeded') {
        const bytes = await readFile(path.join(clips, value.id + '.mp4')).catch(() => null);
        if (
          !value.clip ||
          !bytes ||
          createHash('sha256').update(bytes).digest('hex') !== value.clip.sha256
        ) {
          value.state = 'output_error';
          value.error =
            'The saved hosted video is missing or changed. Collect the original request again.';
        }
      } else if (routerVideoBusy(value)) {
        value.state = value.providerRequestId ? 'connection_lost' : 'submission_unknown';
        value.error = reconnectMessage;
      }
      records.set(value.id, value);
      await remember(value);
    } catch {
      admissionIssue =
        'A saved hosted request needs review. Restore its original record before starting another paid generation.';
      console.warn(
        'A saved hosted generation could not be read. Its file was retained for review.',
      );
    }
  }

  router.get('/connection', (_req, res) => res.json(status()));
  router.post('/connection', (req, res) => {
    const input = z
      .object({ apiKey: z.string().trim().min(1).max(1024) })
      .strict()
      .parse(req.body);
    connection.configure(input.apiKey);
    authenticated = undefined;
    checkedAt = null;
    res.json(status());
  });
  router.post('/connection/probe', async (_req, res) => {
    const client = connection.capture();
    const result = await client.probe();
    if (connection.snapshot().credentialFingerprint === client.fingerprint) {
      authenticated = result.authenticated;
      checkedAt = new Date(now()).toISOString();
    }
    res.json(status());
  });
  router.delete('/connection', async (_req, res) => {
    disconnectedVersion++;
    connection.disconnect();
    authenticated = undefined;
    checkedAt = null;
    for (const item of active.values()) item.controller.abort();
    active.clear();
    clients.clear();
    for (const video of records.values()) {
      if (!routerVideoBusy(video)) continue;
      video.state = video.providerRequestId ? 'connection_lost' : 'submission_unknown';
      video.error = reconnectMessage;
      await remember(video);
    }
    res.json(status());
  });
  router.post('/estimate', async (req, res) => {
    const request = routerVideoRequestSchema.parse(req.body?.request);
    res.json({ quote: await connection.capture().estimate(routerLtxInput(request)) });
  });
  router.get('/', (_req, res) =>
    res.json(
      [...records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicVideo),
    ),
  );
  router.get('/:id', (req, res) => {
    const video = records.get(req.params.id);
    if (!video) return void res.sendStatus(404);
    res.json(publicVideo(video));
  });
  router.get('/:id/request', (req, res) => {
    const video = records.get(req.params.id);
    if (!video) return void res.sendStatus(404);
    assertIntent(video);
    res.json({
      format: 'aftertake-hosted-video-record/1',
      provider: 'comfy-router',
      model: routerVideoModel,
      request: video.request,
      input: video.intent.body,
      ...(video.clip
        ? {
            output: {
              sha256: video.clip.sha256,
              duration: video.clip.duration,
              width: video.clip.width,
              height: video.clip.height,
              hasAudio: video.clip.hasAudio,
            },
          }
        : {}),
    });
  });
  router.post('/', async (req, res) => {
    const request = routerVideoRequestSchema.parse(req.body);
    const key = req.get('Idempotency-Key');
    if (!key)
      throw new RequestError('Supply a stable Idempotency-Key before creating hosted video.');
    const admission = generationAdmission(key, request, records.values());
    if (admission.conflict) throw new RequestError(generationKeyConflict, 409);
    if (admission.existing)
      return void res
        .status(routerVideoBusy(admission.existing) ? 202 : 200)
        .json(publicVideo(admission.existing));
    if (admissionIssue) throw new RequestError(admissionIssue, 409);
    if (req.get('X-Aftertake-Admission-Scope') !== admissionScope)
      return void res.status(409).json({
        code: 'admission_scope_changed',
        error:
          'The server session changed. Check the original hosted request before starting another.',
      });
    if (closed || admitting || [...records.values()].some(routerVideoBusy))
      throw new RequestError(
        'Another hosted generation needs to finish or be recovered first.',
        409,
      );
    const client = connection.capture();
    if (!existsSync(context.python))
      throw new RequestError(
        'Install the CPU Film runtime with python scripts/setup-film.py before hosted generation.',
        409,
      );
    const id = randomUUID();
    const createdAt = new Date(now()).toISOString();
    const initial: Omit<StoredVideo, 'intentDigest'> = {
      id,
      request,
      ...admission.identity,
      credentialFingerprint: client.fingerprint,
      target: {
        format: 'aftertake-router-target/1' as const,
        provider: 'comfy-router' as const,
        origin: 'https://api.comfy.org' as const,
        model: routerVideoModel,
        credentialFingerprint: client.fingerprint,
      },
      state: 'submitting' as const,
      createdAt,
      updatedAt: createdAt,
      progress: null,
      intent: { method: 'POST' as const, path: submitPath, body: routerLtxInput(request), key: id },
    };
    const video: StoredVideo = { ...initial, intentDigest: intentDigest(initial) };
    const version = disconnectedVersion;
    admitting = true;
    records.set(id, video);
    try {
      try {
        await persist(video);
      } catch {
        video.state = 'failed';
        video.error = 'The hosted request could not be saved. No provider generation was started.';
        await remember(video);
        return void res.status(500).json({ error: video.error, video: publicVideo(video) });
      }
      try {
        await submit(video, client, version);
        res.status(201).json(publicVideo(video));
      } catch (error) {
        video.state =
          error instanceof RouterError && error.definitiveRejection
            ? 'failed'
            : 'submission_unknown';
        video.error = safeFailure(
          error,
          'Submission could not be confirmed. Keep this original request for recovery.',
        );
        clients.set(id, client);
        await remember(video);
        res
          .status(error instanceof RouterError ? error.status : 502)
          .json({ error: video.error, video: publicVideo(video) });
      }
    } finally {
      admitting = false;
    }
  });
  router.post('/:id/reconcile', async (req, res) => {
    const video = records.get(req.params.id);
    if (!video) return void res.sendStatus(404);
    if (!['submission_unknown', 'connection_lost', 'output_error'].includes(video.state))
      return void res.json(publicVideo(video));
    const client = boundClient(video);
    if (video.providerRequestId) {
      track(video, client);
      return void res.json(publicVideo(video));
    }
    const age = now() - Date.parse(video.createdAt);
    if (age < 0 || age > 23 * 60 * 60 * 1000)
      throw new RequestError(
        'The safe provider replay window has expired. Review this original request before deliberately creating a new take.',
        409,
      );
    if (
      admitting ||
      [...records.values()].some((other) => other.id !== video.id && routerVideoBusy(other))
    )
      throw new RequestError('Another hosted generation is active.', 409);
    admitting = true;
    try {
      try {
        await submit(video, client);
        res.json(publicVideo(video));
      } catch (error) {
        video.error = safeFailure(
          error,
          'The original hosted submission still could not be confirmed.',
        );
        await remember(video);
        res
          .status(error instanceof RouterError ? error.status : 502)
          .json({ error: video.error, video: publicVideo(video) });
      }
    } finally {
      admitting = false;
    }
  });
  router.post('/:id/cancel', async (req, res) => {
    const video = records.get(req.params.id);
    if (!video) return void res.sendStatus(404);
    if (!routerVideoBusy(video)) return void res.json(publicVideo(video));
    const client = boundClient(video);
    if (!video.providerRequestId)
      throw new RequestError(
        'The original provider handle is unresolved. Check its submission before canceling.',
        409,
      );
    await client.cancel(video.providerRequestId);
    if (routerVideoBusy(video)) {
      video.cancelRequestedAt = new Date(now()).toISOString();
      video.state = 'canceling';
      video.stage = 'Cancellation requested; checking original request';
      await remember(video);
      track(video, client);
    }
    res.json(publicVideo(video));
  });
  router.use(
    (
      error: unknown,
      _req: unknown,
      res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      if (error instanceof RouterError)
        return void res.status(error.status).json({ error: error.message, code: error.code });
      next(error);
    },
  );

  return {
    router,
    async close() {
      closed = true;
      disconnectedVersion++;
      connection.disconnect();
      clients.clear();
      for (const task of active.values()) task.controller.abort();
      active.clear();
      await Promise.allSettled([...tasks]);
    },
  };
}
