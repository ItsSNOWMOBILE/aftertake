// --refresh=FILE accepts a reviewed selection, never attribution or arbitrary cases:
// {format:'aftertake-example-refresh/1', reviewed:true,
//  cases:[{slug, renderId, workspace, sourceSha256, frameEditId?, imageGenerationId?}]}
export function applyReviewedRefresh(reviewedCases, refresh) {
  if (refresh === undefined) return reviewedCases.map((item) => ({ ...item }));
  if (
    !refresh ||
    refresh.format !== 'aftertake-example-refresh/1' ||
    refresh.reviewed !== true ||
    !Array.isArray(refresh.cases) ||
    refresh.cases.length === 0 ||
    Object.keys(refresh).some((key) => !['format', 'reviewed', 'cases'].includes(key))
  )
    throw Error('Use a reviewed aftertake-example-refresh/1 manifest with explicit cases.');
  const allowed = new Set([
    'slug',
    'renderId',
    'workspace',
    'sourceSha256',
    'frameEditId',
    'imageGenerationId',
  ]);
  const known = new Set(reviewedCases.map((item) => item.slug));
  const overrides = new Map();
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  for (const item of refresh.cases) {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      Object.keys(item).some((key) => !allowed.has(key)) ||
      !known.has(item.slug) ||
      overrides.has(item.slug) ||
      typeof item.renderId !== 'string' ||
      !uuid.test(item.renderId) ||
      typeof item.workspace !== 'string' ||
      item.workspace.trim() === '' ||
      typeof item.sourceSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.sourceSha256) ||
      ['frameEditId', 'imageGenerationId'].some(
        (key) => key in item && (typeof item[key] !== 'string' || !uuid.test(item[key])),
      )
    )
      throw Error(
        'Refresh cases need unique known slugs, render IDs, workspaces and source hashes; attribution cannot be overridden.',
      );
    overrides.set(item.slug, item);
  }
  return reviewedCases.map((item) => ({ ...item, ...overrides.get(item.slug) }));
}

export function validateRefreshBinding(item, render, previousRecipe) {
  if (render.id !== item.renderId || render.state !== 'succeeded' || !render.output)
    throw Error(`${item.slug} is not the requested completed render`);
  if (
    item.sourceSha256 &&
    (render.recipe?.clip?.sha256 !== item.sourceSha256 ||
      previousRecipe?.clip?.sha256 !== item.sourceSha256)
  )
    throw Error(`${item.slug} refresh source does not match its reviewed source and attribution`);
}
