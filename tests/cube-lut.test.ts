import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_CUBE_BYTES, parseCube } from '../server/cube-lut.js';

const encode = (text: string) => new TextEncoder().encode(text);
// Cube standard: red changes fastest, then green, then blue.
const rows = ['0 0 0', '1 0 0', '0 1 0', '1 1 0', '0 0 1', '1 0 1', '0 1 1', '1 1 1'];
const cube = (header = '', values = rows) =>
  encode(['LUT_3D_SIZE 2', header, ...values].join('\n'));

test('admits an analytic red-fastest cube and retains input-domain metadata', () => {
  assert.deepEqual(parseCube(cube()), {
    title: 'Imported LUT',
    size: 2,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
  });
  assert.deepEqual(parseCube(cube('TITLE "Warm #1"\nDOMAIN_MIN .2 -1 2e-1\nDOMAIN_MAX .8 2 1.2')), {
    title: 'Warm #1',
    size: 2,
    domainMin: [0.2, -1, 0.2],
    domainMax: [0.8, 2, 1.2],
  });
});

test('accepts UTF-8 BOM, CRLF, comments and finite out-of-range output values', () => {
  const content =
    '\uFEFF# original generated fixture\r\nTITLE "" # comment\r\nLUT_3D_SIZE 2\r\n' +
    ['-1 +2 3.4028234663852886e38', ...rows.slice(1)].join('\r\n') +
    '\r\n# end';
  assert.equal(parseCube(encode(content)).title, 'Imported LUT');
  // A .cube stores output values directly; an input domain does not restrict them.
  assert.equal(
    parseCube(cube('DOMAIN_MIN .2 .2 .2\nDOMAIN_MAX .8 .8 .8', ['-.5 1.5 0', ...rows.slice(1)]))
      .size,
    2,
  );
});

test('rejects malformed or unsupported headers, duplicate and late metadata', () => {
  for (const header of [
    'LUT_1D_SIZE 2',
    'LUT_2D_SIZE 2',
    'UNKNOWN_KEY 1',
    'TITLE unquoted',
    'TITLE "' + 'a'.repeat(161) + '"',
    'TITLE "x" trailing',
    'TITLE "a"\nTITLE "b"',
    'LUT_3D_SIZE 2',
    'DOMAIN_MIN 0 0 0\nDOMAIN_MIN 0 0 0',
    'DOMAIN_MAX 1 1 1\nDOMAIN_MAX 1 1 1',
  ])
    assert.throws(() => parseCube(cube(header)), /Invalid 3D/);
  assert.throws(
    () =>
      parseCube(encode(['LUT_3D_SIZE 2', rows[0], 'TITLE "late"', ...rows.slice(1)].join('\n'))),
    /before lattice/,
  );
  assert.throws(() => parseCube(encode(rows.join('\n'))), /declare LUT_3D_SIZE/);
});

test('rejects unsafe dimensions, missing, truncated and extra lattices', () => {
  for (const size of ['0', '1', '65', '2.0', '2e0', '-2', 'Infinity'])
    assert.throws(
      () => parseCube(encode('LUT_3D_SIZE ' + size + '\n' + rows.join('\n'))),
      /Invalid 3D/,
    );
  assert.throws(() => parseCube(cube('', rows.slice(1))), /exactly size cubed/);
  assert.throws(() => parseCube(cube('', [...rows, '0 0 0'])), /extra lattice/);
  assert.throws(() => parseCube(encode('# nothing')), /exactly size cubed/);
});

test('rejects invalid numeric rows and unsupported domains without discarding bad data', () => {
  for (const row of [
    'NaN 0 0',
    'Infinity 0 0',
    '1e999 0 0',
    '3.5e38 0 0',
    '0x1 0 0',
    '1 2',
    '1 2 3 4',
    '0 0 0;',
  ])
    assert.throws(() => parseCube(cube('', [row, ...rows.slice(1)])), /Invalid 3D/);
  for (const header of [
    'DOMAIN_MIN 1 0 0',
    'DOMAIN_MAX 0 1 1',
    'DOMAIN_MIN 2 0 0',
    'DOMAIN_MAX NaN 1 1',
    'DOMAIN_MIN -1e31 0 0',
    'DOMAIN_MAX 1e31 1 1',
    'DOMAIN_MIN 0 0',
    'DOMAIN_MAX 1 1 1 1',
  ])
    assert.throws(() => parseCube(cube(header)), /Invalid 3D/);
});

test('rejects invalid UTF-8, empty and oversized inputs', () => {
  assert.throws(() => parseCube(new Uint8Array()), /nonempty/);
  assert.throws(() => parseCube(new Uint8Array([0xc3, 0x28])), /valid UTF-8/);
  assert.throws(() => parseCube(new Uint8Array(MAX_CUBE_BYTES + 1)), /16 MiB/);
});
