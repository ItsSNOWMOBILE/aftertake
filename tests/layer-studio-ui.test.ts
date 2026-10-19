import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultFinishingSettings } from '../src/finishing.js';
import {
  defaultLayerTransform,
  layerStackRequestSchema,
  layerBlendModes,
} from '../src/layer-stack.js';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
  return nextLoad(url, context);
}`),
  import.meta.url,
);
const { default: LayerStudio, layerPreviewKey } = await import('../src/LayerStudio.js');

const image = {
  type: 'image' as const,
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Original photo',
  visible: true,
  opacity: 1,
  blend: 'normal' as const,
  dissolveSeed: 42,
  clipToBelow: false,
  source: { assetId: '22222222-2222-4222-8222-222222222222', sha256: 'a'.repeat(64) },
  transform: { ...defaultLayerTransform },
};
// The mask is appended after the initial Add image fields, as changeLayer does.
const draft = {
  format: 'aftertake-layer-stack/1' as const,
  name: 'Layer preview regression',
  canvas: { width: 1280, height: 720 },
  layers: [
    {
      ...image,
      mask: {
        kind: 'ellipse',
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.8,
        enabled: true,
        invert: false,
        grow: 0,
        feather: 0,
      },
    },
  ],
};

test('fresh preview identity survives schema property order and default insertion', () => {
  const parsed = layerStackRequestSchema.parse(draft);
  assert.notEqual(
    JSON.stringify(draft),
    JSON.stringify(parsed),
    'fixture reproduces raw order mismatch',
  );
  assert.equal(layerPreviewKey(draft), layerPreviewKey(parsed));
  const sparse = {
    ...draft,
    layers: [{ type: image.type, id: image.id, name: image.name, source: image.source }],
  };
  assert.equal(layerPreviewKey(sparse), layerPreviewKey(layerStackRequestSchema.parse(sparse)));
  assert.notEqual(
    layerPreviewKey(draft),
    layerPreviewKey({ ...draft, layers: [{ ...image, opacity: 0.5 }] }),
  );
  assert.notEqual(
    layerPreviewKey(draft),
    layerPreviewKey({
      ...draft,
      layers: [{ ...image, transform: { ...image.transform, x: 0.2 } }],
    }),
  );
});

test('empty layer workspace explains explicit still rendering and invents no preview', () => {
  const html = renderToStaticMarkup(
    createElement(LayerStudio, { onUse() {}, onImport() {}, onClose() {} }),
  );
  for (const label of [
    'No composition has been rendered yet',
    'Import a still to begin',
    'Render preview',
    'Save PNG',
  ])
    assert(html.includes(label));
  assert.match(html, /role="dialog"/);
  assert.doesNotMatch(html, /<img|<canvas|<video/);
});

test('restored adjustment exposes 27 blends and shared HSL, curves and LUT controls', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const restored = layerStackRequestSchema.parse({
    ...draft,
    layers: [
      image,
      {
        type: 'adjustment',
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Selective grade',
        visible: true,
        opacity: 1,
        blend: 'normal',
        dissolveSeed: 42,
        clipToBelow: false,
        settings: structuredClone(defaultFinishingSettings),
      },
    ],
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key: string) {
        return key === 'aftertake-layer-stack-draft/1' ? JSON.stringify(restored) : null;
      },
    },
  });
  try {
    const html = renderToStaticMarkup(
      createElement(LayerStudio, { onUse() {}, onImport() {}, onClose() {} }),
    );
    assert(html.indexOf('Selective grade') < html.indexOf('Original photo'), 'list is top-first');
    for (const mode of layerBlendModes) assert(html.includes(`value="${mode}"`), mode);
    assert.match(html, /aria-label="Selective HSL channel"/);
    assert.match(html, /aria-label="Tone curve channel"/);
    assert.match(html, /My LUT expects display-referred sRGB/);
    assert.match(html, /A plan contains settings and media hashes/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
