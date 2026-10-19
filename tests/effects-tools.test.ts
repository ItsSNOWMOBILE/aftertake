import test from 'node:test';
import assert from 'node:assert/strict';
import { registerEffectsTools } from '../server/effects-tools.js';
import { toolAnnotations } from '../server/tool-annotations.js';

test('effect tools preserve stable operation keys and expose the actual finished clip', async () => {
  const registered = new Map<string, { run: (input: any) => Promise<any>; readOnly: boolean }>();
  const calls: any[] = [];
  const clip = { id: 'a', sha256: 'b' };
  registerEffectsTools({
    base: 'http://127.0.0.1:4310',
    tool(name, _description, _schema, run, readOnly = true) {
      registered.set(name, { run, readOnly });
    },
    async api(path, body, key) {
      calls.push({ path, body, key });
      return { id: 'finished', clip } as any;
    },
  });
  const request = {
    selectionId: 'inspected-selection',
    maskSha256: 'inspected-hash',
    copies: [{ x: 0.2, y: 0, scale: 1, opacity: 1 }],
  };
  const result = await registered
    .get('aftertake_duplicate_subject')!
    .run({ requestId: 'stable-subject-copy', request });
  assert.deepEqual(calls[0], {
    path: '/api/subject-effects/duplicates',
    body: request,
    key: 'stable-subject-copy',
  });
  assert.deepEqual(result.data.clip, clip);
  assert.equal(registered.get('aftertake_duplicate_subject')!.readOnly, false);
  assert.equal(toolAnnotations('aftertake_duplicate_subject', false).idempotentHint, true);
  assert.equal(toolAnnotations('aftertake_finish_media', false).idempotentHint, true);
  assert.equal(toolAnnotations('aftertake_cancel_finishing', false).destructiveHint, true);
});

test('effect status rejoins by key without submitting another operation and rejects a missing request', async () => {
  const runs = new Map<string, (input: any) => Promise<any>>();
  const calls: { path: string; body: unknown }[] = [];
  registerEffectsTools({
    base: 'http://127.0.0.1:4310',
    tool(name, _description, _schema, run) {
      runs.set(name, run);
    },
    async api(path, body) {
      calls.push({ path, body });
      return [{ id: 'saved', requestKey: 'known', state: 'succeeded' }] as any;
    },
  });
  assert.equal(
    (await runs.get('aftertake_effect_status')!({ kind: 'subject', requestId: 'known' })).data.id,
    'saved',
  );
  assert.deepEqual(calls, [{ path: '/api/subject-effects', body: undefined }]);
  await assert.rejects(
    runs.get('aftertake_effect_status')!({ kind: 'finishing', requestId: 'absent' }),
    /No saved effect/,
  );
});
