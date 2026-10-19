import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, open, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { computeFeatures } from '../src/compute.js';
import { requirements } from '../server/workflow.js';
import { cudaSystemStats, hardwareFixture } from './hardware-fixture.js';

const root = path.resolve(import.meta.dirname, '..');
const cli = path.join(root, 'scripts/check-engine-readiness.mts');
const { validateReadinessDiskPath } = await import(
  new URL('../scripts/check-engine-readiness.mts', import.meta.url).href
);
type Definition = {
  input: { required: Record<string, unknown>; optional: Record<string, unknown> };
  output: string[];
};

async function fixture(
  run: (directory: string, objectInfo: string, stats: string, hardware: string) => Promise<void>,
) {
  const tempRoot = await realpath(tmpdir());
  const directory = await mkdtemp(path.join(tempRoot, 'aftertake-metadata-cli-'));
  try {
    const nodes: Record<string, Definition> = {};
    for (const feature of computeFeatures) {
      const profile = requirements(feature);
      for (const name of profile.nodes)
        nodes[name] ??= { input: { required: {}, optional: {} }, output: [] };
      for (const [name, input, filename] of profile.menus) {
        const menu = (nodes[name].input.required[input] ??= [[]]) as [string[]];
        if (!menu[0].includes(filename)) menu[0].push(filename);
      }
    }
    nodes.AftertakeLoadClip.output = ['IMAGE', 'STRING'];
    nodes.AftertakeCueMask.output = ['MASK', 'MASK', 'MASK'];
    nodes.AftertakeSaveVideo.input.optional.generated_audio = ['AUDIO', { forceInput: true }];
    nodes.AftertakeRuntimeInfo.input.required.ffmpeg_tools = [['ready']];
    nodes.AftertakeRuntimeInfo.input.required.weight_copy_backend = [['pytorch']];
    nodes.PrivatePhotoNode = {
      input: { required: { image: [['private-personal-photo.png']] }, optional: {} },
      output: [],
    };
    const objectInfo = path.join(directory, 'private-metadata.json');
    const stats = path.join(directory, 'private-host-stats.json');
    await writeFile(objectInfo, JSON.stringify(nodes));
    await writeFile(
      stats,
      JSON.stringify({
        ...cudaSystemStats,
        system: { os: 'win32', argv: ['private-api-key', '/private/user/path'] },
      }),
    );
    const hardware = path.join(directory, 'hardware-status.json');
    await writeFile(
      hardware,
      JSON.stringify({
        format: 'aftertake-hardware-status-bundle/1',
        profiles: computeFeatures.map(hardwareFixture),
      }),
    );
    await writeFile(
      path.join(directory, 'no-network.mjs'),
      'globalThis.fetch = () => { throw Error("The offline check must not fetch"); };',
    );
    await run(directory, objectInfo, stats, hardware);
  } finally {
    assert.equal(path.dirname(await realpath(directory)), tempRoot);
    assert.ok(path.basename(directory).startsWith('aftertake-metadata-cli-'));
    await rm(directory, { recursive: true, force: true });
  }
}

function invoke(directory: string, args: string[]) {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(path.join(directory, 'no-network.mjs')).href,
      '--import',
      'tsx',
      cli,
      ...args,
    ],
    { cwd: root, encoding: 'utf8', timeout: 20000 },
  );
  assert.ifError(result.error);
  return result;
}

