// Browser-safe profile data; runtime graph construction stays server-side.
export const characterModels={diffusion:'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
  encoder:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',vae:'minimax_h3_video_vae_int8_convrot.safetensors',
  audio:'minimax_h3_audio_vae_fp32.safetensors',adapter:'h3_character_swap_v1.5.safetensors',
  turbo:'minimax_h3_fl2v_turbo_8step_v1.0_768p_comfyui_bf16.safetensors',sam:'sam3.1_multiplex_fp16.safetensors'};
export function characterRequirements(selectionOnly=false):{nodes:string[];menus:[string,string,string][]}{
  const nodes=['LoadVideo','Video Slice','H3RelayPrepareSource','ImageFromBatch','AftertakeSubjectPoints',
    'CheckpointLoaderSimple','CLIPTextEncode','SAM3_Detect','AftertakeSelectCharacterMask','SAM3_VideoTrack','SAM3_TrackToMask','AftertakeSaveCharacterSelection','AftertakeRuntimeInfo','SaveVideo'];
  const menus:[string,string,string][]=[['CheckpointLoaderSimple','ckpt_name',characterModels.sam]];
  if(!selectionOnly){nodes.push('UNETLoader','MiniMaxH3SigmaShift','ModelAttentionBackend','CLIPLoader','SelectCLIPDevice','H3RelayTextMemory','VAELoader','LoraLoaderModelOnly','GetImageSize','LoadImage','AftertakeCropRegion','GetVideoComponents','ImageToMask','GrowMask','VAEEncode','H3RelayWindowPlan',
    'H3RelayWindowInputs','H3RelayApplyHistory','H3RelayApplyEditMask','H3RelaySamplingMemory','H3RelayFinishWindows','StartLoop','EndLoop',
    'RandomNoise','CFGGuider','KSamplerSelect','BasicScheduler','SamplerCustomAdvanced','LTXVSeparateAVLatent','VAEDecode','H3RelayAppendWindow',
    'AftertakeAlignCharacterMask','AftertakeLoadClip','AftertakeSaveVideo','MiniMaxH3ReferenceToVideo','MiniMaxH3AddGuide');
    menus.push(['UNETLoader','unet_name',characterModels.diffusion],['CLIPLoader','clip_name',characterModels.encoder],
      ['VAELoader','vae_name',characterModels.vae],['VAELoader','vae_name',characterModels.audio],
      ['LoraLoaderModelOnly','lora_name',characterModels.adapter],['LoraLoaderModelOnly','lora_name',characterModels.turbo]);}
  return {nodes,menus};
}
