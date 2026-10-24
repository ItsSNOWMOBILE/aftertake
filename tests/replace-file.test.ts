import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { replaceFile } from '../server/replace-file.js';

const failure = (code: string) => Object.assign(new Error(`synthetic ${code}`), { code });

/** Make the next renames fail with `codes`, in order, then rename for real. */
function failRenames(t: test.TestContext, codes: string[]) {
  const rename = fs.rename;
  let calls = 0;
  t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
    const code = codes[calls++];
    if (code) throw failure(code);
    await rename(...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return () => calls;
}

async function files() {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'aftertake-replace-'));
  const source = path.join(folder, 'record.json.tmp'),
    target = path.join(folder, 'record.json');
  await writeFile(target, 'old');
  await writeFile(source, 'new');
  return { source, target };
}

test('on Windows a briefly busy target is retried until the replace succeeds', async (t) => {
  const { source, target } = await files();
  const calls = failRenames(t, ['EPERM', 'EBUSY', 'EPERM']);
  await replaceFile(source, target, { platform: 'win32' });
  assert.equal(calls(), 4);
  assert.equal(await readFile(target, 'utf8'), 'new');
});

test('other errors, other systems and a target that stays busy fail as before', async (t) => {
  const { source, target } = await files();
  const calls = failRenames(t, ['EIO', 'EACCES', 'EPERM', 'EPERM', 'EPERM', 'EPERM']);
  await assert.rejects(replaceFile(source, target, { platform: 'win32' }), { code: 'EIO' });
  assert.equal(calls(), 1, 'a real write failure is not retried');
  await assert.rejects(replaceFile(source, target, { platform: 'win32' }), { code: 'EACCES' });
  assert.equal(calls(), 2, 'a permission failure is not retried');
  await assert.rejects(replaceFile(source, target, { platform: 'linux' }), { code: 'EPERM' });
  assert.equal(calls(), 3, 'only Windows retries a busy file');
  await assert.rejects(replaceFile(source, target, { platform: 'win32', attempts: 3 }), {
    code: 'EPERM',
  });
  assert.equal(calls(), 6, 'the retries stop after the last attempt');
  assert.equal(await readFile(target, 'utf8'), 'old');
});