test('offline report checks all profiles, binds exact input bytes, and exposes no private metadata', async () => {
  await fixture(async (directory, objectInfo, stats, hardware) => {
    const result = invoke(directory, [
      '--object-info',
      objectInfo,
      '--system-stats',
      stats,
      '--hardware-info',
      hardware,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.format, 'aftertake-engine-readiness/1');
    assert.deepEqual(report.summary, {
      checked: computeFeatures.length,
      passed: computeFeatures.length,
      blocked: 0,
    });
    assert.deepEqual(
      report.results.map((item: { feature: string }) => item.feature),
      computeFeatures,
    );
    assert.equal(report.generationReady, false);
    assert.deepEqual(report.actions, {
      engineRequests: 0,
      submittedJobs: 0,
      changedConnections: 0,
    });
    for (const [key, file] of [
      ['objectInfo', objectInfo],
      ['systemStats', stats],
      ['hardwareInfo', hardware],
    ]) {
      const bytes = await readFile(file);
      assert.equal(report.inputs[key].sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(report.inputs[key].bytes, bytes.length);
    }
    for (const item of report.results) {
      assert.equal(item.profileChecksPassed, true);
      assert.equal(
        item.contractSha256,
        createHash('sha256')
          .update(JSON.stringify(requirements(item.feature)))
          .digest('hex'),
      );
    }
    for (const privateValue of [
      directory,
      'private-metadata.json',
      'private-personal-photo.png',
      'private-api-key',
      '/private/user/path',
    ])
      assert.equal(result.stdout.includes(privateValue), false);
  });
});

test('network and device path rejection is pure and covers input and output namespaces', () => {
  // These strings are passed only to the pure guard, never to a filesystem API.
  for (const filename of [
    '\\\\host\\share\\metadata.json',
    '//host/share/metadata.json',
    '/\\host/share/metadata.json',
    '\\/host/share/metadata.json',
    '\\\\?\\UNC\\host\\share\\metadata.json',
    '\\\\.\\UNC\\host\\share\\metadata.json',
    '\\\\?\\C:\\metadata.json',
    '\\??\\UNC\\host\\share\\metadata.json',
    '\\Device\\Mup\\host\\share\\metadata.json',
    'file://host/share/metadata.json',
    'https://host/metadata.json',
    'smb://host/share/metadata.json',
  ])
    assert.throws(() => validateReadinessDiskPath(filename), /Use disk paths/);
  for (const filename of [
    '.runtime/cloud/object-info.json',
    path.join(tmpdir(), 'aftertake-metadata.json'),
    'C:\\local\\metadata.json',
    'C:/local/metadata.json',
  ])
    assert.doesNotThrow(() => validateReadinessDiskPath(filename));
});

test('CLI writes UTF-8 reports once and preserves existing files and input snapshots', async () => {
  await fixture(async (directory, objectInfo, stats, hardware) => {
    const before = await readFile(objectInfo);
    const output = path.join(directory, 'new-reports', 'readiness.json');
    const args = [
      '--feature',
      'image-gen',
      '--object-info',
      objectInfo,
      '--system-stats',
      stats,
      '--hardware-info',
      hardware,
      '--output',
      output,
    ];
    const result = invoke(directory, args);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      written: true,
      checked: 1,
      passed: 1,
      blocked: 0,
      generationReady: false,
    });
    const saved = await readFile(output);
    assert.equal(JSON.parse(saved.toString('utf8')).results[0].feature, 'image-gen');
    const retry = invoke(directory, args);
    assert.equal(retry.status, 2);
    assert.match(retry.stderr, /does not already exist/);
    assert.deepEqual(await readFile(output), saved);
    const clobber = invoke(directory, [
      '--object-info',
      objectInfo,
      '--system-stats',
      stats,
      '--output',
      objectInfo,
    ]);
    assert.equal(clobber.status, 2);
    assert.deepEqual(await readFile(objectInfo), before);
  });
});

test('blocked metadata produces an actionable report and a distinct failure exit', async () => {
  await fixture(async (directory, objectInfo) => {
    const nodes = JSON.parse(await readFile(objectInfo, 'utf8'));
    delete nodes.UNETLoader.input.required.unet_name;
    await writeFile(objectInfo, JSON.stringify(nodes));
    const result = invoke(directory, ['--feature', 'image-gen', '--object-info', objectInfo]);
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.summary, { checked: 1, passed: 0, blocked: 1 });
    assert.ok(report.results[0].missing.some((message: string) => message.startsWith('Model: ')));
    assert.equal(report.generationReady, false);
    const noStats = invoke(directory, ['--feature', 'character-swap', '--object-info', objectInfo]);
    assert.equal(noStats.status, 1);
    const character = JSON.parse(noStats.stdout).results[0];
    assert.ok(
      character.checks.some(
        (check: { id: string; state: string }) =>
          check.id === 'character-operating-system' && check.state === 'blocked',
      ),
    );
  });
});

test('offline hardware evidence is explicit, profile-bound and cannot be replaced by a ready boolean', async () => {
  await fixture(async (directory, objectInfo, stats, hardware) => {
    const base = ['--feature', 'image-gen', '--object-info', objectInfo, '--system-stats', stats];
    const absent = invoke(directory, base);
    assert.equal(absent.status, 1);
    assert.ok(
      JSON.parse(absent.stdout).results[0].checks.some(
        (check: { id: string; state: string }) =>
          check.id === 'hardware-report' && check.state === 'blocked',
      ),
    );
    await writeFile(hardware, JSON.stringify(hardwareFixture('image-gen')));
    assert.equal(invoke(directory, [...base, '--hardware-info', hardware]).status, 0);
    await writeFile(hardware, JSON.stringify(hardwareFixture('text-video')));
    assert.equal(invoke(directory, [...base, '--hardware-info', hardware]).status, 1);
    await writeFile(hardware, JSON.stringify({ ready: true }));
    assert.equal(invoke(directory, [...base, '--hardware-info', hardware]).status, 1);
  });
});

test('invalid files and arguments fail without echoing private values or paths', async () => {
  await fixture(async (directory, objectInfo) => {
    for (const args of [
      ['--private-api-key'],
      ['--feature', 'private-api-key', '--object-info', objectInfo],
      ['--object-info', path.join(directory, 'missing-private-file.json')],
      ['--object-info', directory],
    ]) {
      const result = invoke(directory, args);
      assert.equal(result.status, 2);
      for (const value of [directory, 'private-api-key', 'missing-private-file.json'])
        assert.equal((result.stdout + result.stderr).includes(value), false);
    }
    await writeFile(objectInfo, '{"private-api-key":');
    const invalid = invoke(directory, ['--object-info', objectInfo]);
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /valid JSON/);
    assert.equal(invalid.stderr.includes('private-api-key'), false);
    const file = await open(objectInfo, 'r+');
    await file.truncate(16 * 1024 * 1024 + 1);
    await file.close();
    const oversized = invoke(directory, ['--object-info', objectInfo]);
    assert.equal(oversized.status, 2);
    assert.match(oversized.stderr, /size limit/);
    assert.equal(oversized.stderr.includes(directory), false);
  });
});
