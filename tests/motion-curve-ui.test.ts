import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { register } from 'node:module';
import {
  motionCurveAmount,
  motionCurvePresets,
  type MotionCurve,
  type MotionTrack,
} from '../src/film-motion.js';

// SSR exercises the mounted Film editor; native browser styles do not participate in its markup.
register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
  return nextLoad(url, context);
}`),
  import.meta.url,
);
const { MotionTrackEditor } = await import('../src/MotionGraphics.js');

const first = { at: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
const track = (arrival: Partial<MotionTrack['keys'][number]>): MotionTrack => ({
  keys: [first, { ...first, at: 1, x: 0.4, ...arrival }],
});
const render = (motion: MotionTrack) =>
  renderToStaticMarkup(createElement(MotionTrackEditor, { motion, onChange() {} }));

test('a custom key mounts a curve graph, presets and numeric handles drawn by the solver', () => {
  const curve = { ...motionCurvePresets['expo-out'] };
  const html = render(track({ easing: 'custom', bezier: curve }));
  assert.match(html, /<option value="custom" selected="">Custom curve · cubic Bézier<\/option>/);
  assert.match(html, /<option value="expo-out" selected="">Snap · fast arrival, long settle/);
  assert.ok(html.includes('cubic-bezier(0.16, 1, 0.3, 1)'));
  assert.ok(html.includes('aria-label="Key 2 easing curve cubic-bezier(0.16, 1, 0.3, 1)"'));
  assert.ok(html.includes('d="M0 1C0.16 0 0.3 0 1 0"'));
  for (const [field, value] of Object.entries(curve))
    assert.match(html, new RegExp(`aria-label="Key 2 curve ${field}"[^>]*value="${value}"`));
  // Each dot is the export solver's own value at an equal time step.
  assert.equal(html.match(/class="motion-curve-sample"/g)?.length, 11);
  assert.ok(html.includes(`cy="${1 - motionCurveAmount(0.5, curve)}"`));
  assert.equal(html.match(/class="motion-curve-handle"/g)?.length, 2);
});

test('edited curves show exact values without claiming a preset', () => {
  const curve: MotionCurve = { x1: 0.2, y1: 0.35, x2: 0.42, y2: 0.9 };
  const html = render(track({ easing: 'custom', bezier: curve }));
  assert.match(html, /<option value="edited" selected="">Edited curve<\/option>/);
  assert.ok(html.includes('cubic-bezier(0.2, 0.35, 0.42, 0.9)'));
});

test('a disabled editor locks every curve control', () => {
  const motion = track({ easing: 'custom', bezier: { ...motionCurvePresets.standard } });
  const html = renderToStaticMarkup(
    createElement(MotionTrackEditor, { motion, onChange() {}, disabled: true }),
  );
  assert.match(html, /<select aria-label="Key 2 curve preset" disabled="">/);
  for (const field of ['x1', 'y1', 'x2', 'y2'])
    assert.match(html, new RegExp(`aria-label="Key 2 curve ${field}"[^>]*disabled=""`));
});

test('named easings and older tracks keep their editor without a curve panel', () => {
  for (const motion of [track({ easing: 'ease-out' }), track({})]) {
    const html = render(motion);
    assert.ok(!html.includes('motion-curve-editor'));
    assert.match(html, /<option value="custom">Custom curve · cubic Bézier<\/option>/);
  }
  assert.match(render(track({ easing: 'ease-out' })), /<option value="ease-out" selected="">/);
  assert.match(render(track({})), /<option value="linear" selected="">/);
});
