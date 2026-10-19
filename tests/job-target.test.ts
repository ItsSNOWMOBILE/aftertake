import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertJobTarget,
  canonicalNativeBaseUrl,
  createJobTarget,
  jobTargetIssue,
} from '../server/job-target.js';

const local = () =>
  createJobTarget({
    sdkBaseUrl: 'http://127.0.0.1:8189',
    uiBaseUrl: 'http://127.0.0.1:8188',
    allowLegacyLoopback: true,
  });

test('job identity binds both canonical engine endpoints without retaining addresses or credentials', () => {
  const first = createJobTarget({
    sdkBaseUrl: 'HTTP://LOCALHOST:80/proxy///',
    uiBaseUrl: 'http://[::1]:8188/',
  });
  const same = createJobTarget({
    sdkBaseUrl: 'http://localhost/proxy',
    uiBaseUrl: 'http://[::1]:8188',
  });
  assert.deepEqual(first.binding, same.binding);
  assert.equal(canonicalNativeBaseUrl(' HTTP://LOCALHOST:80/proxy/// '), 'http://localhost/proxy');
  assert.deepEqual(Object.keys(first.binding).sort(), ['fingerprint', 'format', 'kind']);
  assert.match(first.binding.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(first.binding.format, 'aftertake-job-target/1');
  assert.equal(first.binding.kind, 'startup-engine');
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.binding), true);
  assert.doesNotMatch(JSON.stringify(first.binding), /localhost|127\.0\.0\.1|8188|proxy|https?:/);
  for (const change of [
    { sdkBaseUrl: 'http://localhost:81/proxy', uiBaseUrl: 'http://[::1]:8188' },
    { sdkBaseUrl: 'http://localhost/another', uiBaseUrl: 'http://[::1]:8188' },
    { sdkBaseUrl: 'http://localhost/proxy', uiBaseUrl: 'http://[::1]:8187' },
    { sdkBaseUrl: 'https://localhost/proxy', uiBaseUrl: 'http://[::1]:8188' },
  ]) {
    assert.notEqual(createJobTarget(change).binding.fingerprint, first.binding.fingerprint);
  }
});

test('present malformed identities fail closed while missing legacy identity is restricted to loopback', () => {
  const target = local();
  assert.equal(jobTargetIssue({ jobTarget: target.binding }, target), undefined);
  assert.equal(jobTargetIssue({}, target), undefined);
  assert.doesNotThrow(() => assertJobTarget({}, target));
  const another = createJobTarget({
    sdkBaseUrl: 'http://127.0.0.1:9199',
    uiBaseUrl: 'http://127.0.0.1:8188',
  });
  for (const record of [
    { jobTarget: another.binding },
    { jobTarget: undefined },
    { jobTarget: null },
    { jobTarget: {} },
    { jobTarget: { ...target.binding, format: 'aftertake-job-target/2' } },
    { jobTarget: { ...target.binding, kind: 'comfy-cloud' } },
    { jobTarget: { ...target.binding, fingerprint: 'not-a-digest' } },
    { jobTarget: { ...target.binding, fingerprint: 'A'.repeat(64) } },
  ]) {
    assert.equal(typeof jobTargetIssue(record, target), 'string');
    assert.throws(() => assertJobTarget(record, target));
  }
  for (const urls of [
    { sdkBaseUrl: 'https://worker.run.comfy.app', uiBaseUrl: 'http://127.0.0.1:8188' },
    { sdkBaseUrl: 'http://127.0.0.1:8189', uiBaseUrl: 'https://worker.example' },
  ]) {
    const remote = createJobTarget({ ...urls, allowLegacyLoopback: true });
    assert.equal(remote.legacyLoopbackAllowed, false);
    assert.equal(typeof jobTargetIssue({}, remote), 'string');
    assert.throws(() => assertJobTarget({}, remote));
    assert.doesNotThrow(() => assertJobTarget({ jobTarget: remote.binding }, remote));
  }
  assert.equal(
    typeof jobTargetIssue(
      {},
      createJobTarget({
        sdkBaseUrl: 'http://127.0.0.1:8189',
        uiBaseUrl: 'http://127.0.0.1:8188',
        allowLegacyLoopback: false,
      }),
    ),
    'string',
  );
});

test('invalid endpoint configuration never echoes secrets or makes a network request', () => {
  const invalid = [
    'https://person:secret-token@example.test',
    'https://example.test?token=secret-token',
    'https://example.test?',
    'https://example.test#secret-token',
    'file:///secret-token',
    'secret-token',
  ];
  for (const value of invalid) {
    for (const field of ['sdkBaseUrl', 'uiBaseUrl'] as const) {
      assert.throws(
        () =>
          createJobTarget({
            sdkBaseUrl: 'http://127.0.0.1:8189',
            uiBaseUrl: 'http://127.0.0.1:8188',
            [field]: value,
          }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.doesNotMatch(error.message, /secret-token|person|example\.test/);
          return true;
        },
      );
    }
  }
});
