import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visitorCopy } from '../scripts/load-examples.mjs';

const effect = {
  id: '6e7863b3-af74-461b-83b3-71189b422ed4',
  createdAt: '2026-10-24T21:02:00.000Z',
  state: 'ready',
  watermark: true,
  exports: { watermark: { filmId: 'a' } },
};
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const target = `one-tap/${effect.id}.json`;

test('a recorded effect that only gained a cut keeps the visitor’s newer record', () => {
  const recut = {
    ...effect,
    watermark: false,
    exports: { ...effect.exports, clean: { filmId: 'b' } },
  };
  assert.equal(visitorCopy(target, bytes(recut), bytes(effect)), true);
});

test('any other change to a recorded file is still refused', () => {
  const other = { ...effect, exports: { watermark: { filmId: 'c' } } };
  assert.equal(visitorCopy(target, bytes(other), bytes(effect)), false);
  assert.equal(visitorCopy(target, bytes({ ...effect, id: 'x' }), bytes(effect)), false);
  assert.equal(visitorCopy(target, Buffer.from('{'), bytes(effect)), false);
  assert.equal(
    visitorCopy(`renders/${effect.id}.json`, bytes(effect), bytes({ ...effect, state: 'failed' })),
    false,
  );
});
