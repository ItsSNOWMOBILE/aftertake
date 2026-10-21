import { test } from 'node:test';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  applyFrameCreativeRecipe,
  applyImageCreativeRecipe,
  frameCreativeRecipeSchema,
  frameCreativeRecipes,
  imageCreativeRecipeSchema,
  imageCreativeRecipes,
  applyVideoCreativeRecipe,
  videoCreativeRecipeSchema,
  videoCreativeRecipes,
} from '../src/creative-recipes.js';
import { frameEditRequestSchema } from '../src/frame-edit.js';
import { imageRequestSchema } from '../src/image-generation.js';
import { videoRequestSchema } from '../src/video-generation.js';
import { starterPreviewIds } from '../src/starter-previews.js';

const image = imageRequestSchema.parse({
  format: 'aftertake-image/1',
  name: 'My campaign',
  prompt: 'My original scene direction.',
  seed: 83742,
  aspect: 'portrait',
  style: 'none',
});
const video = videoRequestSchema.parse({
  format: 'aftertake-text-video/1',
  name: 'My teaser',
  prompt: 'My original motion direction.',
  seed: 51234,
  aspect: 'portrait',
  quality: 'draft',
  seconds: 3,
  sound: false,
});
const frame = frameEditRequestSchema.parse({
  format: 'aftertake-frame-edit/1',
  clip: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'My source',
    kind: 'video',
    sha256: 'a'.repeat(64),
    width: 1280,
    height: 720,
    duration: 8,
    url: '/media/my-source.mp4',
  },
  trimStart: 2.5,
  subject: {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'My product',
    kind: 'image',
    sha256: 'b'.repeat(64),
    width: 1024,
    height: 1024,
    duration: 1,
    url: '/media/my-product.png',
  },
  prompt: 'My original edit direction.',
  seed: 73142,
  mode: 'fast',
});

test('starter settings fit native contracts and cannot override media, seed or frame bindings', () => {
  const ids = [...imageCreativeRecipes, ...videoCreativeRecipes, ...frameCreativeRecipes].map(
    (recipe) => recipe.id,
  );
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 18);
  for (const recipe of imageCreativeRecipes) {
    assert.equal(imageCreativeRecipeSchema.safeParse(recipe).success, true);
    assert.equal(
      imageRequestSchema.safeParse(applyImageCreativeRecipe(image, recipe.id)).success,
      true,
    );
    for (const extra of [
      { seed: 1 },
      { aspect: 'square' },
      { name: 'Overridden' },
      { clip: frame.clip },
    ])
      assert.equal(
        imageCreativeRecipeSchema.safeParse({
          ...recipe,
          settings: { ...recipe.settings, ...extra },
        }).success,
        false,
      );
  }
  for (const recipe of videoCreativeRecipes) {
    assert.equal(videoCreativeRecipeSchema.safeParse(recipe).success, true);
    assert.equal(
      videoRequestSchema.safeParse(applyVideoCreativeRecipe(video, recipe.id)).success,
      true,
    );
    for (const extra of [
      { seed: 1 },
      { aspect: 'square' },
      { quality: 'final' },
      { name: 'Overridden' },
    ])
      assert.equal(
        videoCreativeRecipeSchema.safeParse({
          ...recipe,
          settings: { ...recipe.settings, ...extra },
        }).success,
        false,
      );
    assert.equal(
      videoCreativeRecipeSchema.safeParse({
        ...recipe,
        settings: { ...recipe.settings, cinema: { ...recipe.settings.cinema, guidance: 'tracks' } },
      }).success,
      false,
    );
  }
  for (const recipe of frameCreativeRecipes) {
    assert.equal(frameCreativeRecipeSchema.safeParse(recipe).success, true);
    assert.equal(
      frameEditRequestSchema.safeParse(applyFrameCreativeRecipe(frame, recipe.id)).success,
      true,
    );
    for (const extra of [
      { seed: 1 },
      { clip: frame.clip },
      { subject: frame.subject },
      { trimStart: 0 },
    ])
      assert.equal(
        frameCreativeRecipeSchema.safeParse({
          ...recipe,
          settings: { ...recipe.settings, ...extra },
        }).success,
        false,
      );
  }
});

