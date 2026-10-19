import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createCueRuntime } from '../server/cue-runtime.js';
import { RequestError } from '../server/http-errors.js';

const root = path.resolve('cue-runtime-fixture');
const enginePython = path.join(root, 'engine', 'python');
const mediaPython = path.join(root, 'film', 'python');

test('cue preview prefers its explicit runtime and resolves relative paths from the workspace', async () => {
  const selected = path.join(root, 'custom', 'python');
  const visited: string[] = [];
  const checked: string[] = [];
  const runtime = createCueRuntime({
    root,
    enginePython,
    mediaPython,
    override: 'custom/python',
    exists: async (filename) => {
      visited.push(filename);
      return filename === selected;
    },
    check: async (python) => void checked.push(python),
  });
  assert.equal(await runtime.ready(), selected);
  assert.deepEqual(visited, [selected]);
  assert.deepEqual(checked, [selected]);
});

test('cue preview uses installed engine Python ahead of the Film-only Python', async () => {
  const checked: string[] = [];
  const runtime = createCueRuntime({
    root,
    enginePython,
    mediaPython,
    override: '',
    exists: async () => true,
    check: async (python) => void checked.push(python),
  });
  assert.equal(await runtime.ready(), enginePython);
  assert.deepEqual(checked, [enginePython]);
});

test('cue preview uses configured media Python only when engine Python is absent', async () => {
  const checked: string[] = [];
  const runtime = createCueRuntime({
    root,
    enginePython,
    mediaPython,
    override: '',
    exists: async (filename) => filename === mediaPython,
    check: async (python) => void checked.push(python),
  });
  assert.equal(await runtime.ready(), mediaPython);
  assert.deepEqual(checked, [mediaPython]);
});

test('cue dependency checks are lazy, deduplicated and cached after success', async () => {
  let checks = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  const runtime = createCueRuntime({
    root,
    enginePython,
    mediaPython,
    override: '',
    exists: async () => true,
    check: async () => {
      checks++;
      await blocked;
    },
  });
  assert.equal(checks, 0);
  const first = runtime.ready();
  const second = runtime.ready();
  assert.equal(first, second);
  release();
  assert.deepEqual(await Promise.all([first, second]), [enginePython, enginePython]);
  assert.equal(await runtime.ready(), enginePython);
  assert.equal(checks, 1);
});

test('missing or incompatible selected runtimes fail with an actionable 409 and no fallback', async () => {
  for (const missing of [false, true]) {
    const checked: string[] = [];
    const runtime = createCueRuntime({
      root,
      enginePython,
      mediaPython,
      override: 'private/runtime/python',
      exists: async () => !missing,
      check: async (python) => {
        checked.push(python);
        throw new Error('ModuleNotFoundError at /private/runtime/secret-location');
      },
    });
    await assert.rejects(runtime.ready(), (error: unknown) => {
      assert.ok(error instanceof RequestError);
      assert.equal(error.status, 409);
      assert.match(error.message, /AFTERTAKE_CUE_PYTHON/);
      assert.match(error.message, /Torch, PyAV, OpenCV and Pillow/);
      assert.doesNotMatch(error.message, /secret-location|ModuleNotFoundError|private/);
      return true;
    });
    assert.deepEqual(checked, missing ? [] : [path.join(root, 'private/runtime/python')]);
  }
});

test('a dependency failure can be retried after setup repairs the same selected runtime', async () => {
  let checks = 0;
  const runtime = createCueRuntime({
    root,
    enginePython,
    mediaPython,
    override: '',
    exists: async () => true,
    check: async () => {
      if (++checks === 1) throw new Error('Packages missing.');
    },
  });
  await assert.rejects(runtime.ready(), { status: 409 });
  assert.equal(await runtime.ready(), enginePython);
  assert.equal(checks, 2);
});
