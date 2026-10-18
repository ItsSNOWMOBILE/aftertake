import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { clipSchema, motionGenerationKey, renderDimensions, recipeSchema, type Clip, type Recipe } from '../src/domain.js';
import { inspectVideoMetadata } from './video-metadata.js';

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
  let transfer = recipe.transfer;
  if (recipe.pipeline === 'motion-transfer' && transfer?.reference) {
    const appearance = await resolveClipAsset(transfer.reference, folder, 'appearance image');
    if (appearance.kind !== 'image') throw new RecipeAssetError('The appearance reference must be a still image.');
    transfer = { ...transfer, reference: { ...appearance, kind: 'image' } };
    if(transfer.finish){
      const generation=await resolveClipAsset(transfer.finish.generation,folder,'saved raw generation');
      const matte=await resolveClipAsset(transfer.finish.matte,folder,'tracked matte');
      const metadata=inspectVideoMetadata(await readFile(path.join(folder,path.basename(generation.url))));
      const resolved={...recipe,clip,transfer};
      if(metadata.recipe.pipeline!=='motion-transfer' || motionGenerationKey(metadata.recipe)!==motionGenerationKey(resolved))
        throw new RecipeAssetError('The saved generation belongs to different source, appearance or generation settings.');
      const d=renderDimensions(resolved);
      if(generation.kind==='image' || matte.kind==='image' || generation.width!==d.width || generation.height!==d.height
        || generation.duration+1/d.fps<d.duration || matte.duration+1/d.fps<d.duration
        || Math.abs(Math.log((matte.width/matte.height)/(clip.width/clip.height)))>.06)
        throw new RecipeAssetError('Use a complete raw generation and a matching full-length video matte.');
      transfer={...transfer,finish:{...transfer.finish,generation,matte}};
    }
  }
  return recipeSchema.parse({ ...recipe, clip, editReference, endFrame, transfer });
}
