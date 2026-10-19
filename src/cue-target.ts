import {
  displayDimensions,
  finalCompositeCue,
  renderDimensions,
  supportsCompositeRegion,
  type Cue,
  type Recipe,
} from './domain';

export type PaintTarget = 'generation' | 'composite';

export const canSeparateComposite = supportsCompositeRegion;

export function cuePreviewSettings(recipe: Recipe, target: PaintTarget) {
  const dimensions = renderDimensions(recipe);
  const final = target === 'composite' && canSeparateComposite(recipe) && recipe.compositeRegion;
  return {
    ...dimensions,
    ...(final ? displayDimensions(recipe) : {}),
    clip: recipe.clip,
    cue: paintedCue(recipe, target),
    trimStart: recipe.trimStart,
  };
}

export function paintedCue(recipe: Recipe, target: PaintTarget): Cue {
  return target === 'composite' && canSeparateComposite(recipe) && recipe.compositeRegion
    ? finalCompositeCue(recipe)
    : recipe.cue;
}

/** Final paint owns spatial fields only; timing always belongs to the shared cue. */
export function replacePaintedCue(recipe: Recipe, target: PaintTarget, cue: Cue): Recipe {
  if (target !== 'composite' || !canSeparateComposite(recipe) || !recipe.compositeRegion)
    return { ...recipe, cue };
  const { feather, strokes, tracking, anchor } = cue;
  return { ...recipe, compositeRegion: { feather, strokes, tracking, anchor } };
}

export function separateComposite(recipe: Recipe, enabled: boolean): Recipe {
  if (!enabled || !canSeparateComposite(recipe)) {
    const { compositeRegion: _region, ...rest } = recipe;
    return rest;
  }
  if (recipe.compositeRegion) return recipe;
  const { feather, strokes, tracking, anchor } = structuredClone(recipe.cue);
  return { ...recipe, compositeRegion: { feather, strokes, tracking, anchor } };
}
