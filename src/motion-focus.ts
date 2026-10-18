import { renderDimensions, type Recipe } from './domain';

export type MotionFocus = NonNullable<Recipe['transfer']>['focus'];

/** Whole-frame coordinates remain stable when the model works on one performer. */
export function motionFocusGeometry(recipe: Recipe) {
  const focus = recipe.transfer?.focus;
  if (!focus) return null;
  const d = renderDimensions(recipe);
  const x = Math.floor(focus.x * d.width),
    y = Math.floor(focus.y * d.height);
  const right = Math.min(d.width, Math.ceil((focus.x + focus.width) * d.width)),
    bottom = Math.min(d.height, Math.ceil((focus.y + focus.height) * d.height));
  const ratio = (focus.width * recipe.clip.width) / (focus.height * recipe.clip.height),
    long = recipe.quality === 'final' ? 768 : 512;
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    targetWidth: Math.max(64, Math.round((ratio >= 1 ? long : long * ratio) / 32) * 32),
    targetHeight: Math.max(64, Math.round((ratio >= 1 ? long / ratio : long) / 32) * 32),
  };
}

export function focusFromPaint(recipe: Recipe): NonNullable<MotionFocus> {
  const points = recipe.cue.strokes
    .filter((stroke) => stroke.mode !== 'erase')
    .flatMap((stroke) => stroke.points.map((point) => ({ point, radius: stroke.radius })));
  if (!points.length) return { x: 0, y: 0, width: 1, height: 1 };
  const d = renderDimensions(recipe),
    scale = Math.min(d.width, d.height);
  const bounds = (axis: 'x' | 'y', size: number) => {
    const paintLow = Math.min(
      ...points.map(({ point, radius }) => point[axis] - (radius * scale) / size),
    );
    const paintHigh = Math.max(
      ...points.map(({ point, radius }) => point[axis] + (radius * scale) / size),
    );
    const context = Math.max(2 / size, (paintHigh - paintLow) * 0.1);
    const low = Math.max(0, paintLow - context),
      high = Math.min(1, paintHigh + context);
    const start = Math.min(0.95, Math.max(0, Math.min(low, high - 0.05)));
    return { start, end: Math.max(start + 0.05, high) };
  };
  const x = bounds('x', d.width),
    y = bounds('y', d.height);
  return { x: x.start, y: y.start, width: x.end - x.start, height: y.end - y.start };
}
