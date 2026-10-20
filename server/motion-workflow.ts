import { displayDimensions, renderDimensions, usesCue, type Recipe } from '../src/domain.js';
import { motionFocusGeometry } from '../src/motion-focus.js';
import { applyRenderResolution } from './render-resolution.js';

export const transferModelFiles = {
  diffusion: 'wan_animate_2_distill_int8_convrot.safetensors',
  encoder: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  vision: 'clip_vision_h.safetensors',
  vae: 'Wan2_1_VAE_bf16.safetensors',
};

export function motionTransferRequirements(): {
  nodes: string[];
  menus: [string, string, string][];
} {
  return {
    nodes: [
      'UNETLoader',
      'CLIPLoader',
      'CLIPVisionLoader',
      'CLIPVisionEncode',
      'VAELoader',
      'ImageScale',
      'ImageFromBatch',
      'WanAnimate2ToVideo',
      'WanAnimate2Cache',
      'ModelSamplingSD3',
      'BasicScheduler',
      'SamplerCustom',
      'KSamplerSelect',
      'TrimVideoLatent',
      'VAEDecode',
      'AftertakeLoadClip',
      'AftertakeCueMask',
      'AftertakeComposite',
      'AftertakeSaveVideo',
      'AftertakeCropRegion',
      'AftertakeRestoreRegion',
      'ImageToMask',
      'MaskComposite',
      'ImageCrop',
      'ImagePadForOutpaint',
    ],
    menus: [
      ['UNETLoader', 'unet_name', transferModelFiles.diffusion],
      ['CLIPLoader', 'clip_name', transferModelFiles.encoder],
      ['CLIPVisionLoader', 'clip_name', transferModelFiles.vision],
      ['VAELoader', 'vae_name', transferModelFiles.vae],
    ],
  };
}

