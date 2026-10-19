import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveMediaRuntime } from '../server/media-runtime.js';
import { RequestError } from '../server/http-errors.js';

const root = path.resolve('media-runtime-fixture');
const filmPython = path.join(root, 'film', 'python');
const enginePython = path.join(root, 'engine', 'python');
const base = { root, filmPython, enginePython, override: '', recordedOnly: false };

test('healthy Film Python is preferred without inspecting an incomplete GPU runtime', async () => {
  const checked: string[] = [];
  assert.equal(
    await resolveMediaRuntime({
      ...base,
      exists: async () => true,
      check: async (python) => {
        checked.push(python);
        if (python === enginePython) throw Error('GPU setup did not finish.');
      },
    }),
    filmPython,
  );
  assert.deepEqual(checked, [filmPython]);
});

test('a healthy engine runtime can supply media dependencies when Film is absent or incomplete', async () => {
  for (const filmExists of [true, false]) {
    const checked: string[] = [];
    assert.equal(
      await resolveMediaRuntime({
        ...base,
        exists: async (python) => python === enginePython || filmExists,
        check: async (python) => {
          checked.push(python);
          if (python === filmPython) throw Error('Incomplete media setup.');
        },
      }),
      enginePython,
    );
    assert.deepEqual(checked, filmExists ? [filmPython, enginePython] : [enginePython]);
  }
});

test('a failed Film FFmpeg binary probe falls back to a healthy engine media runtime', async () => {
  const checked: string[] = [];
  const selected = await resolveMediaRuntime({
    ...base,
    exists: async () => true,
    check: async (python) => {
      checked.push(python);
      if (python === filmPython)
        throw Object.assign(new Error('FFmpeg could not execute.'), { code: 'ENOEXEC' });
    },
  });
  assert.equal(selected, enginePython);
  assert.deepEqual(checked, [filmPython, enginePython]);
});

test('an explicit runtime with a broken FFmpeg binary is not silently replaced', async () => {
  const selected = path.join(root, 'custom', 'python');
  const checked: string[] = [];
  await assert.rejects(
    resolveMediaRuntime({
      ...base,
      override: selected,
      exists: async () => true,
      check: async (python) => {
        checked.push(python);
        throw new Error('FFmpeg failed at /private/native-binary-path.');
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof RequestError);
      assert.equal(error.status, 409);
      assert.match(error.message, /working.*FFmpeg executable/);
      assert.match(error.message, /setup-film.py/);
      assert.doesNotMatch(error.message, /private|native-binary-path/);
      return true;
    },
  );
  assert.deepEqual(checked, [selected]);
});

test('an explicit media Python remains authoritative and workspace-relative', async () => {
  const selected = path.join(root, 'custom', 'python');
  const checked: string[] = [];
  assert.equal(
    await resolveMediaRuntime({
      ...base,
      override: 'custom/python',
      exists: async () => true,
      check: async (python) => void checked.push(python),
    }),
    selected,
  );
  assert.deepEqual(checked, [selected]);
});

test('an incomplete explicit runtime and all-incomplete defaults fail with a safe setup error', async () => {
  for (const override of ['', 'custom/python']) {
    const checked: string[] = [];
    await assert.rejects(
      resolveMediaRuntime({
        ...base,
        override,
        exists: async () => true,
        check: async (python) => {
          checked.push(python);
          throw Error('Dependency failed at /private/path with native details.');
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof RequestError);
        assert.equal(error.status, 409);
        assert.match(error.message, /setup-film.py/);
        assert.match(error.message, /AFTERTAKE_PYTHON/);
        assert.doesNotMatch(error.message, /private|native details/);
        return true;
      },
    );
    assert.deepEqual(checked, override ? [path.join(root, override)] : [filmPython, enginePython]);
  }
});

test('no Python installation preserves recorded viewing and media route setup checks', async () => {
  for (const override of ['', 'missing-test-python']) {
    assert.equal(
      await resolveMediaRuntime({
        ...base,
        override,
        exists: async () => false,
        check: async () => assert.fail('No interpreter should be invoked.'),
      }),
      override ? path.join(root, override) : filmPython,
    );
  }
});

test('recorded-only examples do not check dependencies or replace an explicit runtime', async () => {
  for (const override of ['', 'custom/python']) {
    assert.equal(
      await resolveMediaRuntime({
        ...base,
        override,
        recordedOnly: true,
        exists: async () => true,
        check: async () => assert.fail('Recorded examples need no media dependency import.'),
      }),
      override ? path.join(root, override) : filmPython,
    );
  }
});
