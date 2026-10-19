import test from 'node:test';
import assert from 'node:assert/strict';
import { registerRecompositionTools } from '../server/recomposition-tools.js';
import { toolAnnotations } from '../server/tool-annotations.js';

test('blend tools retain replay keys and read the completed take without generation', async () => {
  const tools = new Map<string, { run: (input: any) => Promise<any>; readOnly: boolean }>();
  const calls: { path: string; body: unknown; key: string | undefined }[] = [];
  const job = { id: 'job', state: 'succeeded', renderId: 'take' };
  const take = { id: 'take', recomposition: { noComfyGraphExecution: true } };
  registerRecompositionTools({
    tool(name, _description, _schema, run, readOnly = true) {
      tools.set(name, { run, readOnly });
    },
    async api(path, body, key) {
      calls.push({ path, body, key });
      return (path.startsWith('/api/renders/') ? take : job) as any;
    },
  });
  const request = { renderId: 'source', matchSourceColor: false };
  await tools.get('aftertake_refine_blend')!.run({ requestId: 'stable-blend', request });
  assert.deepEqual(calls.shift(), {
    path: '/api/recompositions',
    body: request,
    key: 'stable-blend',
  });
  const result = await tools.get('aftertake_blend_status')!.run({ requestId: 'stable-blend' });
  assert.deepEqual(result.data, { job, take });
  assert.deepEqual(calls.splice(0), [
    { path: '/api/recompositions/by-key/stable-blend', body: undefined, key: undefined },
    { path: '/api/renders/take', body: undefined, key: undefined },
  ]);
  await tools.get('aftertake_cancel_blend')!.run({ id: 'job' });
  assert.deepEqual(calls, [{ path: '/api/recompositions/job/cancel', body: {}, key: undefined }]);
  assert.equal(tools.get('aftertake_refine_blend')!.readOnly, false);
  assert.equal(tools.get('aftertake_blend_status')!.readOnly, true);
  assert.equal(toolAnnotations('aftertake_refine_blend', false).idempotentHint, true);
  assert.equal(toolAnnotations('aftertake_cancel_blend', false).destructiveHint, true);
});

test('unfinished CPU blends expose only their saved job and do not query a result', async () => {
  const tools = new Map<string, (input: any) => Promise<any>>();
  const calls: string[] = [];
  registerRecompositionTools({
    tool(name, _description, _schema, run) {
      tools.set(name, run);
    },
    async api(path) {
      calls.push(path);
      return { id: 'job', state: 'interrupted' } as any;
    },
  });
  const result = await tools.get('aftertake_blend_status')!({ id: 'job' });
  assert.equal(result.data.job.state, 'interrupted');
  assert.equal(result.data.take, undefined);
  assert.deepEqual(calls, ['/api/recompositions/job']);
});
