import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Clip } from '../src/domain.js';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
  return nextLoad(url, context);
}`),
  import.meta.url,
);
const { default: FinishingStudio } = await import('../src/FinishingStudio.js');

test('the real finishing workspace exposes disabled-by-default optics and explicit preview/export', () => {
  const clip: Clip = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Original photo',
    url: '/media/original.png',
    sha256: 'a'.repeat(64),
    width: 768,
    height: 432,
    duration: 1,
    kind: 'image',
    hasAudio: false,
  };
  const markup = renderToStaticMarkup(
    createElement(FinishingStudio, {
      initialClip: clip,
      clips: [clip],
      onImport() {},
      onUse() {},
      onFilmAdded() {},
      onClose() {},
    }),
  );
  assert.match(markup, /aria-label="Finishing optical recipe"/);
  assert.match(markup, /value="off" selected=""/);
  for (const label of ['highlight glow', 'warm halation', 'color separation'])
    assert.match(markup, new RegExp(`aria-label="Finishing ${label}"[^>]*value="0"`));
  for (const recipe of ['Soft highlight glow', 'Warm highlight halo', 'Subtle prism'])
    assert(markup.includes(recipe));
  assert(markup.includes('Recipes keep your color grade.'));
  assert(markup.includes('does not repair composite seams'));
  assert(markup.includes('Preview frame'));
  assert(markup.includes('Save finished take'));
});
