// Thin client for the running Aftertake studio's Film API.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
export const BASE = process.env.AFTERTAKE_URL || 'http://127.0.0.1:4312';
export async function api(route, body, key) {
  const response = await fetch(BASE + route, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw Error(`${route}: ${JSON.stringify(value).slice(0, 2000)}`);
  return value;
}
let library;
/** Import a local file once; reuse the existing asset when its content hash matches. */
export async function asset(file, name = path.basename(file)) {
  const bytes = await readFile(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  library ??= await api('/api/films/assets');
  const existing = library.find((item) => item.sha256 === sha256);
  if (existing) return existing;
  const response = await fetch(`${BASE}/api/films/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes,
  });
  const value = await response.json();
  if (!response.ok) throw Error(`import ${file}: ${value.error}`);
  library.push(value);
  return value;
}
/** Export a film draft through the native renderer and wait for the MP4. */
export async function render(draft, key, output) {
  let film = await api('/api/films', draft, key);
  const started = Date.now();
  while (film.state === 'assembling') {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    film = (await api('/api/films')).find((item) => item.id === film.id);
  }
  if (film.state !== 'ready') throw Error(`${draft.name}: ${film.error}`);
  const video = Buffer.from(await (await fetch(BASE + film.output)).arrayBuffer());
  await writeFile(output, video);
  const manifest = await (await fetch(`${BASE}/api/films/${film.id}/manifest`)).json();
  await writeFile(output.replace(/\.mp4$/, '.project.json'), JSON.stringify(manifest, null, 2));
  console.log(`${draft.name}: ${((Date.now() - started) / 1000).toFixed(0)}s → ${output}`);
  return film;
}
