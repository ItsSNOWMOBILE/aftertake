import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { filmRouter } from '../server/films.js';
import { contentDigest } from '../server/edit-plan.js';
import { filmRequestSchema } from '../src/film.js';
import { motionPreset } from '../src/film-motion.js';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

async function remove(directory: string) {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('aftertake-agent-test-'));
  await rm(directory, { recursive: true, force: true });
}
test('native exports rejoin a persisted idempotency key and reject a changed edit; exact voice caches verify bytes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-agent-test-'));
  const folder = path.join(directory, 'films'),
    assets = path.join(folder, 'assets');
  await mkdir(assets, { recursive: true });
  const picture = '00000000-0000-4000-8000-000000000001',
    voiceId = '00000000-0000-4000-8000-000000000002';
  const draft = filmRequestSchema.parse({
    name: 'Recover this exact edit',
    aspect: 'portrait',
    shots: [{ assetId: picture, start: 0, end: 2 }],
  });
  const film = {
    id: picture,
    ...draft,
    state: 'ready',
    createdAt: new Date().toISOString(),
    duration: 2,
    requestKey: 'agent-persisted',
    requestDigest: contentDigest(draft),
  };
  await writeFile(path.join(folder, picture + '.json'), JSON.stringify(film));
  const bytes = Buffer.from('exact cached voice bytes'),
    input = { text: 'Measure this line.', voice: 'af_heart', speed: 1 };
  await writeFile(path.join(assets, voiceId + '.wav'), bytes);
  await writeFile(
    path.join(assets, voiceId + '.json'),
    JSON.stringify({
      id: voiceId,
      name: 'Cached voice',
      kind: 'audio',
      extension: '.wav',
      duration: 1,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      createdAt: new Date().toISOString(),
      narration: { ...input, model: 'Kokoro' },
    }),
  );
  const app = express();
  app.use(express.json());
  app.use('/api/films', await filmRouter(directory, directory, process.execPath, new Map()));
  app.use(
    (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(400).json({ error: error.message });
    },
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/films`;
  const post = (route: string, body: unknown, key?: string) =>
    fetch(base + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify(body),
    });
  try {
    const resumed = await post('', draft, 'agent-persisted');
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).id, picture);
    assert.equal(
      (await post('', { ...draft, name: 'Changed edit' }, 'agent-persisted')).status,
      409,
    );
    assert.equal((await post('', draft, 'bad key with spaces')).status, 400);
    const cached = await post('/narration', input);
    assert.equal(cached.status, 200);
    assert.equal((await cached.json()).id, voiceId);
    await writeFile(path.join(assets, voiceId + '.wav'), 'different bytes');
    assert.equal((await post('/narration', input)).status, 409);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await remove(directory);
  }
});
test('the real MCP stdio server discovers typed editing tools and confines imports to its configured media root', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-agent-test-'));
  const app = express();
  app.use(express.json());
  for (const route of ['/api/films/assets', '/api/renders', '/api/films'])
    app.get(route, (_req, res) => res.json([]));
  let resolveCalls = 0;
  let retainCamera = true;
  let retainFit = true;
  let retainGraphics = true;
  let retainResolution = true;
  let retainTitleMotion = true;
  let exportCalls = 0;
  let exportedDraft: any;
  let reviewFilm: any;
  let receivedFit: unknown;
  app.post('/api/films/resolve', (req, res) => {
    resolveCalls++;
    const { format: _format, ...draft } = req.body;
    receivedFit = draft.shots[0]?.framing?.fit;
    if (!retainCamera)
      draft.shots = draft.shots.map((shot: any) => {
        const { keyframes: _keys, ...framing } = shot.framing;
        return { ...shot, framing };
      });
    if (!retainFit)
      draft.shots = draft.shots.map((shot: any) => {
        const { fit: _fit, ...framing } = shot.framing;
        return { ...shot, framing };
      });
    if (!retainGraphics) delete draft.graphics;
    if (!retainResolution) delete draft.resolution;
    if (!retainTitleMotion)
      draft.titles = draft.titles?.map(({ motion: _motion, ...title }: any) => title);
    res.json(draft);
  });
  const filmId = '00000000-0000-4000-8000-000000000098';
  app.post('/api/films', (req, res) => {
    exportCalls++;
    exportedDraft = req.body;
    res.status(202).json({
      ...req.body,
      id: filmId,
      state: 'assembling',
      duration: 2,
      requestKey: req.get('Idempotency-Key'),
    });
  });
  app.get('/api/films/:id/manifest', (_req, res) => res.json(reviewFilm));
  app.get('/api/films/:id/video', (_req, res) => res.send(Buffer.from('review transport fixture')));
  // Only the native review process is stubbed. The MCP protocol, loopback API,
  // portable project parsing and retention comparisons all run normally.
  const reviewResultFile = path.join(directory, 'review-result.json');
  const reviewHook = path.join(directory, 'review-process-fixture.mjs');
  await writeFile(
    reviewHook,
    `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
const original = childProcess.execFile;
const originalAsync = promisify(original);
function intercepted(...args) { return original(...args); }
intercepted[promisify.custom] = async (file, args, options) => {
  if (args?.[0]?.endsWith('review-film.py')) {
    return { stdout: await readFile(${JSON.stringify(reviewResultFile)}, 'utf8'), stderr: '' };
  }
  return originalAsync(file, args, options);
};
childProcess.execFile = intercepted;
syncBuiltinESMExports();
`,
  );
  const draftId = '00000000-0000-4000-8000-000000000099';
  let scriptCalls = 0,
    rejoinCalls = 0;
  app.post('/api/script-drafts', (req, res) => {
    scriptCalls++;
    assert.equal(req.body.closingLine, 'Keep it local.');
    assert.equal(req.body.pictures.length, 1);
    res.status(202).json({ id: draftId, state: 'drafting', request: req.body });
  });
  app.get('/api/script-drafts/:id', (req, res) => {
    assert.equal(req.params.id, draftId);
    res.json({ id: draftId, state: 'ready', result: { lines: ['Keep it local.'] } });
  });
  app.post('/api/script-drafts/:id/reconcile', (req, res) => {
    assert.equal(req.params.id, draftId);
    rejoinCalls++;
    res.json({ id: draftId, state: 'ready' });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      '--import',
      pathToFileURL(reviewHook).href,
      '--import',
      'tsx',
      'server/mcp.ts',
      '--url',
      `http://127.0.0.1:${address.port}`,
      '--media-root',
      directory,
      '--state-dir',
      path.join(directory, 'plans'),
    ],
    cwd: process.cwd(),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'aftertake-regression', version: '1.0.0' });
  try {
    await client.connect(transport);
    const list = await client.listTools();
    assert.equal(list.tools.length, 50);
    for (const name of [
      'aftertake_character_workspace',
      'aftertake_track_character',
      'aftertake_replace_character',
      'aftertake_character_status',
      'aftertake_character_action',
      'aftertake_inspect_character',
      'aftertake_character_recipe',
      'aftertake_duplicate_subject',
      'aftertake_finish_media',
      'aftertake_preview_finish',
      'aftertake_depth_effect',
      'aftertake_depth_action',
      'aftertake_compose_layers',
      'aftertake_preview_layers',
      'aftertake_resolve_layers',
      'aftertake_save_film_edit',
      'aftertake_refine_blend',
      'aftertake_blend_status',
      'aftertake_cancel_blend',
      'aftertake_hosted_video_connection',
      'aftertake_estimate_hosted_video',
      'aftertake_generate_hosted_video',
      'aftertake_hosted_video_status',
      'aftertake_recover_hosted_video',
      'aftertake_cancel_hosted_video',
      'aftertake_export_hosted_video_request',
    ])
      assert.ok(
        list.tools.some((tool) => tool.name === name),
        `Missing ${name}`,
      );
    assert.ok(list.tools.every((tool) => tool.inputSchema.type === 'object'));
    assert.ok(
      list.tools.find((tool) => tool.name === 'aftertake_export_plan')?.annotations?.idempotentHint,
    );
    const annotations = (name: string) =>
      list.tools.find((tool) => tool.name === name)!.annotations!;
    assert.equal(annotations('aftertake_voice').idempotentHint, true);
    assert.equal(annotations('aftertake_save_film_edit').idempotentHint, true);
    assert.equal(annotations('aftertake_save_film_edit').readOnlyHint, false);
    assert.equal(annotations('aftertake_import_media').idempotentHint, false);
    assert.equal(annotations('aftertake_draft_script').idempotentHint, false);
    for (const name of ['aftertake_generate_hosted_video', 'aftertake_recover_hosted_video']) {
      assert.equal(annotations(name).readOnlyHint, false);
      assert.equal(annotations(name).idempotentHint, true);
      assert.equal(annotations(name).openWorldHint, true);
    }
    assert.equal(annotations('aftertake_cancel_hosted_video').destructiveHint, true);
    assert.equal(annotations('aftertake_cancel_hosted_video').openWorldHint, true);
    for (const name of ['aftertake_hosted_video_connection', 'aftertake_estimate_hosted_video']) {
      assert.equal(annotations(name).readOnlyHint, true);
      assert.equal(annotations(name).openWorldHint, true);
    }
    assert.equal(annotations('aftertake_hosted_video_status').openWorldHint, false);
    assert.equal(annotations('aftertake_refine_blend').idempotentHint, true);
    assert.equal(annotations('aftertake_refine_blend').openWorldHint, false);
    assert.equal(annotations('aftertake_cancel_blend').destructiveHint, true);
    for (const name of ['aftertake_character_action', 'aftertake_generation_action']) {
      assert.equal(annotations(name).readOnlyHint, false);
      assert.equal(annotations(name).destructiveHint, true);
      assert.equal(annotations(name).idempotentHint, false);
    }
    const guide = await client.callTool({ name: 'aftertake_editing_guide', arguments: {} });
    assert.ok(!guide.isError);
    const workspace = await client.callTool({ name: 'aftertake_workspace', arguments: {} });
    assert.ok(!workspace.isError);
    assert.deepEqual((workspace.structuredContent as any).filmAssets, []);
    const project = {
      format: 'aftertake-film/2',
      name: 'A native camera edit',
      aspect: 'landscape',
      shots: [
        {
          assetId: '00000000-0000-4000-8000-000000000001',
          sha256: 'a'.repeat(64),
          start: 0,
          end: 2,
          framing: {
            fit: 'cover',
            zoom: 1,
            endZoom: 2,
            x: 0.5,
            y: 0.5,
            keyframes: [
              { at: 0, zoom: 1, x: 0.5, y: 0.5 },
              { at: 1, zoom: 2, x: 0.8, y: 0.6, easing: 'ease-in-out' },
            ],
          },
        },
      ],
    };
    const saveEdit = (value: unknown) =>
      client.callTool({ name: 'aftertake_save_film_edit', arguments: { project: value } });
    const saved = await saveEdit(project);
    assert.ok(!saved.isError);
    const replay = await saveEdit(project);
    assert.equal((saved.structuredContent as any).duration, 2);
    assert.equal((saved.structuredContent as any).planId, (replay.structuredContent as any).planId);
    assert.equal(resolveCalls, 2);
    assert.equal(receivedFit, 'cover');
    const changed = await saveEdit({ ...project, name: 'A revised camera edit' });
    assert.notEqual(
      (saved.structuredContent as any).planId,
      (changed.structuredContent as any).planId,
    );
    const overrun = await saveEdit({
      ...project,
      titles: [
        {
          id: '00000000-0000-4000-8000-000000000003',
          text: 'Too late',
          start: 1,
          end: 3,
          style: 'headline',
          position: 'center',
          animation: 'none',
          color: '#ffffff',
        },
      ],
    });
    assert.equal(overrun.isError, true);
    assert.match((overrun.content as any)[0].text, /title ends after/);
    retainCamera = false;
    const incompatible = await saveEdit(project);
    assert.equal(incompatible.isError, true);
    assert.match((incompatible.content as any)[0].text, /did not retain every edit setting/);
    retainCamera = true;
    retainFit = false;
    const lostFit = await saveEdit(project);
    assert.equal(lostFit.isError, true);
    assert.match((lostFit.content as any)[0].text, /did not retain every edit setting/);
    retainFit = true;
    const motionProject = {
      ...project,
      format: 'aftertake-film/3',
      name: 'A bound animated graphic',
      resolution: '1080p',
      titles: [
        {
          id: '00000000-0000-4000-8000-000000000003',
          text: 'Move it.',
          start: 0,
          end: 2,
          style: 'headline',
          position: 'center',
          animation: 'none',
          color: '#ffffff',
          motion: motionPreset('slide-up'),
        },
      ],
      graphics: [
        {
          id: '00000000-0000-4000-8000-000000000004',
          name: 'Logo card',
          kind: 'image',
          start: 0,
          end: 2,
          x: 0.5,
          y: 0.5,
          width: 0.3,
          height: 0.2,
          color: '#ffffff',
          opacity: 1,
          fillOpacity: 0.8,
          assetId: '00000000-0000-4000-8000-000000000005',
          sha256: 'b'.repeat(64),
          motion: motionPreset('pop'),
        },
      ],
    };
    const savedMotion = await saveEdit(motionProject);
    assert.ok(!savedMotion.isError);
    const motionPlanId = (savedMotion.structuredContent as any).planId;
    const exportMotion = () =>
      client.callTool({ name: 'aftertake_export_plan', arguments: { planId: motionPlanId } });
    for (const feature of ['graphics', 'resolution', 'titleMotion']) {
      retainGraphics = feature !== 'graphics';
      retainResolution = feature !== 'resolution';
      retainTitleMotion = feature !== 'titleMotion';
      const stripped = await exportMotion();
      assert.equal(stripped.isError, true, `Export admitted stripped ${feature}`);
      assert.match((stripped.content as any)[0].text, /did not retain every edit setting/);
      assert.equal(exportCalls, 0, 'A changed edit reached the export POST.');
    }
    retainGraphics = retainResolution = retainTitleMotion = true;
    const exported = await exportMotion();
    assert.ok(!exported.isError);
    assert.equal(exportCalls, 1);
    assert.deepEqual(exportedDraft, filmRequestSchema.parse(motionProject));

    reviewFilm = {
      ...exportedDraft,
      id: filmId,
      state: 'ready',
      duration: 2,
      createdAt: new Date().toISOString(),
      sourceVolume: 0,
      normalizeAudio: true,
    };
    const review = async (embedded: unknown) => {
      await writeFile(reviewResultFile, JSON.stringify({ manifest: embedded, frames: [] }));
      return client.callTool({ name: 'aftertake_review_film', arguments: { filmId } });
    };
    const matched = await review(reviewFilm);
    assert.ok(!matched.isError);
    assert.equal((matched.structuredContent as any).embeddedProjectMatches, true);
    const missingGraphics = structuredClone(reviewFilm);
    delete missingGraphics.graphics;
    const lostGraphics = await review(missingGraphics);
    assert.equal(lostGraphics.isError, true);
    assert.match((lostGraphics.content as any)[0].text, /differs.*graphics/);
    const alteredGraphic = structuredClone(reviewFilm);
    alteredGraphic.graphics[0].motion.keys[0].scaleX = 0.2;
    const changedGraphic = await review(alteredGraphic);
    assert.equal(changedGraphic.isError, true);
    assert.match((changedGraphic.content as any)[0].text, /differs.*graphics/);
    reviewFilm.motionScene = {
      groups: [],
      order: [
        { kind: 'graphic', id: motionProject.graphics[0].id },
        { kind: 'title', id: motionProject.titles[0].id },
      ],
    };
    const sceneMatch = await review(reviewFilm);
    assert.ok(!sceneMatch.isError);
    const missingScene = structuredClone(reviewFilm);
    delete missingScene.motionScene;
    const lostScene = await review(missingScene);
    assert.equal(lostScene.isError, true);
    assert.match((lostScene.content as any)[0].text, /differs.*motionScene/);
    const changedOrder = structuredClone(reviewFilm);
    changedOrder.motionScene.order.reverse();
    const alteredScene = await review(changedOrder);
    assert.equal(alteredScene.isError, true);
    assert.match((alteredScene.content as any)[0].text, /differs.*motionScene/);
    const wrongResolution = { ...reviewFilm, resolution: '720p' };
    const lostResolution = await review(wrongResolution);
    assert.equal(lostResolution.isError, true);
    assert.match((lostResolution.content as any)[0].text, /differs.*resolution/);
    delete reviewFilm.graphics;
    delete reviewFilm.resolution;
    delete reviewFilm.motionScene;
    const legacyMatch = await review(reviewFilm);
    assert.ok(!legacyMatch.isError, 'Absent optional fields must not crash legacy review.');
    assert.equal((legacyMatch.structuredContent as any).embeddedProjectMatches, true);
    const script = await client.callTool({
      name: 'aftertake_draft_script',
      arguments: {
        brief: 'A fictional product in a simple studio.',
        closingLine: 'Keep it local.',
        pictures: [{ key: 'product:0', name: 'Product still', seconds: 3 }],
      },
    });
    assert.ok(!script.isError);
    assert.equal((script.structuredContent as any).id, draftId);
    assert.equal(scriptCalls, 1);
    const status = await client.callTool({
      name: 'aftertake_script_status',
      arguments: { draftId },
    });
    assert.deepEqual((status.structuredContent as any).result.lines, ['Keep it local.']);
    const rejoined = await client.callTool({
      name: 'aftertake_rejoin_script',
      arguments: { draftId },
    });
    assert.equal((rejoined.structuredContent as any).id, draftId);
    assert.equal(rejoinCalls, 1);
    const traversal = await client.callTool({
      name: 'aftertake_import_media',
      arguments: { path: process.execPath },
    });
    assert.equal(traversal.isError, true);
    assert.match((traversal.content as any)[0].text, /inside the configured media root/);
  } finally {
    await client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await remove(directory);
  }
});