test('loading image starters preserves the draft name, aspect and seed, with isolated editable settings', () => {
  const before = structuredClone(image);
  for (const recipe of imageCreativeRecipes) {
    const applied = applyImageCreativeRecipe(image, recipe.id);
    assert.equal(applied.seed, image.seed);
    assert.equal(applied.aspect, image.aspect);
    assert.equal(applied.name, image.name);
    assert.equal(applied.format, image.format);
    assert.equal(applied.prompt, recipe.settings.prompt);
    const shot = recipe.settings.direction!.shot,
      other = shot === 'overhead' ? 'low' : 'overhead';
    applied.direction!.shot = other;
    assert.equal(applyImageCreativeRecipe(image, recipe.id).direction!.shot, shot);
    assert.equal(recipe.settings.direction!.shot, shot);
  }
  assert.deepEqual(image, before);
  assert.throws(() => applyImageCreativeRecipe(image, 'missing'), /Unknown image starter/);
});

test('loading video starters preserves the draft name, aspect, quality and seed', () => {
  const before = structuredClone(video);
  for (const recipe of videoCreativeRecipes) {
    const applied = applyVideoCreativeRecipe(video, recipe.id);
    assert.equal(applied.seed, video.seed);
    assert.equal(applied.aspect, video.aspect);
    assert.equal(applied.quality, video.quality);
    assert.equal(applied.name, video.name);
    assert.equal(applied.prompt, recipe.settings.prompt);
    assert.equal(applied.seconds, recipe.settings.seconds);
    applied.cinema!.movement = 'locked';
    assert.equal(
      applyVideoCreativeRecipe(video, recipe.id).cinema!.movement,
      recipe.settings.cinema.movement,
    );
  }
  assert.deepEqual(video, before);
  assert.throws(() => applyVideoCreativeRecipe(video, 'missing'), /Unknown video starter/);
});

test('frame starters retain the actual uploaded source, subject, trim and seed without mutating a prior job', () => {
  const before = structuredClone(frame);
  const completedJob = { request: frame, state: 'succeeded', jobId: 'completed-generation' };
  for (const recipe of frameCreativeRecipes) {
    const applied = applyFrameCreativeRecipe(frame, recipe.id);
    assert.equal(applied.clip, frame.clip);
    assert.equal(applied.subject, frame.subject);
    assert.equal(applied.trimStart, frame.trimStart);
    assert.equal(applied.seed, frame.seed);
    assert.equal(applied.mode, 'detail');
    applied.prompt = 'My adjusted direction after loading.';
    assert.equal(completedJob.request.prompt, before.prompt);
    assert.equal(applyFrameCreativeRecipe(frame, recipe.id).prompt, recipe.settings.prompt);
  }
  assert.deepEqual(frame, before);
  const withoutSubject = { ...frame, subject: undefined };
  assert.throws(
    () => applyFrameCreativeRecipe(withoutSubject, 'product-replacement'),
    /Choose a subject reference before loading Product replacement/,
  );
  assert.throws(
    () => applyFrameCreativeRecipe(withoutSubject, 'outfit-try-on'),
    /before loading Outfit try-on/,
  );
  assert.equal(
    applyFrameCreativeRecipe(withoutSubject, 'warm-practical-relight').subject,
    undefined,
  );
  assert.throws(() => applyFrameCreativeRecipe(frame, 'missing'), /Unknown frame starter/);
});

test('gallery previews belong to real starters and ship their loop and poster', () => {
  const ids = new Set(
    [...imageCreativeRecipes, ...videoCreativeRecipes, ...frameCreativeRecipes].map(
      (item) => item.id,
    ),
  );
  for (const id of starterPreviewIds) {
    assert(ids.has(id), `${id} is not a starter`);
    for (const extension of ['mp4', 'jpg'])
      assert(existsSync(new URL(`../public/starters/${id}.${extension}`, import.meta.url)));
  }
});
