import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Evaluate the real launcher declarations with mocked process probes. Its entry
// point is excluded, so these tests cannot install dependencies or start services.
const launcherSource = readFileSync(
  new URL('../scripts/aftertake.mjs', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
assert.ok(launcherSource.includes('\ntry {\n  if (command'), 'Find the launcher entry boundary.');
const declarations = launcherSource
  .slice(0, launcherSource.indexOf('\ntry {\n  if (command'))
  .replace(/^import .+ from .+;\r?\n/gm, '')
  .replaceAll('import.meta.url', "'file:///launcher-test/scripts/aftertake.mjs'");

function discover(platform: string, versions: string[], installed: Record<string, string | null>) {
  const root = path.resolve('launcher-test'),
    runtime = (folder: string) =>
      path.join(
        root,
        '.runtime',
        folder,
        platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
      ),
    calls: { program: string; args: string[]; shell: boolean }[] = [];
  const context = vm.createContext({
    path,
    fileURLToPath: () => path.join(root, 'scripts', 'aftertake.mjs'),
    process: { platform, argv: ['node', 'aftertake.mjs', 'doctor'], env: {} },
    existsSync: (file: string) => Object.hasOwn(installed, file),
    spawnSync: (program: string, args: string[], options: { shell: boolean }) => {
      calls.push({ program, args: [...args], shell: options.shell });
      const key = program === 'py' ? `${program} ${args[0]}` : program,
        version = installed[key];
      return { status: version ? 0 : 1, stdout: version || '', stderr: '' };
    },
  });
  vm.runInContext(declarations, context);
  const result = context.python(versions);
  return { result: result && JSON.parse(JSON.stringify(result)), calls, runtime };
}

test('launcher prefers a working engine Python without the system launcher or PATH', () => {
  const root = path.resolve('launcher-test'),
    engine = path.join(root, '.runtime/venv/Scripts/python.exe'),
    film = path.join(root, '.runtime/film-venv/Scripts/python.exe');
  const { result, calls } = discover('win32', ['3.12'], {
    [engine]: '3.12',
    [film]: '3.12',
    python: '3.13',
  });
  assert.deepEqual(result, { program: engine, prefix: [], version: '3.12' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].shell, false);
});

test('launcher skips a broken or incompatible engine and uses compatible media Python', () => {
  const root = path.resolve('launcher-test'),
    engine = path.join(root, '.runtime/venv/Scripts/python.exe'),
    film = path.join(root, '.runtime/film-venv/Scripts/python.exe');
  for (const engineVersion of [null, '3.13']) {
    const { result, calls } = discover('win32', ['3.12'], {
      [engine]: engineVersion,
      [film]: '3.12',
    });
    assert.deepEqual(result, { program: film, prefix: [], version: '3.12' });
    assert.equal(calls.length, 2);
  }
});

test('a clean Windows install retains system discovery and rejects incompatible Python', () => {
  const selected = discover('win32', ['3.12'], { 'py -3.12': '3.12' });
  assert.deepEqual(selected.result, { program: 'py', prefix: ['-3.12'], version: '3.12' });
  assert.equal(selected.calls[0].program, 'py');
  assert.equal(discover('win32', ['3.12'], { python: '3.13' }).result, null);
});

test('Unix runtime discovery uses bin/python and preserves clean-install search order', () => {
  const engine = path.join(path.resolve('launcher-test'), '.runtime/venv/bin/python');
  assert.equal(discover('linux', ['3.12'], { [engine]: '3.12' }).result.program, engine);
  const clean = discover('darwin', ['3.12', '3.13'], { python3: '3.13' });
  assert.deepEqual(
    clean.calls.map((call) => call.program),
    ['python3.12', 'python3.13', 'python3'],
  );
  assert.deepEqual(clean.result, { program: 'python3', prefix: [], version: '3.13' });
});
