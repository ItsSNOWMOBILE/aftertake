/** Strict metadata admission for a display-referred, red-fastest 3D .cube asset. */
export const MAX_CUBE_BYTES = 16 * 1024 * 1024;
const FLOAT32_MAX = 3.4028234663852886e38;
const DOMAIN_LIMIT = 1e30;
const decimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
export type CubeMetadata = {
  title: string;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
};

function fail(reason: string): never {
  throw Error('Invalid 3D .cube LUT: ' + reason);
}
function numbers(tokens: string[], limit: number): [number, number, number] {
  if (tokens.length !== 3) fail('each color or domain row needs exactly three numbers.');
  const values = tokens.map((token) => {
    if (!decimal.test(token)) fail('use finite decimal or scientific numbers.');
    const value = Number(token);
    if (!Number.isFinite(value) || Math.abs(value) > limit)
      fail('a numeric value exceeds the supported range.');
    return value;
  });
  return values as [number, number, number];
}
function uncomment(line: string) {
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '"') quoted = !quoted;
    else if (line[index] === '#' && !quoted) return line.slice(0, index).trim();
  }
  return line.trim();
}

/**
 * Validates every lattice value without retaining a second copy of the lattice.
 * DOMAIN_MIN/MAX describe the INPUT range; output entries are not normalized.
 * The worker independently reads the hash-bound original bytes for execution.
 */
export function parseCube(bytes: Uint8Array): CubeMetadata {
  if (!bytes.byteLength || bytes.byteLength > MAX_CUBE_BYTES)
    fail('choose a nonempty file up to 16 MiB.');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    fail('the file must contain valid UTF-8 text.');
  }
  let size = 0;
  let title = 'Imported LUT';
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const headers = new Set<string>();
  let rows = 0;
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const line = uncomment(raw);
    if (!line) continue;
    const tokens = line.split(/\s+/);
    const keyword = tokens[0];
    if (['TITLE', 'LUT_3D_SIZE', 'DOMAIN_MIN', 'DOMAIN_MAX'].includes(keyword)) {
      if (rows) fail('headers must appear before lattice data.');
      if (headers.has(keyword)) fail('headers must not be repeated.');
      headers.add(keyword);
      if (keyword === 'TITLE') {
        const match = /^TITLE\s+"([^"\r\n]*)"$/.exec(line);
        if (!match || match[1].length > 160 || /[\u0000-\u001f\u007f]/.test(match[1]))
          fail('TITLE must be a quoted label up to 160 characters.');
        title = match[1].trim() || 'Imported LUT';
      } else if (keyword === 'LUT_3D_SIZE') {
        if (tokens.length !== 2 || !/^\d+$/.test(tokens[1]))
          fail('LUT_3D_SIZE must be an integer from 2 to 64.');
        size = Number(tokens[1]);
        if (size < 2 || size > 64) fail('LUT_3D_SIZE must be an integer from 2 to 64.');
      } else if (keyword === 'DOMAIN_MIN') domainMin = numbers(tokens.slice(1), DOMAIN_LIMIT);
      else domainMax = numbers(tokens.slice(1), DOMAIN_LIMIT);
    } else {
      if (!decimal.test(keyword))
        fail('only TITLE, 3D size, input domains and RGB rows are supported.');
      if (!size) fail('declare LUT_3D_SIZE before lattice data.');
      numbers(tokens, FLOAT32_MAX);
      if (++rows > size ** 3) fail('the file contains extra lattice data.');
    }
  }
  if (!size || rows !== size ** 3) fail('the lattice must contain exactly size cubed RGB rows.');
  for (let channel = 0; channel < 3; channel++) {
    const span = domainMax[channel] - domainMin[channel];
    if (!Number.isFinite(span) || span <= 0)
      fail('every input domain must have a positive finite span.');
  }
  return { title, size, domainMin, domainMax };
}
