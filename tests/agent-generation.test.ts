import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { generationAdmission } from '../server/generation-admission.js';

test('real MCP generation transport preserves operation IDs across reconnect, checks capabilities and transfers verified source bytes into Film', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aftertake-generation-tools-')),
    app = express();
  app.use(express.json());
  const data = Buffer.from('canonical studio image bytes'),
    original = Buffer.from('selected original image bytes'),
    hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
  const clip = {
    id: randomUUID(),
    name: 'Product reference',
    kind: 'image',
    url: '',
    sha256: hash(data),
    originalSha256: hash(original),
    width: 1024,
    height: 1024,
    duration: 1,
  };
  clip.url = '/media/' + clip.id + '.png';
  const records: Record<string, any[]> = { image: [], frame: [], take: [] },
    routes = { image: '/api/images', frame: '/api/frame-edits', take: '/api/renders' },
    assets: any[] = [];
  let protocol = 0,
    compositeRegionProtocol: unknown,
    admissions = 0,
    actions = 0,
    uploads = 0;
  app.get('/api/workspace', (_req, res) =>
    res.json({ generationProtocol: protocol, compositeRegionProtocol }),
  );
  app.get('/api/clips', (_req, res) => res.json([clip]));
  app.get(clip.url, (_req, res) => res.type('png').send(data));
  app.get('/api/films', (_req, res) => res.json([]));
  app.get('/api/films/assets', (_req, res) => res.json(assets));
  app.get('/api/engine', (_req, res) =>
    res.json({ connected: true, ready: true, missing: [], message: 'test profile' }),
  );
  app.post('/api/films/assets', express.raw({ type: 'application/octet-stream' }), (req, res) => {
    uploads++;
    assert.deepEqual(req.body, data);
    const asset = {
      id: randomUUID(),
      sha256: hash(req.body),
      kind: 'image',
      duration: 30,
      extension: '.png',
      name: req.query.name,
    };
    assets.push(asset);
    res.status(201).json(asset);
  });
  app.get('/api/films/assets/:id/media', (req, res) => {
    assert.ok(assets.some((asset) => asset.id === req.params.id));
    res.type('png').send(data);
  });
  for (const [type, route] of Object.entries(routes)) {
    app.get(route, (_req, res) => res.json(records[type]));
    app.post(route, (req, res) => {
      const admission = generationAdmission(req.get('Idempotency-Key'), req.body, records[type]);
      if (admission.conflict)
        return void res.status(409).json({ error: 'Inputs differ for this operation.' });
      if (admission.existing) return void res.json(admission.existing);
      const record = {
        id: randomUUID(),
        ...admission.identity,
        state: 'queued',
        progress: null,
        workflow: { one: { class_type: 'ProtocolTestOnly', inputs: {} } },
        ...(type === 'take' ? { recipe: req.body } : { request: req.body }),
      };
      admissions++;
      records[type].push(record);
      res.status(201).json(record);
    });
    app.get(route + '/:id', (req, res) =>
      res.json(records[type].find((record) => record.id === req.params.id)),
    );
    app.post(route + '/:id/:action', (req, res) => {
      actions++;
      const record = records[type].find((record) => record.id === req.params.id);
      assert.ok(record);
      record.state = req.params.action === 'cancel' ? 'canceled' : 'running';
      res.json(record);
    });
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const start = async () => {
    const client = new Client({ name: 'generation-contract-test', version: '1.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          '--import',
          'tsx',
          'server/mcp.ts',
          '--url',
          base,
          '--media-root',
          directory,
          '--state-dir',
          path.join(directory, 'plans'),
        ],
        cwd: process.cwd(),
        stderr: 'pipe',
      }),
    );
    return client;
  };
  let client = await start();
  const call = (name: string, input: any) => client.callTool({ name, arguments: input });
  const image = {
    requestId: 'product-reference-v1',
    request: {
      format: 'aftertake-image/1',
      name: 'Product reference',
      prompt: 'A clean studio product photograph.',
      seed: 123,
      aspect: 'square',
      style: 'product',
    },
  };
  try {
    const refused = await call('aftertake_generate_image', image);
    assert.ok(refused.isError);
    assert.match((refused.content as any)[0].text, /Restart the local studio/);
    assert.equal(admissions, 0);
    protocol = 1;
    const workspace = await call('aftertake_generation_workspace', { profile: 'image-gen' });
    assert.ok(!workspace.isError);
    assert.equal((workspace.structuredContent as any).sources[0].id, clip.id);
    const first = await call('aftertake_generate_image', image),
      again = await call('aftertake_generate_image', image);
    assert.ok(!first.isError && !again.isError);
    assert.equal((first.structuredContent as any).id, (again.structuredContent as any).id);
    assert.equal(admissions, 1);
    const changed = await call('aftertake_generate_image', {
      ...image,
      request: { ...image.request, seed: 124 },
    });
    assert.ok(changed.isError);
    assert.equal(admissions, 1);
    await client.close();
    client = await start();
    const status = await call('aftertake_generation_status', {
      kind: 'image',
      requestId: image.requestId,
      includeWorkflow: true,
    });
    assert.ok(!status.isError);
    assert.equal((status.structuredContent as any).id, (first.structuredContent as any).id);
    assert.match((status.structuredContent as any).workflowRole, /planned/);
    assert.equal(admissions, 1);
    records.image[0].state = 'succeeded';
    records.image[0].clip = clip;
    const completed = await call('aftertake_generation_status', {
      kind: 'image',
      requestId: image.requestId,
      includeWorkflow: true,
    });
    assert.equal((completed.structuredContent as any).clip.id, clip.id);
    assert.equal((completed.structuredContent as any).workflowRole, 'verified completed output');
    await writeFile(path.join(directory, 'selected.png'), original);
    const imported = await call('aftertake_import_media', {
      path: 'selected.png',
      destination: 'studio',
    });
    assert.ok(!imported.isError);
    assert.equal((imported.structuredContent as any).reused, true);
    assert.equal(uploads, 0);
    const wrong = await call('aftertake_use_source', { clipId: clip.id, sha256: 'a'.repeat(64) });
    assert.ok(wrong.isError);
    assert.equal(uploads, 0);
    const used = await call('aftertake_use_source', { clipId: clip.id, sha256: clip.sha256 }),
      reused = await call('aftertake_use_source', { clipId: clip.id, sha256: clip.sha256 });
    assert.ok(!used.isError && !reused.isError);
    assert.equal(uploads, 1);
    assert.equal(
      (used.structuredContent as any).asset.id,
      (reused.structuredContent as any).asset.id,
    );
    const frame = await call('aftertake_edit_frame', {
      requestId: 'appearance-v1',
      request: {
        format: 'aftertake-frame-edit/1',
        clip,
        trimStart: 0,
        prompt: 'Change only the accent color to muted copper.',
        seed: 456,
        mode: 'fast',
      },
    });
    assert.ok(!frame.isError);
    const recipe = JSON.parse(
      await readFile(new URL('../examples/observatory/recipe.json', import.meta.url), 'utf8'),
    );
    recipe.clip = clip;
    const take = await call('aftertake_render_take', { requestId: 'product-shot-v1', recipe });
    assert.ok(!take.isError);
    assert.equal(admissions, 3);
    records.take[0].state = 'submission_unknown';
    const reconcile = await call('aftertake_generation_action', {
      kind: 'take',
      requestId: 'product-shot-v1',
      action: 'reconcile',
    });
    assert.ok(!reconcile.isError);
    assert.equal((reconcile.structuredContent as any).id, records.take[0].id);
    assert.equal(actions, 1);
    assert.equal(admissions, 3);
    const cancel = await call('aftertake_generation_action', {
      kind: 'take',
      requestId: 'product-shot-v1',
      action: 'cancel',
    });
    assert.ok(!cancel.isError);
    assert.equal(actions, 2);
    await call('aftertake_generation_action', {
      kind: 'take',
      requestId: 'product-shot-v1',
      action: 'cancel',
    });
    assert.equal(actions, 2);
    const missing = await call('aftertake_generation_status', {
      kind: 'take',
      requestId: 'unrecorded',
    });
    assert.equal((missing.structuredContent as any).state, 'not_found');
    assert.equal(admissions, 3);
    const regional = {
      ...JSON.parse(
        await readFile(new URL('../examples/portal/recipe.json', import.meta.url), 'utf8'),
      ),
      compositeRegion: {
        feather: 0.02,
        strokes: [{ radius: 0.1, points: [{ x: 0.5, y: 0.5 }] }],
      },
    };
    for (const capability of [undefined, 0, true, '1']) {
      compositeRegionProtocol = capability;
      const blocked = await call('aftertake_render_take', {
        requestId: 'separate-final-region-v1',
        recipe: regional,
      });
      assert(blocked.isError);
      assert.match((blocked.content as any)[0].text, /separate final blend area support/);
      assert.equal(admissions, 3, 'An unsupported studio must receive no new generation request.');
      assert.equal(records.take.length, 1);
    }
    compositeRegionProtocol = 1;
    const regionalTake = await call('aftertake_render_take', {
      requestId: 'separate-final-region-v1',
      recipe: regional,
    });
    assert(!regionalTake.isError);
    assert.equal(admissions, 4);
    assert.deepEqual(records.take.at(-1).recipe.compositeRegion, regional.compositeRegion);
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('aftertake-generation-tools-'));
    await rm(directory, { recursive: true, force: true });
  }
});
