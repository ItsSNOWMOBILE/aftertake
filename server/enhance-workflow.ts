import {
  enhanceFps,
  enhanceOutput,
  enhanceSourceFrames,
  type EnhanceRequest,
  type SongRequest,
} from '../src/enhance.js';

/** Model files from the pinned manifests; ComfyUI 0.41 ships every node used here. */
export const enhanceModels = {
  interpolation: 'rife_v4.26.safetensors',
  upscale: 'seedvr2_3b_int8_convrot.safetensors',
  upscaleVae: 'seedvr2_ema_vae_fp16.safetensors',
  song: 'ace_step_1.5_turbo_aio.safetensors',
} as const;
export type EnhanceFeature = 'upscale' | 'interpolate' | 'song';

export function enhanceRequirements(feature: EnhanceFeature) {
  if (feature === 'interpolate')
    return {
      nodes: [
        'AftertakeLoadClip',
        'FrameInterpolationModelLoader',
        'FrameInterpolate',
        'AftertakeSaveVideo',
      ],
      menus: [['FrameInterpolationModelLoader', 'model_name', enhanceModels.interpolation]] as [
        string,
        string,
        string,
      ][],
    };
  if (feature === 'upscale')
    return {
      nodes: [
        'AftertakeLoadClip',
        'ImageScaleBy',
        'SeedVR2Preprocess',
        'VAELoader',
        'VAEEncodeTiled',
        'SeedVR2TemporalChunk',
        'UNETLoader',
        'SeedVR2Conditioning',
        'KSampler',
        'SeedVR2TemporalMerge',
        'VAEDecodeTiled',
        'SeedVR2PostProcessing',
        'AftertakeSaveVideo',
      ],
      menus: [
        ['UNETLoader', 'unet_name', enhanceModels.upscale],
        ['VAELoader', 'vae_name', enhanceModels.upscaleVae],
      ] as [string, string, string][],
    };
  return {
    nodes: [
      'CheckpointLoaderSimple',
      'ModelSamplingAuraFlow',
      'TextEncodeAceStepAudio1.5',
      'ConditioningZeroOut',
      'EmptyAceStep1.5LatentAudio',
      'KSampler',
      'VAEDecodeAudio',
      'SaveAudioAdvanced',
    ],
    menus: [['CheckpointLoaderSimple', 'ckpt_name', enhanceModels.song]] as [
      string,
      string,
      string,
    ][],
  };
}

const node = (class_type: string, inputs: Record<string, unknown>) => ({ class_type, inputs });

/** The source clip at its own size on the 24 fps clock, with its sound path for the saver. */
function source(request: EnhanceRequest) {
  return node('AftertakeLoadClip', {
    filename: 'SOURCE.mp4',
    width: request.clip.width,
    height: request.clip.height,
    frames: enhanceSourceFrames(request.clip),
    fps: enhanceFps,
    trim_start: 0,
  });
}
function save(id: string, request: EnhanceRequest, images: [string, number]) {
  const output = enhanceOutput(request);
  return node('AftertakeSaveVideo', {
    images,
    fps: output.fps,
    filename_prefix: `aftertake/enhance/${id}/${request.operation}`,
    recipe_json: JSON.stringify({ format: 'aftertake-enhance-output/1', request }),
    source_audio: output.sound ? ['1', 1] : '',
    audio_start: 0,
  });
}

/** API-format graphs following Comfy's own templates for these nodes. */
export function buildEnhanceWorkflow(id: string, request: EnhanceRequest | SongRequest) {
  if (request.format === 'aftertake-song/1')
    return {
      '1': node('CheckpointLoaderSimple', { ckpt_name: enhanceModels.song }),
      '2': node('ModelSamplingAuraFlow', { model: ['1', 0], shift: 3 }),
      '3': node('TextEncodeAceStepAudio1.5', {
        clip: ['1', 1],
        tags: request.tags,
        lyrics: request.lyrics || '[Instrumental]',
        seed: request.seed,
        bpm: request.bpm,
        duration: request.seconds,
        timesignature: request.timesignature,
        language: request.language,
        keyscale: request.keyscale,
        generate_audio_codes: true,
        cfg_scale: 2,
        temperature: 0.85,
        top_p: 0.9,
        top_k: 0,
        min_p: 0,
      }),
      '4': node('ConditioningZeroOut', { conditioning: ['3', 0] }),
      '5': node('EmptyAceStep1.5LatentAudio', { seconds: request.seconds, batch_size: 1 }),
      '6': node('KSampler', {
        model: ['2', 0],
        seed: request.seed,
        steps: 8,
        cfg: 1,
        sampler_name: 'euler',
        scheduler: 'simple',
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        denoise: 1,
      }),
      '7': node('VAEDecodeAudio', { samples: ['6', 0], vae: ['1', 2] }),
      '8': node('SaveAudioAdvanced', {
        audio: ['7', 0],
        filename_prefix: `aftertake/songs/${id}`,
        format: 'flac',
      }),
    };
  if (request.operation === 'interpolate')
    return {
      '1': source(request),
      '2': node('FrameInterpolationModelLoader', { model_name: enhanceModels.interpolation }),
      '3': node('FrameInterpolate', {
        interp_model: ['2', 0],
        images: ['1', 0],
        multiplier: request.multiplier,
      }),
      '4': save(id, request, ['3', 0]),
    };
  const tiles = { tile_size: 512, overlap: 128, temporal_size: 64, temporal_overlap: 8 };
  return {
    '1': source(request),
    '2': node('ImageScaleBy', { image: ['1', 0], upscale_method: 'lanczos', scale_by: 2 }),
    '3': node('SeedVR2Preprocess', { resized_images: ['2', 0] }),
    '4': node('VAELoader', { vae_name: enhanceModels.upscaleVae }),
    '5': node('VAEEncodeTiled', { pixels: ['3', 0], vae: ['4', 0], ...tiles }),
    // Auto chunking picks the longest stretch of frames that fits the free VRAM.
    '6': node('SeedVR2TemporalChunk', {
      latent: ['5', 0],
      temporal_overlap: 0,
      chunking_mode: 'auto',
    }),
    '7': node('UNETLoader', { unet_name: enhanceModels.upscale, weight_dtype: 'default' }),
    '8': node('SeedVR2Conditioning', { model: ['7', 0], vae_conditioning: ['6', 0] }),
    '9': node('KSampler', {
      model: ['7', 0],
      seed: request.seed,
      steps: 1,
      cfg: 1,
      sampler_name: 'euler',
      scheduler: 'simple',
      positive: ['8', 0],
      negative: ['8', 1],
      latent_image: ['6', 0],
      denoise: 1,
    }),
    '10': node('SeedVR2TemporalMerge', { latents: ['9', 0], temporal_overlap: ['6', 1] }),
    '11': node('VAEDecodeTiled', { samples: ['10', 0], vae: ['4', 0], ...tiles }),
    '12': node('SeedVR2PostProcessing', {
      images: ['11', 0],
      original_resized_images: ['2', 0],
      color_correction_method: 'lab',
    }),
    '13': save(id, request, ['12', 0]),
  };
}

/** The node whose file is the result. */
export const enhanceOutputNode = (request: EnhanceRequest | SongRequest) =>
  request.format === 'aftertake-song/1' ? '8' : request.operation === 'interpolate' ? '4' : '13';
