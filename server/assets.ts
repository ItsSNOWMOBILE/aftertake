import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { clipSchema, recipeSchema, type Clip, type Recipe } from '../src/domain.js';

export class RecipeAssetError extends Error {}

export async function resolveClipAsset(requested: Clip, folder: string, label: string): Promise<Clip> {
  const raw = await readFile(path.join(folder, `${requested.id}.json`), 'utf8').catch(() => null);
  if (!raw) throw new RecipeAssetError(`Import the original ${label} before rendering this recipe.`);
  const stored = clipSchema.parse(JSON.parse(raw));
  if (stored.sha256 !== requested.sha256) throw new RecipeAssetError(`The ${label} does not match this recipe's content hash.`);
  const bytes = await readFile(path.join(folder, path.basename(stored.url))).catch(() => null);
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== stored.sha256)
    throw new RecipeAssetError(`The ${label} changed or is missing. Import its original file again.`);
  return stored;
}

export async function resolveRecipeAssets(recipe: Recipe, folder: string): Promise<Recipe> {
  const clip = await resolveClipAsset(recipe.clip, folder, 'source');
  let editReference = recipe.editReference;
  if (recipe.pipeline === 'inpaint' && editReference) {
    const reference = await resolveClipAsset(editReference, folder, 'edited first frame');
    if (reference.kind !== 'image') throw new RecipeAssetError('The edited first frame must be a still image.');
    editReference = { ...reference, kind: 'image' };
  }
  let endFrame = recipe.endFrame;
  if (recipe.pipeline === 'cinema' && endFrame) {
    const ending = await resolveClipAsset(endFrame, folder, 'ending frame');
    if (ending.kind !== 'image') throw new RecipeAssetError('The ending frame must be a still image.');
    endFrame = { ...ending, kind: 'image' };
  }
  return recipeSchema.parse({ ...recipe, clip, editReference, endFrame });
}
