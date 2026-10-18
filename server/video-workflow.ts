import {videoDimensions,videoPrompt,type VideoRequest} from '../src/video-generation.js';
import {inpaintModelFiles} from './ltx-models.js';

export const videoAudioModel='ltx-2.5-audio-vae-bf16.safetensors';
export function videoRequirements(){
  return{nodes:['UnetLoaderGGUF','CLIPLoader','VAELoader','CLIPTextEncode','ConditioningZeroOut','LTXVConditioning',
    'EmptyLTXVLatentVideo','LTXVEmptyLatentAudio','LTXVConcatAVLatent','LTXVDualCFGGuider','RandomNoise','KSamplerSelect',
    'ManualSigmas','SamplerCustomAdvanced','LTXVSeparateAVLatent','VAEDecode','LTXVAudioVAEDecode','AftertakeFilmGrade','AftertakeSaveVideo'],
    menus:[['UnetLoaderGGUF','unet_name',inpaintModelFiles.diffusion],['CLIPLoader','clip_name',inpaintModelFiles.encoder],
      ['VAELoader','vae_name',inpaintModelFiles.vae],['VAELoader','vae_name',videoAudioModel]]as [string,string,string][]};
}
// Native distilled LTX-2.5 text-to-video: empty video/audio latents, joint
// sampling and separate native decoders. No image or source-video input exists.
export function buildVideoWorkflow(request:VideoRequest):Record<string,{class_type:string;inputs:Record<string,unknown>}>{
  const d=videoDimensions(request),n=(class_type:string,inputs:Record<string,unknown>)=>({class_type,inputs});
  const graph:ReturnType<typeof buildVideoWorkflow>={
    '1':n('UnetLoaderGGUF',{unet_name:inpaintModelFiles.diffusion}),
    '2':n('CLIPLoader',{clip_name:inpaintModelFiles.encoder,type:'ltxv',device:'default'}),
    '3':n('VAELoader',{vae_name:inpaintModelFiles.vae}),
    '4':n('VAELoader',{vae_name:videoAudioModel}),
    '5':n('CLIPTextEncode',{clip:['2',0],text:videoPrompt(request)}),
    '6':n('ConditioningZeroOut',{conditioning:['5',0]}),
    '7':n('LTXVConditioning',{positive:['5',0],negative:['6',0],frame_rate:d.fps}),
    '8':n('EmptyLTXVLatentVideo',{width:d.width,height:d.height,length:d.frames,batch_size:1}),
    '9':n('LTXVEmptyLatentAudio',{frames_number:d.frames,frame_rate:d.fps,batch_size:1,audio_vae:['4',0]}),
    '10':n('LTXVConcatAVLatent',{video_latent:['8',0],audio_latent:['9',0]}),
    '13':n('RandomNoise',{noise_seed:request.seed}),
    '14':n('KSamplerSelect',{sampler_name:'euler_ancestral'}),
    '15':n('ManualSigmas',{sigmas:'1., 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0'}),
    '16':n('LTXVDualCFGGuider',{model:['1',0],positive:['7',0],negative:['7',1],video_cfg:1,audio_cfg:1}),
    '17':n('SamplerCustomAdvanced',{noise:['13',0],guider:['16',0],sampler:['14',0],sigmas:['15',0],latent_image:['10',0]}),
    '18':n('LTXVSeparateAVLatent',{av_latent:['17',0]}),
    '19':n('VAEDecode',{samples:['18',0],vae:['3',0]}),
    '20':n('AftertakeFilmGrade',{images:['19',0],palette:request.cinema?.palette||'source'}),
    '21':n('AftertakeSaveVideo',{images:['20',0],fps:d.fps,filename_prefix:'aftertake/text-video',recipe_json:JSON.stringify(request)}),
  };
  if(request.sound){graph['22']=n('LTXVAudioVAEDecode',{samples:['18',1],audio_vae:['4',0]});graph['21'].inputs.generated_audio=['22',0];}
  return graph;
}
