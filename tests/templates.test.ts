import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { templateRouter } from '../server/templates.js';
import { applyTemplate, filterTemplates, type Template } from '../src/templates.js';
import {
  projectSchema,
  recipeSchema,
  renderDimensions,
  type Recipe,
  type Render,
} from '../src/domain.js';

test('templates keep the user source and cue while camera presets retain scene direction', async () => {
  const base = JSON.parse(
    await readFile(new URL('../examples/portal/recipe.json', import.meta.url), 'utf8'),
  );
  const effect = { slug: 'portal', title: 'Portal', recipe: base } as Template;
  const current = {
    ...base,
    name: 'My clip',
    seed: 7,
    quality: 'draft' as const,
    prompt: 'A different effect',
    trimStart: 0.25,
    cue: { ...base.cue, end: 2.75 },
  };
  const applied = applyTemplate(current, effect);
  assert.equal(applied.clip, current.clip);
  assert.deepEqual(applied.cue, { ...current.cue, anchor: 0 });
  assert.equal(applied.trimStart, 0.25);
  assert.equal(applied.seed, 7);
  assert.equal(applied.quality, 'draft');
  assert.equal(applied.prompt, base.prompt);
  assert.equal(applied.name, 'My clip');
  const camera = {
    recipe: JSON.parse(
      await readFile(new URL('../examples/guided-pullback/recipe.json', import.meta.url), 'utf8'),
    ),
  } as Template;
  const scene = {
    ...current,
    pipeline: 'cinema' as const,
    prompt: 'A waterfall in a pine forest.',
  };
  assert.equal(applyTemplate(scene, camera).prompt, scene.prompt);
  assert.deepEqual(applyTemplate(scene, camera).cinema, camera.recipe.cinema);
  const freshCamera = applyTemplate(current, camera);
  assert.doesNotMatch(freshCamera.prompt, /living room|ceiling fan/i);
  assert.throws(
    () => applyTemplate({ ...scene, clip: { ...scene.clip, kind: 'image' as const } }, effect),
    /video source/,
  );
});

test('regional templates preserve final paint and clamp its own tracking anchor without changing old projects', async () => {
  const base = JSON.parse(
    await readFile(new URL('../examples/portal/recipe.json', import.meta.url), 'utf8'),
  ) as Recipe;
  const effect = { recipe: base } as Template;
  const region = {
    feather: 0.015,
    tracking: 'flow' as const,
    anchor: 4,
    strokes: [{ radius: 0.09, points: [{ x: 0.3, y: 0.4 }] }],
  };
  const current: Recipe = {
    ...base,
    quality: 'draft',
    trimStart: 0,
    clip: { ...base.clip, duration: 1.2 },
    cue: { ...base.cue, anchor: 4 },
    compositeRegion: region,
  };
  const applied = applyTemplate(current, effect);
  const d = renderDimensions(applied);
  assert.equal(applied.compositeRegion?.strokes, region.strokes);
  assert.equal(applied.compositeRegion?.feather, region.feather);
  assert.equal(applied.compositeRegion?.tracking, 'flow');
  assert.equal(applied.compositeRegion?.anchor, d.duration - 1 / d.fps);
  assert.equal(region.anchor, 4, 'Applying a template must not mutate saved paint.');
  assert(recipeSchema.safeParse(applied).success);
  const untracked = applyTemplate(
    { ...current, compositeRegion: { ...region, anchor: undefined } },
    effect,
  );
  assert.equal(untracked.compositeRegion?.anchor, undefined);
  assert.equal(Object.hasOwn(applyTemplate(base, effect), 'compositeRegion'), false);
});

test('camera and motion templates discard a final region before validating the new project', async () => {
  const base = JSON.parse(
    await readFile(new URL('../examples/portal/recipe.json', import.meta.url), 'utf8'),
  ) as Recipe;
  const current = {
    ...base,
    compositeRegion: { feather: 0.01, strokes: base.cue.strokes },
  };
  for (const name of ['guided-pullback', 'signal']) {
    const template = {
      recipe: JSON.parse(
        await readFile(new URL(`../examples/${name}/recipe.json`, import.meta.url), 'utf8'),
      ),
    } as Template;
    const applied = applyTemplate(current, template);
    assert.equal(Object.hasOwn(applied, 'compositeRegion'), false);
    assert(projectSchema.safeParse(applied).success);
    assert(current.compositeRegion, 'The source project retains its final region.');
  }
});

