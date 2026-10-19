"""Bind app inputs to native SAM3 and the installed, pinned H3 Relay recipe."""
from pathlib import Path
import importlib.util
import json
import sys

ROOT=Path(__file__).resolve().parents[1]
def node(kind,**inputs):return {'class_type':kind,'inputs':inputs}
def build(value):
    request=value['request'];identity=value['id']
    if value['kind']=='selection':
        source=request['clip']
        return {
            'source':node('LoadVideo',file='SOURCE.mp4'),
            'slice':node('Video Slice',video=['source',0],start_time=request['trimStart'],duration=request['duration'],strict_duration=True),
            'prepare':node('H3RelayPrepareSource',video=['slice',0],resolution=request.get('resolution','480'),duration_seconds=0.,missing_audio='silence'),
            'frames':node('ImageFromBatch',image=['prepare',0],batch_index=0,length=['prepare',5]),
            'first':node('ImageFromBatch',image=['frames',0],batch_index=0,length=1),
            'points':node('AftertakeSubjectPoints',images=['first',0],source_width=source['width'],source_height=source['height'],
                points_json=json.dumps({'positive':request['positive'],'negative':request['negative']})),
            'sam':node('CheckpointLoaderSimple',ckpt_name='sam3.1_multiplex_fp16.safetensors'),
            'people':node('CLIPTextEncode',clip=['sam',1],text='person:12'),
            'detect':node('SAM3_Detect',model=['sam',0],image=['first',0],conditioning=['people',0],
                threshold=.35,refine_iterations=2,individual_masks=True),
            'choose':node('AftertakeSelectCharacterMask',masks=['detect',0],positive_coords=['points',0],negative_coords=['points',1]),
            'track':node('SAM3_VideoTrack',images=['frames',0],model=['sam',0],initial_mask=['choose',0],
                detection_threshold=.5,max_objects=1,detect_interval=1),
            'mask':node('SAM3_TrackToMask',track_data=['track',0],object_indices='0'),
            # Remove isolated tracking pixels before review/save, so the later
            # 32px edit expansion cannot turn a speck into an unrelated patch.
            'mask_erode':node('GrowMask',mask=['mask',0],expand=-1,tapered_corners=False),
            'mask_open':node('GrowMask',mask=['mask_erode',0],expand=1,tapered_corners=False),
            'selection':node('AftertakeSaveCharacterSelection',images=['frames',0],masks=['mask_open',0],
                filename_prefix=f'aftertake/characters/{identity}/selection',request_json=json.dumps(request)),
            'source_save':node('SaveVideo',video=['prepare',8],filename_prefix=f'aftertake/characters/{identity}/source',
                format='mp4',**{'format.codec':'h264','format.codec.encoding':'re-encode','format.codec.encoding.crf':14}),
        }
    recipe=ROOT/'.runtime/ComfyUI/custom_nodes/h3-relay/h3_relay/workflows.py'
    if not recipe.is_file():raise ValueError('Install the H3 Relay profile with python scripts/setup.py --character-swap --skip-models')
    spec=importlib.util.spec_from_file_location('installed_h3_recipe',recipe)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    graph=module.character_swap_graph(use_anchor=False,use_mask=True,audio_guide=True,saved_mask=True)
    graph['source']['inputs']['file']='PREPARED.mp4'
    graph['prepare']['inputs']['resolution']=value['selectionRequest'].get('resolution','480')
    graph['video_vae']['inputs']['vae_name']='minimax_h3_video_vae_int8_convrot.safetensors'
    graph['adapter']['inputs']['lora_name']='h3_character_swap_v1.5.safetensors'
    graph['reference']['inputs']['image']='REFERENCE.png'
    if request.get('faceBox'):
        b=request['faceBox'];photo=request['reference']
        x=round(b['x']*photo['width']);y=round(b['y']*photo['height'])
        w=min(photo['width']-x,max(1,round(b['width']*photo['width'])))
        h=min(photo['height']-y,max(1,round(b['height']*photo['height'])))
        graph['face_reference']=node('AftertakeCropRegion',images=['reference',0],x=x,y=y,width=w,height=h,
            target_width=512,target_height=max(64,round(512*h/w/32)*32))
        graph['reference_conditioning']['inputs']['ref_images.ref_image_1']=['face_reference',0]
    # Independent original photos are kept as separate native picture inputs.
    # Prepare only their supplied crop (or full photo), never a synthesized face.
    next_reference=2 if request.get('faceBox') else 1
    for index,identity_reference in enumerate(request.get('identityReferences') or []):
        photo=identity_reference['reference'];b=identity_reference.get('faceBox') or {'x':0,'y':0,'width':1,'height':1}
        x=min(photo['width']-1,max(0,round(b['x']*photo['width'])))
        y=min(photo['height']-1,max(0,round(b['y']*photo['height'])))
        w=min(photo['width']-x,max(1,round(b['width']*photo['width'])))
        h=min(photo['height']-y,max(1,round(b['height']*photo['height'])))
        name=f'identity_reference_{index}';crop=f'identity_face_{index}'
        target_width=min(512,w)
        graph[name]=node('LoadImage',image=f'IDENTITY_{index+1}.png')
        graph[crop]=node('AftertakeCropRegion',images=[name,0],x=x,y=y,width=w,height=h,
            target_width=target_width,target_height=max(1,round(target_width*h/w)))
        graph['reference_conditioning']['inputs'][f'ref_images.ref_image_{next_reference+index}']=[crop,0]
    graph['reference_conditioning']['inputs']['prompt']=value['prompt']
    graph['mask_video']=node('LoadVideo',file='MASK.mkv')
    graph['mask_components']=node('GetVideoComponents',video=['mask_video',0])
    graph['raw_mask']=node('ImageToMask',image=['mask_components',0],channel='red')
    graph['aligned_mask']=node('AftertakeAlignCharacterMask',masks=['raw_mask',0],images=['prepare',0],source_frames=['prepare',5])
    graph['expand_mask']=node('GrowMask',mask=['aligned_mask',0],expand=32,tapered_corners=False)
    graph['plan']['inputs'].update(window_frames='56',history_frames='18',seed=request['seed'])
    graph['sampling_memory']['inputs']['activation_memory_gib']=6.
    graph.pop('video',None)  # The app exporter receives decoded frames directly.
    # The model reconstructs the full scene. Restore the prepared source outside
    # the reviewed edit region, using its original timeline rather than padded H3 masks.
    graph['source_frames']=node('ImageFromBatch',image=['prepare',0],batch_index=0,length=['prepare',5])
    graph['composite_expand_mask']=node('GrowMask',mask=['raw_mask',0],expand=32,tapered_corners=False)
    graph['composite_mask_image']=node('MaskToImage',mask=['composite_expand_mask',0])
    graph['composite_blur']=node('ImageBlur',image=['composite_mask_image',0],blur_radius=3,sigma=1.5)
    graph['composite_mask']=node('ImageToMask',image=['composite_blur',0],channel='red')
    graph['source_composite']=node('ImageCompositeMasked',destination=['source_frames',0],source=['finish',0],
        x=0,y=0,resize_source=False,mask=['composite_mask',0])
    graph['original_audio']=node('AftertakeLoadClip',filename='ORIGINAL.mp4',width=64,height=64,frames=1,fps=24,trim_start=0)
    graph['save']=node('AftertakeSaveVideo',images=['source_composite',0],fps=24,filename_prefix=f'aftertake/characters/{identity}/result',
        recipe_json=json.dumps({'format':'aftertake-character-output/1','request':request,'selectionId':request['selectionId']}),
        source_audio=['original_audio',1],audio_start=value['selectionRequest']['trimStart'])
    return graph

if __name__=='__main__':
    # The app writes UTF-8 JSON; Windows text pipes can otherwise use a legacy code page.
    value=json.loads(sys.stdin.buffer.read().decode('utf-8'))
    sys.stdout.buffer.write((json.dumps(build(value))+'\n').encode('utf-8'))
