import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { templateRouter } from '../server/templates.js';
import { applyTemplate, filterTemplates, type Template } from '../src/templates.js';
import type { Render } from '../src/domain.js';

test('templates keep the user source and cue while camera presets retain scene direction', async () => {
  const base = JSON.parse(await readFile(new URL('../examples/portal/recipe.json', import.meta.url), 'utf8'));
  const effect = { slug: 'portal', title: 'Portal', recipe: base } as Template;
  const current = { ...base, name: 'My clip', seed: 7, quality: 'draft' as const, prompt: 'A different effect', trimStart: .25, cue: { ...base.cue, end: 2.75 } };
  const applied = applyTemplate(current, effect);
  assert.equal(applied.clip, current.clip); assert.deepEqual(applied.cue, { ...current.cue, anchor: 0 });
  assert.equal(applied.trimStart, .25); assert.equal(applied.seed, 7); assert.equal(applied.quality, 'draft');
  assert.equal(applied.prompt, base.prompt); assert.equal(applied.name, 'My clip');
  const camera = { recipe: JSON.parse(await readFile(new URL('../examples/guided-pullback/recipe.json', import.meta.url), 'utf8')) } as Template;
  const scene = { ...current, pipeline: 'cinema' as const, prompt: 'A waterfall in a pine forest.' };
  assert.equal(applyTemplate(scene, camera).prompt, scene.prompt);
  assert.deepEqual(applyTemplate(scene, camera).cinema, camera.recipe.cinema);
  const freshCamera = applyTemplate(current, camera);
  assert.doesNotMatch(freshCamera.prompt, /living room|ceiling fan/i);
  assert.throws(() => applyTemplate({ ...scene, clip: { ...scene.clip, kind: 'image' as const } }, effect), /video source/);
});

test('recipe search combines tags and words without losing category filtering', () => {
  const templates = [{ title: 'Beyond the frame', description: 'Pull back', tags: ['Motion tracks', 'Black and white'], category: 'camera' },
    { title: 'Golden falls', description: 'Flowing gold', tags: ['Matter', 'Inpainting'], category: 'effects' }] as Template[];
  assert.equal(filterTemplates(templates, 'all', 'MOTION white').length, 1);
  assert.equal(filterTemplates(templates, 'effects', 'motion').length, 0);
  assert.equal(filterTemplates(templates, 'effects', 'gold').length, 1);
  assert.equal(filterTemplates(templates, 'all', '   ').length, 2);
});

test('reviewed examples work from a hidden checkout and import real bytes without Python, GPU jobs or source overwrite', async () => {
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url)), directory = await mkdtemp(path.join(tmpdir(), 'aftertake-template-test-'));
  const root = path.join(directory, '.checkout');
  await mkdir(root); await cp(path.join(sourceRoot, 'examples'), path.join(root, 'examples'), { recursive: true });
  await Promise.all(['clips', 'outputs', 'renders', 'previews'].map(name => mkdir(path.join(directory, name))));
  const renders = new Map<string, Render>();
  const app = express(); app.use(express.json()); app.use('/templates', await templateRouter(root, directory, renders));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(400).json({ error: error.message }); });
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.on('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/templates`;
  try {
    const catalog = await fetch(url).then(r => r.json()) as Template[];
    assert.equal(catalog.length, 7);
    assert.equal((await fetch(url + '/portal/poster')).headers.get('content-type'), 'image/jpeg');
    assert.equal((await fetch(url + '/portal/private')).status, 404);
    assert.equal((await fetch(url + '/missing/open', { method: 'POST' })).status, 404);
    const open = () => fetch(url + '/portal/open', { method: 'POST' }).then(r => r.json()) as Promise<{ render: Render }>;
    const first = await open(), second = await open();
    assert.equal(first.render.id, second.render.id); assert.equal(renders.size, 1);
    assert.equal(first.render.origin?.renderId, '2a7c74eb-8313-499e-8276-6d598b0ac6d1');
    const bytes = await readFile(path.join(directory, 'outputs', first.render.id + '.mp4'));
    assert.deepEqual(bytes, await readFile(path.join(root, 'examples/portal/result.mp4')));
    assert.equal(createHash('sha256').update(await readFile(path.join(directory, 'clips', path.basename(first.render.recipe.clip.url)))).digest('hex'), first.render.recipe.clip.sha256);
    assert.ok(await readFile(path.join(directory, 'renders', first.render.id + '.json')));
    assert.notEqual(first.render.id, first.render.origin?.renderId);
    const quiet = await fetch(url + '/quiet-approach/open', { method: 'POST' }).then(r => r.json()) as { render: Render };
    const guided = await fetch(url + '/guided-pullback/open', { method: 'POST' }).then(r => r.json()) as { render: Render };
    assert.equal(quiet.render.recipe.clip.id, guided.render.recipe.clip.id);
    assert.equal(guided.render.recipe.clip.kind, 'image');
    assert.ok(guided.render.guideOutput);
    assert.notEqual(first.render.recipe.clip.id, quiet.render.recipe.clip.id);
    assert.deepEqual(await readFile(path.join(directory, 'outputs', first.render.id + '.mp4')), bytes);
    const edited = await fetch(url + '/reference-portal/open', { method: 'POST' }).then(r => r.json()) as { render: Render };
    assert.equal(edited.render.recipe.clip.id, first.render.recipe.clip.id);
    const image = edited.render.recipe.editReference!;
    assert.equal(image.kind, 'image');
    assert.equal(createHash('sha256').update(await readFile(path.join(directory, 'clips', path.basename(image.url)))).digest('hex'), image.sha256);
    assert.notEqual(image.id, '732369a3-0434-4d46-a327-e74fe29d143f');
    assert.equal((await fetch(url + '/reference-portal/reference')).headers.get('content-type'), 'image/png');
    const appearance = await fetch(url + '/crystal-forest/frame-recipe').then(r => r.json());
    assert.equal(appearance.request.mode, 'fast');
    assert.equal(appearance.output.sha256, catalog.find(item => item.slug === 'crystal-forest')?.recipe.editReference?.sha256);
    assert.equal(appearance.workflow['17'].inputs.steps, 4);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('aftertake-template-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});