test('recipe search combines tags and words without losing category filtering', () => {
  const templates = [
    {
      title: 'Beyond the frame',
      description: 'Pull back',
      tags: ['Motion tracks', 'Black and white'],
      category: 'camera',
    },
    {
      title: 'Golden falls',
      description: 'Flowing gold',
      tags: ['Matter', 'Inpainting'],
      category: 'effects',
    },
  ] as Template[];
  assert.equal(filterTemplates(templates, 'all', 'MOTION white').length, 1);
  assert.equal(filterTemplates(templates, 'effects', 'motion').length, 0);
  assert.equal(filterTemplates(templates, 'effects', 'gold').length, 1);
  assert.equal(filterTemplates(templates, 'all', '   ').length, 2);
});

test('motion and transition templates retain user media without copying example references or scene descriptions', async () => {
  const current = JSON.parse(
    await readFile(new URL('../examples/portal/recipe.json', import.meta.url), 'utf8'),
  );
  const motion = {
    recipe: JSON.parse(
      await readFile(new URL('../examples/signal/recipe.json', import.meta.url), 'utf8'),
    ),
  } as Template;
  const next = applyTemplate(current, motion);
  assert.equal(next.clip, current.clip);
  assert.equal(next.seed, current.seed);
  assert.equal(next.pipeline, 'motion-transfer');
  assert.equal(next.transfer?.scope, 'frame');
  assert.equal(next.transfer?.reference, undefined);
  assert.equal(next.transfer?.motionCaption, undefined);
  assert.doesNotMatch(next.prompt, /bear|robot|mint|studio background/i);
  const owned = {
    ...next,
    prompt: 'My clay astronaut performs the driving action.',
    transfer: { ...motion.recipe.transfer!, motionCaption: 'A person jumps.', poseStrength: 0.75 },
  };
  assert.equal(applyTemplate(owned, motion).transfer?.reference, owned.transfer.reference);
  assert.equal(applyTemplate(owned, motion).transfer?.motionCaption, owned.transfer.motionCaption);
  assert.equal(applyTemplate(owned, motion).transfer?.poseStrength, 0.75);
  assert.equal(applyTemplate(owned, motion).prompt, owned.prompt);
  const ending = {
    recipe: JSON.parse(
      await readFile(
        new URL('../examples/crystal-transition/recipe.json', import.meta.url),
        'utf8',
      ),
    ),
  } as Template;
  const transition = applyTemplate(current, ending);
  assert.equal(transition.endFrame, undefined);
  assert.equal(transition.clip, current.clip);
  assert.doesNotMatch(transition.prompt, /forest|waterfall|crystal/i);
  assert.throws(
    () => applyTemplate({ ...current, clip: { ...current.clip, kind: 'image' } }, motion),
    /video source/,
  );
});

