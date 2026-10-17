import { renderDimensions, type Recipe } from '../src/domain.js';
import { cameraTracks, cinemaPrompt } from '../src/cinema.js';
import { frameEditRequirements } from './frame-workflow.js';
export const modelFiles = {
  diffusion: 'ltx-2-19b-distilled_Q4_K_M.gguf',
  encoder: 'gemma_3_12B_it_fp4_mixed.safetensors',
  connector: 'ltx-2-19b-embeddings_connector_distill_bf16.safetensors',
  vae: 'LTX2_video_vae_bf16.safetensors',
  lora: 'ltx-2-19b-ic-lora-canny-control.safetensors',
};
export const requiredNodes = ['UnetLoaderGGUF', 'DualCLIPLoader', 'VAELoader', 'LTXICLoRALoaderModelOnly',
  'LTXAddVideoICLoRAGuideAdvanced', 'AftertakeLoadClip', 'AftertakeCueMask', 'AftertakeComposite', 'AftertakeSaveVideo'];
export const inpaintModelFiles = {
  diffusion: 'ltx-2.5-22b-distilled-Q4_K_M.gguf',
  encoder: 'gemma4-12b-with-proj-ltx-2.5-bf16.safetensors',
  vae: 'ltx-2.5-video-vae-conv-bf16.safetensors',
  lora: 'ltx-2.3-22b-ic-lora-in-outpainting-0.9.safetensors',
};
export const motionModelFile = 'ltx-2.3-22b-ic-lora-motion-track-control-ref0.5.safetensors';
export function requirements(pipeline: Recipe['pipeline'] | 'motion' | 'frame-edit' = 'structure'): { nodes: string[]; menus: [string, string, string][] } {
  if (pipeline === 'frame-edit') return frameEditRequirements();
  if (pipeline === 'motion') {
    const base = requirements('cinema');
    return { nodes: [...base.nodes, 'LTXICLoRALoaderModelOnly', 'LTXVDrawTracks', 'LTXAddVideoICLoRAGuideAdvanced', 'LTXVCropGuides'],
      menus: [...base.menus, ['LTXICLoRALoaderModelOnly', 'lora_name', motionModelFile] as [string, string, string]] };
  }
  if (pipeline === 'cinema') return {
    nodes: ['UnetLoaderGGUF', 'CLIPLoader', 'VAELoader', 'AftertakeLoadClip', 'AftertakeFilmGrade', 'AftertakeSaveVideo', 'LTXVImgToVideoInplace'],
    menus: [
      ['UnetLoaderGGUF', 'unet_name', inpaintModelFiles.diffusion],
      ['CLIPLoader', 'clip_name', inpaintModelFiles.encoder],
      ['VAELoader', 'vae_name', inpaintModelFiles.vae],
    ] as [string, string, string][],
  };
  const inpaint = pipeline === 'inpaint', files = inpaint ? inpaintModelFiles : modelFiles;
  const nodes = inpaint ? requiredNodes.filter(n => n !== 'DualCLIPLoader').concat('CLIPLoader', 'LTXVInpaintPreprocess', 'ThresholdMask', 'LTXVLaplacianPyramidBlend', 'LTXVImgToVideoInplace') : requiredNodes;
  const menus: [string, string, string][] = [
    ['UnetLoaderGGUF', 'unet_name', files.diffusion],
    [inpaint ? 'CLIPLoader' : 'DualCLIPLoader', inpaint ? 'clip_name' : 'clip_name1', files.encoder],
    ['VAELoader', 'vae_name', files.vae], ['LTXICLoRALoaderModelOnly', 'lora_name', files.lora],
  ];
  if (!inpaint) menus.push(['DualCLIPLoader', 'clip_name2', modelFiles.connector]);
  return { nodes, menus };
}
export function buildWorkflow(recipe: Recipe): Record<string, unknown> {
  const d = renderDimensions(recipe);
  const n = (class_type: string, inputs: Record<string, unknown>) => ({ class_type, inputs });
  if (recipe.pipeline === 'cinema') {
    const graph = {
    '1': n('UnetLoaderGGUF', { unet_name: inpaintModelFiles.diffusion }),
    '2': n('CLIPLoader', { clip_name: inpaintModelFiles.encoder, type: 'ltxv', device: 'default' }),
    '3': n('VAELoader', { vae_name: inpaintModelFiles.vae }),
    '5': n('CLIPTextEncode', { clip: ['2', 0], text: cinemaPrompt(recipe.prompt, recipe.cinema) }),
    '6': n('CLIPTextEncode', { clip: ['2', 0], text: '' }),
    '7': n('LTXVConditioning', { positive: ['5', 0], negative: ['6', 0], frame_rate: d.fps }),
    '8': n('AftertakeLoadClip', { filename: 'INPUT.mp4', width: d.width, height: d.height, frames: 1, fps: d.fps, trim_start: recipe.trimStart }),
    '11': n('EmptyLTXVLatentVideo', { width: d.width, height: d.height, length: d.frames, batch_size: 1 }),
    '12': n('LTXVImgToVideoInplace', { vae: ['3', 0], image: ['8', 0], latent: ['11', 0], strength: 1, bypass: false }),
    '13': n('RandomNoise', { noise_seed: recipe.seed }),
    '14': n('KSamplerSelect', { sampler_name: 'euler_ancestral' }),
    '15': n('ManualSigmas', { sigmas: '1., 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0' }),
    '16': n('BasicGuider', { model: ['1', 0], conditioning: ['7', 0] }),
    '17': n('SamplerCustomAdvanced', { noise: ['13', 0], guider: ['16', 0], sampler: ['14', 0], sigmas: ['15', 0], latent_image: ['12', 0] }),
    '19': n('VAEDecodeTiled', { samples: ['17', 0], vae: ['3', 0], tile_size: 256, overlap: 64, temporal_size: 32, temporal_overlap: 8 }),
    '20': n('AftertakeFilmGrade', { images: ['19', 0], palette: recipe.cinema?.palette || 'source' }),
    '21': n('AftertakeSaveVideo', { images: ['20', 0], fps: d.fps, filename_prefix: 'aftertake/cinema', recipe_json: JSON.stringify(recipe) }),
    '22': n('AftertakeSaveVideo', { images: ['19', 0], fps: d.fps, filename_prefix: 'aftertake/generation', recipe_json: JSON.stringify(recipe) }),
    } as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    if (recipe.cinema?.guidance === 'tracks') {
      graph['4'] = n('LTXICLoRALoaderModelOnly', { model: ['1', 0], lora_name: motionModelFile, strength_model: 1 });
      graph['41'] = n('LTXVDrawTracks', { tracks: JSON.stringify(cameraTracks(d.width, d.height, d.frames, recipe.cinema.movement)), width: d.width, height: d.height });
      graph['42'] = n('LTXAddVideoICLoRAGuideAdvanced', {
        positive: ['7', 0], negative: ['7', 1], vae: ['3', 0], latent: ['12', 0], image: ['41', 0],
        frame_idx: 0, strength: 1, latent_downscale_factor: ['4', 1], crop: 'disabled',
        use_tiled_encode: false, tile_size: 256, tile_overlap: 64, attention_strength: 1,
      });
      graph['16'].inputs.model = ['4', 0]; graph['16'].inputs.conditioning = ['42', 0];
      graph['17'].inputs.latent_image = ['42', 2];
      graph['18'] = n('LTXVCropGuides', { positive: ['42', 0], negative: ['42', 1], latent: ['17', 0] });
      graph['19'].inputs.samples = ['18', 2];
      graph['44'] = n('AftertakeSaveVideo', { images: ['41', 0], fps: d.fps, filename_prefix: 'aftertake/framing-guide', recipe_json: JSON.stringify(recipe) });
    }
    return graph;
  }
  const graph: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    '1': n('UnetLoaderGGUF', { unet_name: modelFiles.diffusion }),
    '2': n('DualCLIPLoader', { clip_name1: modelFiles.encoder, clip_name2: modelFiles.connector, type: 'ltxv', device: 'default' }),
    '3': n('VAELoader', { vae_name: modelFiles.vae }),
    '4': n('LTXICLoRALoaderModelOnly', { model: ['1', 0], lora_name: modelFiles.lora, strength_model: 1 }),
    '5': n('CLIPTextEncode', { clip: ['2', 0], text: recipe.prompt }),
    '6': n('CLIPTextEncode', { clip: ['2', 0], text: '' }),
    '7': n('LTXVConditioning', { positive: ['5', 0], negative: ['6', 0], frame_rate: d.fps }),
    '8': n('AftertakeLoadClip', { filename: 'INPUT.mp4', width: d.width, height: d.height, frames: d.frames, fps: d.fps, trim_start: recipe.trimStart }),
    '9': n('AftertakeCueMask', { width: d.width, height: d.height, frames: d.frames, fps: d.fps, cue_json: JSON.stringify(recipe.cue), images: ['8', 0] }),
    '10': n('Canny', { image: ['8', 0], low_threshold: 0.25, high_threshold: 0.5 }),
    '11': n('EmptyLTXVLatentVideo', { width: d.width, height: d.height, length: d.frames, batch_size: 1 }),
    '12': n('LTXAddVideoICLoRAGuideAdvanced', {
      positive: ['7', 0], negative: ['7', 1], vae: ['3', 0], latent: ['11', 0], image: ['10', 0],
      frame_idx: 0, strength: 1, latent_downscale_factor: ['4', 1], crop: 'disabled',
      use_tiled_encode: true, tile_size: 256, tile_overlap: 64,
      attention_strength: 1, attention_mask: ['9', 1],
    }),
    '13': n('RandomNoise', { noise_seed: recipe.seed }),
    '14': n('KSamplerSelect', { sampler_name: 'euler' }),
    '15': n('ManualSigmas', { sigmas: '1., 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0' }),
    '16': n('BasicGuider', { model: ['4', 0], conditioning: ['12', 0] }),
    '17': n('SamplerCustomAdvanced', { noise: ['13', 0], guider: ['16', 0], sampler: ['14', 0], sigmas: ['15', 0], latent_image: ['12', 2] }),
    '18': n('LTXVCropGuides', { positive: ['12', 0], negative: ['12', 1], latent: ['17', 0] }),
    '19': n('VAEDecodeTiled', { samples: ['18', 2], vae: ['3', 0], tile_size: 256, overlap: 64, temporal_size: 32, temporal_overlap: 8 }),
    '20': n('AftertakeComposite', { original: ['8', 0], generated: ['19', 0], mask: ['9', 0] }),
    '21': n('AftertakeSaveVideo', { images: ['20', 0], fps: d.fps, filename_prefix: 'aftertake/composite', recipe_json: JSON.stringify(recipe), source_audio: ['8', 1], audio_start: recipe.trimStart }),
    '22': n('AftertakeSaveVideo', { images: ['19', 0], fps: d.fps, filename_prefix: 'aftertake/generation', recipe_json: JSON.stringify(recipe) }),
  };
  if (recipe.pipeline === 'inpaint') {
    graph['1'].inputs.unet_name = inpaintModelFiles.diffusion;
    graph['2'] = n('CLIPLoader', { clip_name: inpaintModelFiles.encoder, type: 'ltxv', device: 'default' });
    graph['3'].inputs.vae_name = inpaintModelFiles.vae;
    graph['4'].inputs.lora_name = inpaintModelFiles.lora;
    graph['12'].inputs.use_tiled_encode = false;
    graph['14'].inputs.sampler_name = 'euler_ancestral';
    if ((recipe.directionStrength || 1) > 1) graph['16'] = n('CFGGuider', {
      model: ['4', 0], positive: ['12', 0], negative: ['12', 1], cfg: recipe.directionStrength,
    });
    // Keep a consistent hole in the conditioning video. The temporal envelope
    // belongs to the final composite; fading the green plate confuses the adapter.
    graph['23'] = n('ThresholdMask', { mask: ['9', 2], value: 0.01 });
    graph['10'] = n('LTXVInpaintPreprocess', { images: ['8', 0], mask: ['23', 0] });
    // The dedicated adapter reads its spatial cue from the green masked plate.
    // Suppressing guide attention here would suppress the inpainting instruction.
    delete graph['12'].inputs.attention_mask;
    if (recipe.quality === 'final') {
      // Follow the official LTX inpainting recipe: low-resolution generation,
      // pyramid blend, pixel upscale + re-encode, two refinement steps, blend.
      const stageScale = Math.min(1, 512 / Math.max(d.width, d.height));
      const stageWidth = Math.max(64, Math.round(d.width * stageScale / 32) * 32);
      const stageHeight = Math.max(64, Math.round(d.height * stageScale / 32) * 32);
      graph['24'] = n('ImageScale', { image: ['8', 0], upscale_method: 'lanczos', width: stageWidth, height: stageHeight, crop: 'disabled' });
      graph['25'] = n('MaskToImage', { mask: ['9', 2] });
      graph['26'] = n('ImageScale', { image: ['25', 0], upscale_method: 'bilinear', width: stageWidth, height: stageHeight, crop: 'disabled' });
      graph['27'] = n('ImageToMask', { image: ['26', 0], channel: 'red' });
      graph['23'].inputs.mask = ['27', 0];
      graph['10'].inputs.images = ['24', 0];
      graph['11'].inputs.width = stageWidth;
      graph['11'].inputs.height = stageHeight;
      graph['28'] = n('LTXVLaplacianPyramidBlend', { image_a: ['19', 0], image_b: ['10', 0], mask: ['27', 0], trim_to_shortest: false, mask_low_res_dilation: 5 });
      graph['29'] = n('ImageScale', { image: ['28', 0], upscale_method: 'lanczos', width: d.width, height: d.height, crop: 'disabled' });
      graph['30'] = n('VAEEncodeTiled', { pixels: ['29', 0], vae: ['3', 0], tile_size: 256, overlap: 64, temporal_size: 32, temporal_overlap: 8 });
      graph['31'] = n('BasicGuider', { model: ['4', 0], conditioning: ['18', 0] });
      if ((recipe.directionStrength || 1) > 1) graph['31'] = n('CFGGuider', {
        model: ['4', 0], positive: ['18', 0], negative: ['18', 1], cfg: recipe.directionStrength,
      });
      graph['32'] = n('ManualSigmas', { sigmas: '0.7250, 0.4219, 0.0' });
      graph['38'] = n('KSamplerSelect', { sampler_name: 'euler' });
      graph['39'] = n('RandomNoise', { noise_seed: (recipe.seed + 1) % (2 ** 32) });
      graph['33'] = n('SamplerCustomAdvanced', { noise: ['39', 0], guider: ['31', 0], sampler: ['38', 0], sigmas: ['32', 0], latent_image: ['30', 0] });
      graph['34'] = n('VAEDecodeTiled', { samples: ['33', 0], vae: ['3', 0], tile_size: 256, overlap: 64, temporal_size: 32, temporal_overlap: 8 });
      graph['37'] = n('ThresholdMask', { mask: ['9', 2], value: 0.01 });
      graph['36'] = n('LTXVInpaintPreprocess', { images: ['8', 0], mask: ['37', 0] });
      graph['35'] = n('LTXVLaplacianPyramidBlend', { image_a: ['34', 0], image_b: ['36', 0], mask: ['9', 2], trim_to_shortest: false, mask_low_res_dilation: 6 });
      graph['20'].inputs.generated = ['35', 0];
      graph['22'].inputs.images = ['34', 0];
      graph['40'] = n('AftertakeSaveVideo', { images: ['19', 0], fps: d.fps, filename_prefix: 'aftertake/coarse', recipe_json: JSON.stringify(recipe) });
    }
    if (recipe.editReference) {
      graph['45'] = n('AftertakeLoadClip', { filename: 'EDITED_FIRST_FRAME.png', width: graph['11'].inputs.width, height: graph['11'].inputs.height, frames: 1, fps: d.fps, trim_start: 0 });
      graph['46'] = n('LTXVImgToVideoInplace', { vae: ['3', 0], image: ['45', 0], latent: ['11', 0], strength: 1, bypass: false });
      graph['12'].inputs.latent = ['46', 0];
      if (recipe.quality === 'final') {
        graph['47'] = n('AftertakeLoadClip', { filename: 'EDITED_FIRST_FRAME.png', width: d.width, height: d.height, frames: 1, fps: d.fps, trim_start: 0 });
        graph['48'] = n('LTXVImgToVideoInplace', { vae: ['3', 0], image: ['47', 0], latent: ['30', 0], strength: 1, bypass: false });
        graph['33'].inputs.latent_image = ['48', 0];
      }
    }
  }
  return graph;
}