export function buildMotionTransferWorkflow(recipe: Recipe): Record<string, unknown> {
  const d = renderDimensions(recipe),
    reference = recipe.transfer?.reference;
  if (!reference) throw Error('Choose an appearance image before transferring motion.');
  const n = (class_type: string, inputs: Record<string, unknown>) => ({ class_type, inputs });
  // Follow the pinned native Wan Animate 2 Distilled blueprint: cache the
  // driving video, use separate appearance/motion conditions, and remove the
  // appended reference latent before decoding. No closed API or pose service.
  const graph: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    '1': n('UNETLoader', { unet_name: transferModelFiles.diffusion, weight_dtype: 'default' }),
    '2': n('CLIPLoader', { clip_name: transferModelFiles.encoder, type: 'wan', device: 'default' }),
    '3': n('VAELoader', { vae_name: transferModelFiles.vae }),
    '4': n('CLIPVisionLoader', { clip_name: transferModelFiles.vision }),
    '5': n('CLIPTextEncode', { clip: ['2', 0], text: recipe.prompt }),
    '6': n('CLIPTextEncode', {
      clip: ['2', 0],
      text: 'frozen motion, blurred hands, malformed limbs, extra arms, text, logos',
    }),
    '7': n('CLIPTextEncode', { clip: ['2', 0], text: recipe.transfer?.motionCaption || '' }),
    '8': n('AftertakeLoadClip', {
      filename: 'INPUT.mp4',
      width: d.width,
      height: d.height,
      frames: d.frames,
      fps: d.fps,
      trim_start: recipe.trimStart,
    }),
    '10': n('ImageFromBatch', { image: ['8', 0], batch_index: 0, length: 1 }),
    '11': n('CLIPVisionEncode', { clip_vision: ['4', 0], image: ['46', 0], crop: 'none' }),
    '12': n('CLIPVisionEncode', { clip_vision: ['4', 0], image: ['10', 0], crop: 'none' }),
    '13': n('WanAnimate2ToVideo', {
      positive: ['5', 0],
      negative: ['6', 0],
      vae: ['3', 0],
      width: d.width,
      height: d.height,
      length: d.frames,
      batch_size: 1,
      reference_image: ['46', 0],
      pose_video: ['8', 0],
      clip_vision_output: ['11', 0],
      positive_pose: ['7', 0],
      clip_vision_output_pose: ['12', 0],
      video_frame_offset: 0,
      pose_strength: recipe.transfer?.poseStrength ?? 1,
      pose_start_percent: 0,
      pose_end_percent: 1,
      reference_image_strength: 1,
    }),
    // Keep the pose cache in system memory, as recommended by the native
    // node. Full-length focused shots can otherwise exhaust a 16 GB GPU
    // alongside the diffusion model, even with the cache quantized to int4.
    '14': n('WanAnimate2Cache', {
      model: ['1', 0],
      device: 'cpu',
      dtype: recipe.quality === 'final' ? 'int4' : 'int8',
    }),
    '15': n('ModelSamplingSD3', { model: ['14', 0], shift: 5 }),
    '16': n('BasicScheduler', { model: ['14', 0], scheduler: 'simple', steps: 10, denoise: 1 }),
    '17': n('SamplerCustom', {
      model: ['15', 0],
      add_noise: true,
      noise_seed: recipe.seed,
      cfg: 1,
      positive: ['13', 0],
      negative: ['13', 1],
      sampler: ['23', 0],
      sigmas: ['16', 0],
      latent_image: ['13', 2],
    }),
    '18': n('TrimVideoLatent', { samples: ['17', 0], trim_amount: ['13', 3] }),
    '19': n('VAEDecode', { samples: ['18', 0], vae: ['3', 0] }),
    '21': n('AftertakeSaveVideo', {
      images: ['19', 0],
      fps: d.fps,
      filename_prefix: 'aftertake/motion-transfer',
      recipe_json: JSON.stringify(recipe),
      source_audio: ['8', 1],
      audio_start: recipe.trimStart,
      display_width: displayDimensions(recipe).width,
      display_height: displayDimensions(recipe).height,
    }),
    '22': n('AftertakeSaveVideo', {
      images: ['19', 0],
      fps: d.fps,
      filename_prefix: 'aftertake/generation',
      recipe_json: JSON.stringify(recipe),
    }),
    '23': n('KSamplerSelect', { sampler_name: 'lcm' }),
    // Load the appearance upright at its own geometry, then crop without
    // stretching. Imported stills have already had private metadata stripped.
    '45': n('AftertakeLoadClip', {
      filename: 'APPEARANCE.png',
      width: reference.width,
      height: reference.height,
      frames: 1,
      fps: d.fps,
      trim_start: 0,
    }),
    '46': n('ImageScale', {
      image: ['45', 0],
      upscale_method: 'lanczos',
      width: d.width,
      height: d.height,
      crop:
        Math.abs(
          Math.log(reference.width / reference.height / (recipe.clip.width / recipe.clip.height)),
        ) < 0.06
          ? 'disabled'
          : 'center',
    }),
  };
  const focus = motionFocusGeometry(recipe);
  if (focus && !recipe.transfer?.finish) {
    const bounds = { x: focus.x, y: focus.y, width: focus.width, height: focus.height };
    const target = { target_width: focus.targetWidth, target_height: focus.targetHeight };
    graph['52'] = n('AftertakeCropRegion', { images: ['8', 0], ...bounds, ...target });
    // A scene-matched appearance uses the same complete-frame transform first.
    graph['53'] = graph['46'];
    graph['46'] = n('AftertakeCropRegion', { images: ['53', 0], ...bounds, ...target });
    graph['10'].inputs.image = ['52', 0];
    Object.assign(graph['13'].inputs, {
      width: focus.targetWidth,
      height: focus.targetHeight,
      pose_video: ['52', 0],
    });
    graph['54'] = n('AftertakeRestoreRegion', {
      original: ['8', 0],
      generated: ['19', 0],
      ...bounds,
    });
    graph['22'].inputs.images = ['54', 0];
    graph['55'] = n('AftertakeSaveVideo', {
      images: ['19', 0],
      fps: d.fps,
      filename_prefix: 'aftertake/focused-generation',
      recipe_json: JSON.stringify(recipe),
    });
  }
  if (usesCue(recipe)) {
    graph['9'] = n('AftertakeCueMask', {
      width: d.width,
      height: d.height,
      frames: d.frames,
      fps: d.fps,
      cue_json: JSON.stringify(recipe.cue),
      images: ['8', 0],
    });
    graph['20'] = n('AftertakeComposite', {
      original: ['8', 0],
      generated: [focus && !recipe.transfer?.finish ? '54' : '19', 0],
      mask: ['9', 0],
      match_color: recipe.matchSourceColor || false,
      spatial_mask: ['9', 2],
    });
    graph['21'].inputs.images = ['20', 0];
    if (recipe.transfer?.finish) {
      graph['19'] = n('AftertakeLoadClip', {
        filename: 'GENERATION.mp4',
        width: d.width,
        height: d.height,
        frames: d.frames,
        fps: d.fps,
        trim_start: 0,
      });
      graph['49'] = n('AftertakeLoadClip', {
        filename: 'MOTION_MATTE.mp4',
        width: d.width,
        height: d.height,
        frames: d.frames,
        fps: d.fps,
        trim_start: 0,
      });
      graph['50'] = n('ImageToMask', { image: ['49', 0], channel: 'red' });
      graph['51'] = n('MaskComposite', {
        destination: ['9', 0],
        source: ['50', 0],
        x: 0,
        y: 0,
        operation: 'multiply',
      });
      graph['20'].inputs.mask = ['51', 0];
    }
  }
  return applyRenderResolution(graph, recipe);
}
