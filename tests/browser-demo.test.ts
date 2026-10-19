import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { buildDemoSnapshot } from '../scripts/browser-demo-data.mjs';
import { createDemoRuntime } from '../src/demo-runtime.js';
import type { CharacterRequest, CharacterSelectionRequest } from '../src/character.js';

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

test('the character studio replays the actual H3 selection, reference and replacement with their native receipts', async () => {
  const demo = createDemoRuntime(snapshot);
  const list = await demo.request('/api/characters').then((r) => r.json());
  assert.deepEqual(
    list.map((job: { kind: string }) => job.kind),
    ['selection', 'replacement'],
  );
  const [selection, replacement] = snapshot.characters!;
  assert.equal(selection.id, '0bd5c390-e419-4610-8cf7-cd2e2ea6475b');
  assert.equal(selection.jobId, '23174133-7ba4-448d-a870-b1bad7bcd7b4');
  assert.equal(replacement.id, '2c72d172-c42f-486f-895c-5d2653988264');
  assert.equal(replacement.jobId, '17193ac8-5660-4dbc-bb2e-0537bffe754a');
  assert.ok(list.every((job: { state: string }) => job.state === 'succeeded'));
  const selected = selection.request as CharacterSelectionRequest,
    request = replacement.request as CharacterRequest,
    recorded = JSON.parse(
      await readFile(new URL('../examples/character-h3-high/recipe.json', import.meta.url), 'utf8'),
    );
  assert.deepEqual(selected, recorded.selection);
  assert.deepEqual(request, recorded.replacement);
  assert.deepEqual(replacement.workflow, recorded.workflow);
  assert.deepEqual(selection.selection, recorded.selectionInfo);
  assert.deepEqual(replacement.clip, recorded.output);
  assert.equal(replacement.clip!.hasAudio, false, 'This published source is silent.');
  assert.equal(request.seed, 509103);
  assert.equal(selected.resolution, '768');
  for (const clip of [selected.clip, request.reference, replacement.clip!])
    assert.deepEqual(
      snapshot.clips.find((item) => item.id === clip.id),
      clip,
    );
  const media = `https://raw.githubusercontent.com/ItsSNOWMOBILE/aftertake/${revision}/examples/`;
  assert.equal(demo.mediaUrl(selected.clip.url), media + 'character-h3-high/source.mp4');
  assert.equal(demo.mediaUrl(request.reference.url), media + 'character-h3/reference.png');
  assert.equal(demo.mediaUrl(replacement.clip!.url), media + 'character-h3-high/result.mp4');
  assert.equal(
    demo.mediaUrl(`/api/characters/${selection.id}/source`),
    media + 'character-h3-high/prepared-source.mp4',
  );
  assert.equal(
    demo.mediaUrl(`/api/characters/${selection.id}/preview`),
    media + 'character-h3-high/selection-preview.mp4',
  );
  assert.equal(
    demo.mediaUrl(`/api/characters/${selection.id}/mask`),
    media + 'character-h3-high/tracked-mask.mkv',
  );
  assert.equal(
    demo.mediaUrl(`/api/characters/${replacement.id}/recipe`),
    media + 'character-h3-high/recipe.json',
  );
  assert.equal(
    demo.mediaUrl(`/api/thumbnails/${selected.clip.id}?time=0`),
    media + 'character-h3-high/source-frame.jpg',
  );
  assert.equal(
    demo.mediaUrl(`/api/thumbnails/${selected.clip.id}?time=1.5`),
    media + 'character-h3-high/source-frame-036.jpg',
  );
  assert.equal(
    demo.mediaUrl(`/api/thumbnails/${selected.clip.id}?time=1.6`),
    media + 'character-h3-high/source-frame-036.jpg',
  );
  assert.equal(
    demo.mediaUrl(`/api/thumbnails/${selected.clip.id}?time=999`),
    media + 'character-h3-high/source-frame-072.jpg',
  );
  assert.equal(
    demo.mediaUrl(`/api/thumbnails/${request.reference.id}?time=0`),
    media + 'character-h3/reference.png',
  );
  assert.equal(
    demo.mediaUrl(`/api/thumbnails/${replacement.clip!.id}?time=0`),
    media + 'character-h3-high/poster.jpg',
  );
});

test('recorded character requests are isolated copies and cannot create, recover or cancel native jobs', async () => {
  const original = structuredClone(snapshot),
    demo = createDemoRuntime(original),
    [selection, replacement] = snapshot.characters!;
  original.characters![1].state = 'running';
  const read = await demo.request(`/api/characters/${replacement.id}`);
  assert.equal(read.status, 200);
  const job = await read.json();
  assert.deepEqual(job, replacement);
  if (job.request.format !== 'aftertake-character/1')
    throw Error('Expected the recorded replacement request.');
  job.request.seed = 9;
  job.workflow = {};
  const again = await demo.request(`/api/characters/${replacement.id}`).then((r) => r.json());
  assert.deepEqual(again, replacement);
  for (const route of [
    '/api/characters/selections',
    '/api/characters/replacements',
    `/api/characters/${selection.id}/reconcile`,
    `/api/characters/${replacement.id}/reconcile`,
    `/api/characters/${replacement.id}/cancel`,
  ]) {
    const response = await demo.request(route, {
      method: 'POST',
      body: JSON.stringify(replacement.request),
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /local/i);
  }
  assert.deepEqual(
    await demo.request('/api/characters').then((r) => r.json()),
    snapshot.characters,
  );
  assert.equal(
    (await demo.request('/api/characters/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).status,
    404,
  );
  assert.equal(demo.mediaUrl('/api/characters/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/source'), '');
  const old = createDemoRuntime({ ...snapshot, characters: undefined });
  assert.deepEqual(await old.request('/api/characters').then((r) => r.json()), []);
  assert.equal((await old.request(`/api/characters/${replacement.id}`)).status, 404);
});
