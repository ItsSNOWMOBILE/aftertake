import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examples = path.join(root, 'examples');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function within(base, relative) {
  const resolved = path.resolve(base, relative);
  if (!resolved.startsWith(base + path.sep))
    throw new Error('Example path must stay inside its directory');
  return resolved;
}
/**
 * A recorded one-tap effect gains cuts when someone switches its watermark, which
 * rewrites its record. The same effect, newer, is kept rather than refused.
 */
export function visitorCopy(target, existing, recorded) {
  if (!/^one-tap\/[a-f0-9-]{36}\.json$/.test(target)) return false;
  try {
    const mine = JSON.parse(existing.toString('utf8')),
      theirs = JSON.parse(recorded.toString('utf8'));
    return (
      mine.id === theirs.id &&
      mine.createdAt === theirs.createdAt &&
      mine.state === 'ready' &&
      mine.exports?.watermark?.filmId === theirs.exports?.watermark?.filmId
    );
  } catch {
    return false;
  }
}
export async function loadExamples(directory = '.data-demo') {
  const data = path.resolve(root, directory);
  const manifest = JSON.parse(await readFile(path.join(examples, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'aftertake-examples/1') throw new Error('Unsupported example manifest');
  for (const file of manifest.files) {
    const source = within(examples, file.source),
      target = within(data, file.target);
    const bytes = await readFile(source);
    if (bytes.length !== file.size || hash(bytes) !== file.sha256)
      throw new Error(`Example checksum mismatch: ${file.source}`);
    if (await stat(target).catch(() => null)) {
      const existing = await readFile(target);
      let sameJson = false;
      if (target.endsWith('.json')) {
        try {
          sameJson = isDeepStrictEqual(
            JSON.parse(existing.toString('utf8')),
            JSON.parse(bytes.toString('utf8')),
          );
        } catch {}
      }
      if (hash(existing) !== file.sha256 && !sameJson && !visitorCopy(file.target, existing, bytes))
        throw new Error(`Preserving an existing different file: ${target}`);
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
  }
  return { data, manifest };
}
