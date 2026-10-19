import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { filmRouter } from '../server/films.js';
import { contentDigest } from '../server/edit-plan.js';
import { filmRequestSchema } from '../src/film.js';
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
    assert.equal(list.tools.length, 39);
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
    assert.equal(annotations('aftertake_import_media').idempotentHint, false);
    assert.equal(annotations('aftertake_draft_script').idempotentHint, false);
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