test('reviewed examples work from a hidden checkout and import real bytes without Python, GPU jobs or source overwrite', async () => {
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url)),
    directory = await mkdtemp(path.join(tmpdir(), 'aftertake-template-test-'));
  const root = path.join(directory, '.checkout');
  await mkdir(root);
  await cp(path.join(sourceRoot, 'examples'), path.join(root, 'examples'), { recursive: true });
  await Promise.all(
    ['clips', 'outputs', 'renders', 'previews'].map((name) => mkdir(path.join(directory, name))),
  );
  const renders = new Map<string, Render>();
  const app = express();
  app.use(express.json());
  app.use('/templates', await templateRouter(root, directory, renders));
  app.use(
    (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(400).json({ error: error.message });
    },
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.on('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/templates`;
  try {
    const catalog = (await fetch(url).then((r) => r.json())) as Template[];
    const manifest = JSON.parse(await readFile(path.join(root, 'examples/manifest.json'), 'utf8'));
    assert.deepEqual(
      catalog.map((item) => item.slug).sort(),
      manifest.cases.map((item: { slug: string }) => item.slug).sort(),
    );
    assert.equal((await fetch(url + '/portal/poster')).headers.get('content-type'), 'image/jpeg');
    assert.equal((await fetch(url + '/portal/private')).status, 404);
    assert.equal((await fetch(url + '/missing/open', { method: 'POST' })).status, 404);
    const open = () =>
      fetch(url + '/portal/open', { method: 'POST' }).then((r) => r.json()) as Promise<{
        render: Render;
      }>;
    const first = await open(),
      second = await open();
    assert.equal(first.render.id, second.render.id);
    assert.equal(renders.size, 1);
    assert.equal(
      first.render.origin?.renderId,
      manifest.cases.find((item: { slug: string }) => item.slug === 'portal').renderId,
    );
    const bytes = await readFile(path.join(directory, 'outputs', first.render.id + '.mp4'));
    assert.deepEqual(bytes, await readFile(path.join(root, 'examples/portal/result.mp4')));
    assert.equal(
      createHash('sha256')
        .update(
          await readFile(
            path.join(directory, 'clips', path.basename(first.render.recipe.clip.url)),
          ),
        )
        .digest('hex'),
      first.render.recipe.clip.sha256,
    );
    assert.ok(await readFile(path.join(directory, 'renders', first.render.id + '.json')));
    assert.notEqual(first.render.id, first.render.origin?.renderId);
    const quiet = (await fetch(url + '/quiet-approach/open', { method: 'POST' }).then((r) =>
      r.json(),
    )) as { render: Render };
    const guided = (await fetch(url + '/guided-pullback/open', { method: 'POST' }).then((r) =>
      r.json(),
    )) as { render: Render };
    assert.equal(quiet.render.recipe.clip.id, guided.render.recipe.clip.id);
    assert.equal(guided.render.recipe.clip.kind, 'image');
    assert.ok(guided.render.guideOutput);
    assert.notEqual(first.render.recipe.clip.id, quiet.render.recipe.clip.id);
    assert.deepEqual(
      await readFile(path.join(directory, 'outputs', first.render.id + '.mp4')),
      bytes,
    );
    const edited = (await fetch(url + '/reference-portal/open', { method: 'POST' }).then((r) =>
      r.json(),
    )) as { render: Render };
    assert.equal(edited.render.recipe.clip.id, first.render.recipe.clip.id);
    const image = edited.render.recipe.editReference!;
    assert.equal(image.kind, 'image');
    assert.equal(
      createHash('sha256')
        .update(await readFile(path.join(directory, 'clips', path.basename(image.url))))
        .digest('hex'),
      image.sha256,
    );
    assert.notEqual(image.id, '732369a3-0434-4d46-a327-e74fe29d143f');
    assert.equal(
      (await fetch(url + '/reference-portal/reference')).headers.get('content-type'),
      'image/png',
    );
    const appearance = await fetch(url + '/crystal-forest/frame-recipe').then((r) => r.json());
    assert.equal(appearance.request.mode, 'fast');
    assert.equal(
      appearance.output.sha256,
      catalog.find((item) => item.slug === 'crystal-forest')?.recipe.editReference?.sha256,
    );
    assert.equal(appearance.workflow['17'].inputs.steps, 4);
    const signal = (await fetch(url + '/signal/open', { method: 'POST' }).then((r) =>
      r.json(),
    )) as { render: Render };
    assert.equal(signal.render.recipe.pipeline, 'motion-transfer');
    const character = signal.render.recipe.transfer!.reference!;
    assert.equal(character.kind, 'image');
    assert.equal(
      createHash('sha256')
        .update(await readFile(path.join(directory, 'clips', path.basename(character.url))))
        .digest('hex'),
      character.sha256,
    );
    assert.equal((await fetch(url + '/signal/reference')).headers.get('content-type'), 'image/png');
    const creation = await fetch(url + '/signal/frame-recipe').then((r) => r.json());
    assert.equal(creation.request.clip.sha256, signal.render.recipe.clip.sha256);
    assert.equal(creation.output.sha256, character.sha256);
    assert.equal((signal.render.workflow!['13'] as any).class_type, 'WanAnimate2ToVideo');
    assert.equal(
      (
        (await fetch(url + '/signal/open', { method: 'POST' }).then((r) => r.json())) as {
          render: Render;
        }
      ).render.id,
      signal.render.id,
    );
    await writeFile(
      path.join(directory, 'clips', path.basename(character.url)),
      'corrupted test image',
    );
    const repaired = (await fetch(url + '/signal/open', { method: 'POST' }).then((r) =>
      r.json(),
    )) as { render: Render };
    assert.notEqual(repaired.render.id, signal.render.id);
    assert.notEqual(repaired.render.recipe.transfer?.reference?.id, character.id);
    assert.equal(
      await readFile(path.join(directory, 'clips', path.basename(character.url)), 'utf8'),
      'corrupted test image',
    );
    const transition = (await fetch(url + '/crystal-transition/open', { method: 'POST' }).then(
      (r) => r.json(),
    )) as { render: Render };
    assert.equal(transition.render.recipe.pipeline, 'cinema');
    assert.deepEqual(
      await readFile(path.join(directory, 'outputs', path.basename(transition.render.rawOutput!))),
      await readFile(path.join(root, 'examples/crystal-transition/raw.mp4')),
    );
    assert.equal(
      transition.render.recipe.clip.id,
      (
        (await fetch(url + '/golden-falls/open', { method: 'POST' }).then((r) => r.json())) as {
          render: Render;
        }
      ).render.recipe.clip.id,
    );
    const ending = transition.render.recipe.endFrame!;
    assert.equal(
      createHash('sha256')
        .update(await readFile(path.join(directory, 'clips', path.basename(ending.url))))
        .digest('hex'),
      ending.sha256,
    );
    assert.equal(
      (await fetch(url + '/crystal-transition/reference')).headers.get('content-type'),
      'image/png',
    );
    const endingCreation = await fetch(url + '/crystal-transition/frame-recipe').then((r) =>
      r.json(),
    );
    assert.equal(endingCreation.request.clip.sha256, transition.render.recipe.clip.sha256);
    assert.equal(endingCreation.output.sha256, ending.sha256);
    assert.equal(endingCreation.workflow['17'].inputs.steps, 4);
    for (const slug of ['coastal-kingdom', 'winter-valley']) {
      const opened = (await fetch(url + '/' + slug + '/open', { method: 'POST' }).then((r) =>
        r.json(),
      )) as { render: Render };
      assert.equal(opened.render.recipe.pipeline, 'inpaint');
      assert.equal(opened.render.recipe.cue.tracking, 'flow');
      const appearance = opened.render.recipe.editReference!;
      assert.equal(
        createHash('sha256')
          .update(await readFile(path.join(directory, 'clips', path.basename(appearance.url))))
          .digest('hex'),
        appearance.sha256,
      );
      const creation = await fetch(url + '/' + slug + '/frame-recipe').then((r) => r.json());
      assert.equal(creation.request.clip.sha256, opened.render.recipe.clip.sha256);
      assert.equal(creation.output.sha256, appearance.sha256);
      const expected = await readFile(path.join(root, 'examples', slug, 'result.mp4'));
      assert.deepEqual(
        await readFile(path.join(directory, 'outputs', opened.render.id + '.mp4')),
        expected,
      );
    }
    const castle = (await fetch(url + '/castle-pullback/open', { method: 'POST' }).then((r) =>
      r.json(),
    )) as { render: Render };
    assert.equal(castle.render.recipe.clip.kind, 'image');
    assert.equal(castle.render.recipe.cinema?.guidance, 'tracks');
    assert.deepEqual(
      await readFile(path.join(directory, 'outputs', path.basename(castle.render.rawOutput!))),
      await readFile(path.join(root, 'examples/castle-pullback/raw.mp4')),
    );
    assert.equal(castle.render.recipe.cinema?.movement, 'pull');
    const observatory = (await fetch(url + '/observatory/open', { method: 'POST' }).then((r) =>
      r.json(),
    )) as { render: Render };
    const imagined = await fetch(url + '/observatory/image-recipe').then((r) => r.json());
    assert.equal(imagined.format, 'aftertake-image/1');
    assert.equal(imagined.request.seed, 5090);
    assert.equal(imagined.request.style, 'cinematic');
    assert.equal(imagined.output.sha256, observatory.render.recipe.clip.sha256);
    assert.equal(observatory.render.recipe.clip.width, 1152);
    assert.equal(imagined.workflow['7'].class_type, 'EmptySD3LatentImage');
    assert.equal(imagined.workflow['17'].inputs.steps, 8);
    assert.equal(observatory.render.recipe.cinema?.guidance, 'tracks');
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('aftertake-template-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});
