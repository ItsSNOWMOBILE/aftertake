import assert from 'node:assert/strict';
import test from 'node:test';
import { characterRequirements } from '../server/character-profile';

test('selection readiness requires native mask cleanup without duplicate replacement requirements', () => {
  for (const selectionOnly of [true, false]) {
    const { nodes } = characterRequirements(selectionOnly);
    assert.equal(nodes.filter((name) => name === 'GrowMask').length, 1);
    assert.ok(nodes.includes('SAM3_VideoTrack'));
    assert.ok(nodes.includes('AftertakeSaveCharacterSelection'));
  }
});
