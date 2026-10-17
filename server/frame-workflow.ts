import type { FrameEditRequest } from '../src/frame-edit.js';

export const frameEditModels = {
  diffusion: 'qwen-image-edit-2511-Q4_K_M.gguf',
  encoder: 'qwen_2.5_vl_7b_fp8_scaled.safetensors',
  vae: 'qwen_image_vae.safetensors',
  lora: 'Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors',
};
export function frameEditRequirements() {
  return {
    nodes: ['UnetLoaderGGUF', 'CLIPLoader', 'VAELoader', 'ModelSamplingAuraFlow', 'CFGNorm', 'LoraLoaderModelOnly',
      'AftertakeLoadClip', 'FluxKontextImageScale', 'TextEncodeQwenImageEditPlus', 'FluxKontextMultiReferenceLatentMethod',
      'VAEEncode', 'KSampler', 'VAEDecode', 'ImageScale', 'SaveImage'],
    menus: [
      ['UnetLoaderGGUF', 'unet_name', frameEditModels.diffusion], ['CLIPLoader', 'clip_name', frameEditModels.encoder],
      ['VAELoader', 'vae_name', frameEditModels.vae], ['LoraLoaderModelOnly', 'lora_name', frameEditModels.lora],
    ] as [string, string, string][],
  };
}

// Follows Comfy's native 2511 recipe: reference latents use timestep zero.
// The source enters vision conditioning and the initial latent; it is never
// replaced with a text-only image generation workflow.
export function buildFrameEditWorkflow(request: FrameEditRequest) {
  const n = (class_type: string, inputs: Record<string, unknown>) => ({ class_type, inputs });
  const graph = {
    '1': n('UnetLoaderGGUF', { unet_name: frameEditModels.diffusion }),
    '2': n('CLIPLoader', { clip_name: frameEditModels.encoder, type: 'qwen_image', device: 'default' }),
    '3': n('VAELoader', { vae_name: frameEditModels.vae }),
    '4': n('ModelSamplingAuraFlow', { model: ['1', 0], shift: 3.1 }),
    '5': n('CFGNorm', { model: ['4', 0], strength: 1, pre_cfg: false }),
    '8': n('AftertakeLoadClip', { filename: 'INPUT.mp4', width: request.clip.width, height: request.clip.height,
      frames: 1, fps: 1, trim_start: request.trimStart }),
    '9': n('FluxKontextImageScale', { image: ['8', 0] }),
    '10': n('TextEncodeQwenImageEditPlus', { clip: ['2', 0], vae: ['3', 0], image1: ['9', 0], prompt: request.prompt }),
    '11': n('TextEncodeQwenImageEditPlus', { clip: ['2', 0], vae: ['3', 0], image1: ['9', 0], prompt: '' }),
    '12': n('FluxKontextMultiReferenceLatentMethod', { conditioning: ['10', 0], reference_latents_method: 'index_timestep_zero' }),
    '13': n('FluxKontextMultiReferenceLatentMethod', { conditioning: ['11', 0], reference_latents_method: 'index_timestep_zero' }),
    '14': n('VAEEncode', { pixels: ['9', 0], vae: ['3', 0] }),
    '17': n('KSampler', { model: ['5', 0], seed: request.seed, steps: request.mode === 'fast' ? 4 : 20,
      cfg: request.mode === 'fast' ? 1 : 4, sampler_name: 'euler', scheduler: 'simple',
      positive: ['12', 0], negative: ['13', 0], latent_image: ['14', 0], denoise: 1 }),
    '19': n('VAEDecode', { samples: ['17', 0], vae: ['3', 0] }),
    '20': n('ImageScale', { image: ['19', 0], upscale_method: 'lanczos', width: request.clip.width,
      height: request.clip.height, crop: 'disabled' }),
    '21': n('SaveImage', { images: ['20', 0], filename_prefix: 'aftertake/frame-edit' }),
  } as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  if (request.mode === 'fast') {
    graph['6'] = n('LoraLoaderModelOnly', { model: ['5', 0], lora_name: frameEditModels.lora, strength_model: 1 });
    graph['17'].inputs.model = ['6', 0];
  }
  if (request.subject) {
    graph['23'] = n('AftertakeLoadClip', { filename: 'SUBJECT.png', width: request.subject.width, height: request.subject.height,
      frames: 1, fps: 1, trim_start: 0 });
    for (const id of ['10', '11']) graph[id].inputs.image2 = ['23', 0];
  }
  return graph;
}
