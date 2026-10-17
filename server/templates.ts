import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, readdir, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { templateNotes, type Template } from '../src/templates.js';
import { clipSchema, recipeSchema, type Clip, type Render } from '../src/domain.js';
import { frameEditRequestSchema } from '../src/frame-edit.js';

export async function templateRouter(root: string, data: string, renders: Map<string, Render>) {
  const folder = path.join(root, 'examples'), router = Router();
  const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8')) as {
    format: string; cases: { slug: string; title: string; renderId: string; source: string; result: string; poster: string; reference?: string; frameRecipe?: string; credit: string; license: string; sourceUrl?: string }[];
    files: { source: string; size: number; sha256: string }[];
  };
  if (manifest.format !== 'aftertake-examples/1') throw Error('Unsupported recipe example manifest.');
  const files = new Map(manifest.files.map(file => [file.source, file]));
  function contained(relative: string) {
    const absolute = path.resolve(folder, relative);
    if (!absolute.startsWith(folder + path.sep)) throw Error('Recipe assets must stay in the example directory.');
    return absolute;
  }
  async function verified(relative: string, sourceHash?: string) {
    // Shared sources have one manifest entry, even when two case folders carry
    // the same bytes. The reviewed render record supplies their content hash.
    const entry = files.get(relative) || manifest.files.find(file => sourceHash && file.sha256 === sourceHash), bytes = await readFile(contained(relative));
    if (!entry || bytes.length !== entry.size || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error(`Recipe asset checksum mismatch: ${relative}`);
    return bytes;
  }
  const templates: Template[] = [], bundled = new Map<string, Render>();
  for (const item of manifest.cases) {
    if (!templateNotes[item.slug]) continue;
    const record = JSON.parse((await verified(`${item.slug}/render.json`)).toString('utf8')) as Render;
    record.recipe = recipeSchema.parse(record.recipe);
    await Promise.all([verified(item.result), verified(item.source, record.recipe.clip.sha256), verified(item.poster)]);
    if (record.recipe.editReference) {
      if (!item.reference) throw Error('The packaged example needs its edited first frame.');
      await verified(item.reference, record.recipe.editReference.sha256);
    }
    if (item.frameRecipe) {
      const creation = JSON.parse((await verified(item.frameRecipe)).toString('utf8'));
      const request = frameEditRequestSchema.parse(creation.request);
      if (creation.output?.sha256 !== record.recipe.editReference?.sha256 || request.clip.sha256 !== record.recipe.clip.sha256 || request.trimStart !== record.recipe.trimStart) throw Error('The packaged appearance recipe does not match this video.');
    }
    bundled.set(item.slug, record);
    templates.push({ ...item, ...templateNotes[item.slug], recipe: record.recipe,
      poster: `/api/templates/${item.slug}/poster`, result: `/api/templates/${item.slug}/result`, source: `/api/templates/${item.slug}/source`,
      reference: item.reference ? `/api/templates/${item.slug}/reference` : undefined,
      frameRecipe: item.frameRecipe ? `/api/templates/${item.slug}/frame-recipe` : undefined });
  }
  const locks = new Set<string>();
  router.get('/', (_req, res) => { res.json(templates); });
  router.get('/:slug/:asset', (req, res) => {
    const item = manifest.cases.find(item => item.slug === req.params.slug);
    const asset = req.params.asset;
    if (!item || !['poster', 'result', 'source', 'reference', 'frame-recipe'].includes(asset)) return void res.sendStatus(404);
    const file = asset === 'frame-recipe' ? item.frameRecipe : item[asset as 'poster' | 'result' | 'source' | 'reference'];
    if (!file) return void res.sendStatus(404);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path.relative(folder, contained(file)), { root: folder, dotfiles: 'deny' });
  });
  router.post('/:slug/open', async (req, res) => {
    const source = bundled.get(req.params.slug), template = templates.find(item => item.slug === req.params.slug);
    if (!source || !template) return void res.sendStatus(404);
    if (locks.has(template.slug)) return void res.status(409).json({ error: 'This example is already being opened.' });
    locks.add(template.slug);
    try {
      const existing = [...renders.values()].find(render => render.origin?.slug === template.slug || render.id === template.renderId);
      if (existing?.state === 'succeeded') {
        const [output, input, reference] = await Promise.all([
          readFile(path.join(data, 'outputs', `${existing.id}.mp4`)).catch(() => null),
          readFile(path.join(data, 'clips', path.basename(existing.recipe.clip.url))).catch(() => null),
          existing.recipe.editReference ? readFile(path.join(data, 'clips', path.basename(existing.recipe.editReference.url))).catch(() => null) : null,
        ]);
        const resultPath = manifest.cases.find(item => item.slug === template.slug)!.result;
        const referenceMatches = !source.recipe.editReference || (reference && createHash('sha256').update(reference).digest('hex') === source.recipe.editReference.sha256);
        if (referenceMatches && output && input && createHash('sha256').update(output).digest('hex') === files.get(resultPath)?.sha256 &&
          createHash('sha256').update(input).digest('hex') === source.recipe.clip.sha256) return void res.json({ render: existing, clip: existing.recipe.clip });
      }
      async function importClip(requested: Clip, asset: string): Promise<Clip> {
        for (const file of await readdir(path.join(data, 'clips'))) {
          if (!file.endsWith('.json')) continue;
          const candidate = clipSchema.parse(JSON.parse(await readFile(path.join(data, 'clips', file), 'utf8')));
          if (candidate.sha256 === requested.sha256) {
            const original = await readFile(path.join(data, 'clips', path.basename(candidate.url))).catch(() => null);
            if (original && createHash('sha256').update(original).digest('hex') === candidate.sha256) return candidate;
          }
        }
        const id = randomUUID(), filename = id + (requested.kind === 'image' ? '.png' : '.mp4');
        const clip = { ...requested, id, url: `/media/${filename}` };
        await writeFile(path.join(data, 'clips', filename), await verified(asset, requested.sha256), { flag: 'wx' });
        await writeFile(path.join(data, 'clips', `${id}.json`), JSON.stringify(clip, null, 2), { flag: 'wx' });
        return clip;
      }
      const item = manifest.cases.find(item => item.slug === template.slug)!;
      const clip = await importClip(source.recipe.clip, item.source);
      const reference = source.recipe.editReference ? await importClip(source.recipe.editReference, item.reference!) : undefined;
      const id = randomUUID(), render: Render = { ...source, id, recipe: { ...source.recipe, clip, editReference: reference ? { ...reference, kind: 'image' } : undefined },
        origin: { kind: 'example', slug: template.slug, renderId: template.renderId },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      for (const [field, file, suffix] of [['output', 'result.mp4', ''], ['rawOutput', 'raw.mp4', '-raw'], ['coarseOutput', 'coarse.mp4', '-coarse'], ['guideOutput', 'guide.mp4', '-guide']] as const) {
        if (!source[field]) continue;
        const filename = `${id}${suffix}.mp4`;
        await writeFile(path.join(data, 'outputs', filename), await verified(`${template.slug}/${file}`), { flag: 'wx' });
        render[field] = `/outputs/${filename}`;
      }
      // Cached thumbnails keep examples usable without Python or a GPU. Their
      // keys use source content, so rebinding a clip ID needs no recomputation.
      for (const entry of manifest.files.filter(file => file.source.startsWith('previews/'))) {
        const target = path.join(data, 'previews', path.basename(entry.source));
        if (await stat(target).catch(() => null)) continue;
        await copyFile(contained(entry.source), target);
      }
      await writeFile(path.join(data, 'renders', `${id}.json`), JSON.stringify(render, null, 2), { flag: 'wx' });
      renders.set(id, render); res.status(201).json({ render, clip });
    } finally { locks.delete(template.slug); }
  });
  return router;
}
