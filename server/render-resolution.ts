import { displayDimensions, renderDimensions, type Cue, type Recipe } from '../src/domain.js';

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

/** Keep the visible 720p canvas intact while satisfying each model's latent grid. */
export function applyRenderResolution(graph: Graph, recipe: Recipe): Graph {
  if (recipe.resolution !== '720p') return graph;
  const display = displayDimensions(recipe);
  const model = renderDimensions(recipe);
  const left = (model.width - display.width) / 2;
  const top = (model.height - display.height) / 2;
  const replaceLinks = (from: string, to: string) => {
    for (const [id, node] of Object.entries(graph)) {
      if (id === to) continue;
      for (const [key, value] of Object.entries(node.inputs))
        if (Array.isArray(value) && value[0] === from && value[1] === 0) node.inputs[key] = [to, 0];
    }
  };
  const pad = (id: string) => {
    if (!graph[id]) return;
    graph[id].inputs.width = display.width;
    graph[id].inputs.height = display.height;
    const padded = `hd_pad_${id}`;
    replaceLinks(id, padded);
    graph[padded] = {
      class_type: 'ImagePadForOutpaint',
      inputs: { image: [id, 0], left, top, right: left, bottom: top, feathering: 0 },
    };
  };
  pad('8');
  if (recipe.pipeline === 'cinema' && recipe.endFrame) pad('45');
  if (recipe.pipeline === 'inpaint' && recipe.editReference) {
    pad('47');
    // The coarse source plate is derived from its padded full-size image.
    // Give the edited reference the identical transform instead of squeezing
    // its unpadded visible frame directly onto the coarse latent grid.
    replaceLinks('45', 'hd_reference_coarse');
    graph.hd_reference_coarse = {
      class_type: 'ImageScale',
      inputs: {
        image: ['hd_pad_47', 0],
        width: graph['45'].inputs.width,
        height: graph['45'].inputs.height,
        upscale_method: 'lanczos',
        crop: 'disabled',
      },
    };
  }
  if (recipe.pipeline === 'motion-transfer') {
    // Focused workflows crop node 46 from the complete appearance at 53.
    // Padding the crop would overwrite its bounds and change Wan's target size.
    pad(graph['46']?.class_type === 'AftertakeCropRegion' ? '53' : '46');
    if (recipe.transfer?.finish) pad('49');
  }

  // Painted coordinates describe the visible source, not the temporary model padding.
  if (graph['9']?.class_type === 'AftertakeCueMask') {
    const cue = JSON.parse(String(graph['9'].inputs.cue_json)) as Cue;
    const scale = Math.min(display.width, display.height) / Math.min(model.width, model.height);
    cue.feather *= scale;
    cue.strokes = cue.strokes.map((stroke) => ({
      ...stroke,
      radius: stroke.radius * scale,
      points: stroke.points.map((point) => ({
        x: (point.x * display.width + left) / model.width,
        y: (point.y * display.height + top) / model.height,
      })),
    }));
    graph['9'].inputs.cue_json = JSON.stringify(cue);
  }
  const crop = (id: string, images: unknown) => {
    graph[id] = {
      class_type: 'ImageCrop',
      inputs: { image: images, width: display.width, height: display.height, x: left, y: top },
    };
    return [id, 0];
  };
  if (recipe.compositeRegion && graph['20']?.class_type === 'AftertakeComposite')
    graph['20'].inputs.generated = crop('hd_composite_crop', graph['20'].inputs.generated);
  // Raw generations keep their native padded grid for exact replay/finishing.
  for (const id of ['21', '44']) {
    if (!graph[id] || (id === '21' && recipe.compositeRegion)) continue;
    graph[id].inputs.images = crop(`hd_crop_${id}`, graph[id].inputs.images);
  }
  return graph;
}
