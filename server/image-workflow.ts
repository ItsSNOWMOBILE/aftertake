import { imageDimensions, imagePrompt, type ImageRequest } from '../src/image-generation.js';

export const imageModels = { diffusion: 'z_image_turbo_bf16.safetensors', encoder: 'qwen_3_4b.safetensors', vae: 'ae.safetensors' };
export function imageRequirements() {
  return { nodes: ['UNETLoader', 'CLIPLoader', 'VAELoader', 'ModelSamplingAuraFlow', 'CLIPTextEncode', 'ConditioningZeroOut', 'EmptySD3LatentImage', 'KSampler', 'VAEDecode', 'SaveImage'],
    menus: [['UNETLoader', 'unet_name', imageModels.diffusion], ['CLIPLoader', 'clip_name', imageModels.encoder], ['VAELoader', 'vae_name', imageModels.vae]] as [string, string, string][] };
}
// Native Z-Image Turbo path, following Comfy's official eight-step template.
// There is no input image: an empty latent is conditioned by the text alone.
export function buildImageWorkflow(request: ImageRequest): Record<string, { class_type: string; inputs: Record<string, unknown> }> {
  const [width, height] = imageDimensions(request.aspect);
  const n = (class_type: string, inputs: Record<string, unknown>) => ({ class_type, inputs });
  return {
    '1': n('UNETLoader', { unet_name: imageModels.diffusion, weight_dtype: 'default' }),
    '2': n('CLIPLoader', { clip_name: imageModels.encoder, type: 'lumina2', device: 'default' }),
    '3': n('VAELoader', { vae_name: imageModels.vae }),
    '4': n('ModelSamplingAuraFlow', { model: ['1', 0], shift: 3 }),
    '5': n('CLIPTextEncode', { clip: ['2', 0], text: imagePrompt(request) }),
    '6': n('ConditioningZeroOut', { conditioning: ['5', 0] }),
    '7': n('EmptySD3LatentImage', { width, height, batch_size: 1 }),
    '17': n('KSampler', { model: ['4', 0], seed: request.seed, steps: 8, cfg: 1, sampler_name: 'res_multistep', scheduler: 'simple', positive: ['5', 0], negative: ['6', 0], latent_image: ['7', 0], denoise: 1 }),
    '19': n('VAEDecode', { samples: ['17', 0], vae: ['3', 0] }),
    '21': n('SaveImage', { images: ['19', 0], filename_prefix: 'aftertake/imagine' }),
  };
}
