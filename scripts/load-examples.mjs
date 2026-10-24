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
 * Visitors change some recorded examples by using them: a one-tap effect gains a
 * cut when someone switches its watermark, and a set of takes gains the take
 * someone kept. The same record, newer, is kept rather than refused.
 */
export function visitorCopy(target, existing, recorded) {
  const kind = /^(one-tap|take-sets)\/[a-f0-9-]{36}\.json$/.exec(target)?.[1];
  if (!kind) return false;
  try {
    const mine = JSON.parse(existing.toString('utf8')),
      theirs = JSON.parse(recorded.toString('utf8'));
    if (mine.id !== theirs.id || mine.createdAt !== theirs.createdAt || mine.state !== 'ready')
      return false;
    if (kind === 'one-tap')
      return mine.exports?.watermark?.filmId === theirs.exports?.watermark?.filmId;
    const takes = (set) => JSON.stringify(set.takes?.map((take) => take.id));
    return takes(mine) === takes(theirs) && mine.takes.some((take) => take.id === mine.kept);
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
