import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
  return nextLoad(url, context);
}`),
  import.meta.url,
);
const { default: DepthEffectsStudio, depthAttemptAfterJob } =
  await import('../src/DepthEffectsStudio.js');

test('depth retries get a new admission only after their own definitive terminal failure', () => {
  const attempt = { id: 'same-request', request: 'same-settings' };
  for (const state of ['failed', 'canceled', 'expired']) {
    assert.equal(depthAttemptAfterJob(attempt, { state, requestKey: attempt.id }), undefined);
    assert.equal(depthAttemptAfterJob(attempt, { state, requestKey: 'other-request' }), attempt);
  }
  for (const state of [
    'queued',
    'running',
    'succeeded',
    'submission_unknown',
    'connection_lost',
    'output_error',
    'finalizing',
  ])
    assert.equal(
      depthAttemptAfterJob(attempt, { state, requestKey: attempt.id }),
      attempt,
      'Keep the original identity for ' + state,
    );
});

test('depth first use describes its real still-only workflow without a fabricated preview', () => {
  const markup = renderToStaticMarkup(
    createElement(DepthEffectsStudio, {
      clips: [],
      otherBusy: false,
      onUse() {},
      onImport() {},
      onClose() {},
    }),
  );
  assert.match(markup, /Import a still image to begin/);
  assert.match(markup, /This version processes still images/);
  assert.match(markup, /does not reconstruct physical shadows/);
  for (const label of [
    'Focus depth',
    'Lens blur',
    'Haze',
    'Light direction',
    'Light elevation',
    'Light strength',
  ])
    assert.ok(markup.includes(`aria-label="${label}"`));
  assert.doesNotMatch(markup, /<img|<canvas|<video/);
});
