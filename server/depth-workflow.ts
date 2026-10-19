import { depthModel, type DepthEffectRequest } from '../src/depth-effects.js';

export function depthRequirements() {
  return {
    nodes: ['AftertakeLoadClip', 'AftertakeEstimateDepth', 'LoadDA3Model', 'DA3Inference'],
    menus: [['LoadDA3Model', 'model_name', depthModel.filename]] as [string, string, string][],
  };
}
export function buildDepthWorkflow(request: DepthEffectRequest) {
  return {
    '1': {
      class_type: 'AftertakeLoadClip',
      inputs: {
        filename: 'SOURCE.png',
        width: request.clip.width,
        height: request.clip.height,
        frames: 1,
        fps: 1,
        trim_start: 0,
      },
    },
    '2': {
      class_type: 'AftertakeEstimateDepth',
      inputs: { images: ['1', 0], request_json: JSON.stringify(request) },
    },
  };
}
