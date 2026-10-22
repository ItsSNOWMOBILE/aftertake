import type { CloudFeature } from '../src/compute.js';
import {
  enhanceFps,
  enhanceOutput,
  enhanceSourceFrames,
  type EnhanceRequest,
} from '../src/enhance.js';
import type { VideoRequest } from '../src/video-generation.js';
import { buildEnhanceWorkflow, enhanceModels, enhanceRequirements } from './enhance-workflow.js';
import { buildImageWorkflow, imageRequirements } from './image-workflow.js';
import { buildVideoWorkflow, videoAudioModel } from './video-workflow.js';
import { inpaintModelFiles } from './ltx-models.js';

/**
 * Comfy Cloud runs only its own nodes, so Aftertake's loader, grade and saver
 * stay on this computer: the studio uploads a source already decoded to the
 * job's frame clock, Cloud saves frames as WebM and sound as FLAC, and
 * scripts/cloud-media.py grades, muxes and writes the same MP4 the local saver
 * would. Images and songs use the local graphs unchanged.
 */
export const cloudModels = {
  // Cloud ships the full distilled transformer instead of the local GGUF quant.
  videoDiffusion: 'ltx-2.5-22b-distilled-transformer-bf16.safetensors',
} as const;
/** VP9 at this quality is visually lossless before the local H.264 encode. */
const webm = { codec: 'vp9', crf: 12 };

type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const node = (class_type: string, inputs: Record<string, unknown>) => ({ class_type, inputs });

export function cloudRequirements(feature: CloudFeature) {
  if (feature === 'image-gen') return imageRequirements();
  if (feature === 'song') return enhanceRequirements('song');
  const loading = ['LoadVideo', 'GetVideoComponents'],
    saving = ['SaveWEBM'];
  if (feature === 'text-video')
    return {
      nodes: [
        'UNETLoader',
        'CLIPLoader',
        'VAELoader',
        'CLIPTextEncode',
        'ConditioningZeroOut',
        'LTXVConditioning',
        'EmptyLTXVLatentVideo',
        'LTXVEmptyLatentAudio',
        'LTXVConcatAVLatent',
        'LTXVDualCFGGuider',
        'RandomNoise',
        'KSamplerSelect',
        'ManualSigmas',
        'SamplerCustomAdvanced',
        'LTXVSeparateAVLatent',
        'VAEDecode',
        'LTXVAudioVAEDecode',
        'ImageCrop',
        'SaveAudio',
        ...saving,
      ],
      menus: [
        ['UNETLoader', 'unet_name', cloudModels.videoDiffusion],
        ['CLIPLoader', 'clip_name', inpaintModelFiles.encoder],
        ['VAELoader', 'vae_name', inpaintModelFiles.vae],
        ['VAELoader', 'vae_name', videoAudioModel],
      ] as [string, string, string][],
    };
  const local = enhanceRequirements(feature);
  return {
    nodes: [...loading, ...local.nodes.filter((name) => !name.startsWith('Aftertake')), ...saving],
    menus: local.menus,
  };
}

/** Output node ids of the cloud graphs. */
export const cloudOutputs = { frames: '90', sound: '91' } as const;

/**
 * Upscale and interpolate: the local graph between its loader and saver, fed by
 * the uploaded source (already the job's frames at 24 fps and its own size).
 */
export function buildCloudEnhanceWorkflow(id: string, request: EnhanceRequest): Graph {
  const local = buildEnhanceWorkflow(id, request) as Graph,
    saverId = request.operation === 'interpolate' ? '4' : '13',
    graph: Graph = {
      '1': node('LoadVideo', { file: 'SOURCE.mp4' }),
      '80': node('GetVideoComponents', { video: ['1', 0] }),
    };
  for (const [key, value] of Object.entries(local)) {
    if (key === '1' || key === saverId) continue;
    graph[key] = {
      class_type: value.class_type,
      inputs: Object.fromEntries(
        Object.entries(value.inputs).map(([name, input]) => [
          name,
          Array.isArray(input) && input[0] === '1' ? ['80', 0] : input,
        ]),
      ),
    };
  }
  graph[cloudOutputs.frames] = node('SaveWEBM', {
    images: local[saverId].inputs.images,
    filename_prefix: `aftertake/enhance/${id}/${request.operation}`,
    fps: enhanceOutput(request).fps,
    ...webm,
  });
  return graph;
}

/** What the prepared source must hold for the uploaded graph above. */
export function cloudEnhanceSource(request: EnhanceRequest) {
  return {
    width: request.clip.width,
    height: request.clip.height,
    frames: enhanceSourceFrames(request.clip),
    fps: enhanceFps,
    trim_start: 0,
  };
}

/**
 * Text to video: the local LTX-2.5 graph with Cloud's transformer file. The
 * palette grade runs locally afterwards; sound is saved as its own FLAC.
 */
export function buildCloudVideoWorkflow(request: VideoRequest): Graph {
  const local = buildVideoWorkflow(request) as Graph,
    graph: Graph = {};
  for (const [key, value] of Object.entries(local)) {
    if (key === '20' || key === '21') continue;
    graph[key] = structuredClone(value);
  }
  graph['1'] = node('UNETLoader', {
    unet_name: cloudModels.videoDiffusion,
    weight_dtype: 'default',
  });
  graph[cloudOutputs.frames] = node('SaveWEBM', {
    images: local['20'].inputs.images,
    filename_prefix: 'aftertake/text-video',
    fps: local['21'].inputs.fps,
    ...webm,
  });
  if (request.sound)
    graph[cloudOutputs.sound] = node('SaveAudio', {
      audio: ['22', 0],
      filename_prefix: 'aftertake/text-video-sound',
    });
  return graph;
}

/** The graph a cloud job runs for an image: the local one. */
export const buildCloudImageWorkflow = buildImageWorkflow;
export { enhanceModels };
