import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { buildDemoSnapshot } from '../scripts/browser-demo-data.mjs';
import { createDemoRuntime } from '../src/demo-runtime.js';

const root = fileURLToPath(new URL('../', import.meta.url));
// Test the checked-out fixture, including in shallow CI/source checkouts.
// Published builds separately pin the media revision used in their URLs.
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const snapshot = buildDemoSnapshot(root, revision);

test('browser examples retain real recorded media and workflows from the checked-out revision', async () => {
  const demo = createDemoRuntime(snapshot);
  assert.equal(snapshot.mediaRevision, revision);
  assert.equal(snapshot.renders.length, 13);
  const catalog = await demo.request('/api/templates').then((r) => r.json());
  assert.equal(catalog.length, 13);
  const opened = await demo
    .request('/api/templates/portal/open', { method: 'POST' })
    .then((r) => r.json());
  assert.equal(
    opened.render.recipe.clip.sha256,
    'f734904d279124904dcacb17a9879f3467302fd35a1df41ca9fa9303ce74bad2',
  );
  assert.equal(
    demo.mediaUrl(opened.render.output),
    `https://raw.githubusercontent.com/ItsSNOWMOBILE/aftertake/${revision}/examples/portal/result.mp4`,
  );
  assert.match(
    demo.mediaUrl('/api/thumbnails/' + opened.clip.id + '?time=999'),
    /\/examples\/previews\/[a-f0-9]+\.jpg$/,
  );
  assert.ok(
    demo
      .mediaUrl('/api/templates/crystal-forest/reference')
      .endsWith('/crystal-forest/edited-first-frame.png'),
  );
  assert.notEqual(opened.render.workflow['8'].inputs.filename, 'INPUT.mp4');
  opened.render.recipe.prompt = 'A client edit must not rewrite the recorded take.';
  const again = await demo
    .request('/api/templates/portal/open', { method: 'POST' })
    .then((r) => r.json());
  assert.notEqual(again.render.recipe.prompt, opened.render.recipe.prompt);
  assert.equal(demo.mediaUrl('/api/private-file'), '');
});

test('browser recipe edits export runnable portable graphs while generation never produces a simulated job', async () => {
  const demo = createDemoRuntime(snapshot);
  const original = snapshot.renders.find(
    (render) => render.id === snapshot.workspace.featuredRenderId,
  )!;
  const recipe = structuredClone(original.recipe);
  recipe.cue.start = 0.8;
  const response = await demo.request('/api/workflow', {
    method: 'POST',
    body: JSON.stringify(recipe),
  });
  assert.equal(response.status, 200);
  const graph = await response.json();
  assert.equal(graph['8'].inputs.filename, 'INPUT.mp4');
  assert.equal(JSON.parse(graph['9'].inputs.cue_json).start, 0.8);
  const count = (await demo.request('/api/renders').then((r) => r.json())).length;
  for (const endpoint of [
    '/api/renders',
    '/api/frame-edits',
    '/api/images',
    '/api/videos',
    '/api/clips',
    '/api/films',
    '/api/cue-preview',
  ]) {
    const blocked = await demo.request(endpoint, { method: 'POST', body: JSON.stringify(recipe) });
    assert.equal(blocked.status, 409);
    assert.match((await blocked.json()).error, /local/i);
  }
  assert.equal((await demo.request('/api/renders').then((r) => r.json())).length, count);
  assert.equal(
    (await demo.request('/api/engine?pipeline=inpaint').then((r) => r.json())).ready,
    false,
  );
  const recordedImages = await demo.request('/api/images').then((r) => r.json());
  const recordedVideos = await demo.request('/api/videos').then((r) => r.json());
  assert.ok(recordedImages.every((image: { state: string }) => image.state === 'succeeded'));
  assert.equal(recordedVideos.length, 2);
  assert.ok(recordedVideos.every((video: { state: string }) => video.state === 'succeeded'));
  assert.equal((await demo.request('/api/workflow', { method: 'POST', body: '{}' })).status, 422);
});

test('a self-contained static host can serve verified media without changing recorded settings or execution graphs', () => {
  const local = buildDemoSnapshot(fileURLToPath(new URL('../', import.meta.url)), revision, {
    mediaBase: '../examples/',
  });
  const demo = createDemoRuntime(local);
  assert.deepEqual(local.renders, snapshot.renders);
  assert.equal(demo.mediaUrl('/api/templates/portal/result'), '../examples/portal/result.mp4');
  assert.equal(
    demo.mediaUrl('/api/templates/crystal-forest/reference'),
    '../examples/crystal-forest/edited-first-frame.png',
  );
  assert.ok(
    Object.values(local.thumbnails).every((choices) =>
      Object.values(choices).every(
        (url) => url.startsWith('../examples/') && !url.slice(12).includes('..'),
      ),
    ),
  );
  for (const mediaBase of [
    'javascript:alert(1)',
    'file:///private/',
    'https://user:password@example.com/',
    'https://example.com/?token=secret',
  ])
    assert.throws(
      () =>
        buildDemoSnapshot(fileURLToPath(new URL('../', import.meta.url)), revision, { mediaBase }),
      /plain HTTP/,
    );
});

test('recorded text-video history exposes real output settings while new generation stays disabled', async () => {
  const video = JSON.parse(
    await readFile(
      new URL('../examples/text-video/portrait/generation.json', import.meta.url),
      'utf8',
    ),
  );
  const demo = createDemoRuntime({
    ...snapshot,
    videos: [video],
    clips: [...snapshot.clips, video.clip],
    media: { ...snapshot.media, [video.clip.url]: '../examples/text-video/portrait/result.mp4' },
  });
  const list = await demo.request('/api/videos').then((r) => r.json());
  assert.equal(list.length, 1);
  assert.equal(list[0].state, 'succeeded');
  assert.equal(list[0].clip.sha256, video.clip.sha256);
  assert.equal(list[0].request.aspect, 'portrait');
  assert.equal(list[0].request.sound, true);
  assert.equal(demo.mediaUrl(list[0].clip.url), '../examples/text-video/portrait/result.mp4');
  list[0].request.seed = 99;
  assert.equal(
    (await demo.request('/api/videos').then((r) => r.json()))[0].request.seed,
    video.request.seed,
  );
  const blocked = await demo.request('/api/videos', {
    method: 'POST',
    body: JSON.stringify({ ...video.request, seed: 99 }),
  });
  assert.equal(blocked.status, 409);
  assert.equal((await demo.request('/api/videos').then((r) => r.json())).length, 1);
});
