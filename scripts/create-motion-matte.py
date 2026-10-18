"""Track replace/protect subjects locally and export a reusable grayscale video matte.

Uses the public Apache-2.0 SAM 2.1 tiny model through Transformers. An explicit
annotation JSON supplies source/generation files, hashes and pixel clicks/boxes.
No video is uploaded. Review the matte before finishing a saved Aftertake take.
"""
import argparse
import gc
import hashlib
import json
from itertools import islice
from fractions import Fraction
from pathlib import Path
import av
import cv2
import numpy as np
import torch
from PIL import Image
from model_storage import model_root

ROOT=Path(__file__).resolve().parents[1]

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('request',type=Path)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--model-dir',type=Path)
    parser.add_argument('--subject-masks',type=Path,help='Also export the separate source/generation subject arrays for a reviewed compositor.')
    parser.add_argument('--overwrite',action='store_true')
    args=parser.parse_args()
    if args.output.exists() and not args.overwrite:parser.error('Choose a new output or explicitly use --overwrite.')
    if args.subject_masks and args.subject_masks.exists() and not args.overwrite:parser.error('Choose a new subject-mask output or explicitly use --overwrite.')
    if args.subject_masks and args.subject_masks.suffix!='.npz':parser.error('Subject masks use an NPZ file.')
    request=json.loads(args.request.read_text(encoding='utf-8'))
    request_sha=hashlib.sha256(json.dumps(request,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
    if request.get('format')!='aftertake-motion-matte/1':parser.error('Use an aftertake-motion-matte/1 annotation request.')
    width,height,count,fps=(request[key] for key in ['width','height','frames','fps'])
    if not (2<=width<=4096 and 2<=height<=4096 and width%2==height%2==0 and 1<=count<=257 and 1<=fps<=60):parser.error('Invalid matte geometry or duration.')
    manifest=json.loads((ROOT/'docs/models-matting.json').read_text(encoding='utf-8'))
    model_dir=args.model_dir or model_root()/'segmentation/sam2.1-hiera-tiny'
    expected={f['name']:f for f in manifest['files']}
    if any(not (model_dir/name).exists() for name in expected):
        from huggingface_hub import snapshot_download
        snapshot_download(manifest['model'],revision=manifest['revision'],local_dir=model_dir,allow_patterns=list(expected),token=False)
    for name,entry in expected.items():
        path=model_dir/name
        if path.stat().st_size!=entry['bytes'] or sha(path)!=entry['sha256']:raise ValueError('Pinned model file mismatch: '+name)
    from transformers import Sam2VideoModel,Sam2VideoProcessor
    device='cuda' if torch.cuda.is_available() else 'cpu'
    dtype=torch.bfloat16 if device=='cuda' else torch.float32
    torch.set_num_threads(4)
    model=Sam2VideoModel.from_pretrained(model_dir,local_files_only=True,dtype=dtype).to(device).eval()
    processor=Sam2VideoProcessor.from_pretrained(model_dir,local_files_only=True)
    cache_key=hashlib.sha256((request_sha+manifest['revision']+':sam2-matte/1').encode()).hexdigest()
    cache=ROOT/'.runtime/mattes'/cache_key
    cache.mkdir(parents=True,exist_ok=True)
    masks={};verified=[]
    for role in ['source','generation']:
        entry=request[role];path=(args.request.resolve().parent/entry['path']).resolve()
        if sha(path)!=entry['sha256']:raise ValueError('Input content hash mismatch: '+role)
        verified.append({'role':role,'sha256':entry['sha256']})
        objects=entry['objects'];ids=[o['id'] for o in objects]
        if not 1<=len(ids)<=8 or len(set(ids))!=len(ids):raise ValueError('Use one to eight distinct subject identities.')
        stored=cache/f'{role}.npz'
        if stored.exists():
            masks[role]=np.load(stored)['masks'];continue
        with av.open(str(path)) as container:
            stream=container.streams.video[0]
            start=entry.get('startFrame',0)
            if not isinstance(start,int) or not 0<=start<=36000:raise ValueError('Choose a bounded starting frame.')
            video=[frame.to_image().resize((width,height),Image.Resampling.BICUBIC) for frame in islice(container.decode(video=0),start,start+count)]
            if abs(float(stream.average_rate)-fps)>.001:raise ValueError('The source and generation must use the requested frame rate.')
        if len(video)<count:raise ValueError('The video does not cover the complete matte.')
        session=processor.init_video_session(video=video[:count],inference_device=device,inference_state_device=device,
            processing_device='cpu',video_storage_device='cpu',dtype=dtype)
        annotations={}
        for obj in objects:
            if obj['role'] not in ['replace','protect']:raise ValueError('Subject roles are replace or protect.')
            if not any(a['frame']==0 for a in obj['annotations']):raise ValueError('Every subject needs a first-frame annotation.')
            for annotation in obj['annotations']:
                frame=annotation['frame']
                if not isinstance(frame,int) or not 0<=frame<count:raise ValueError('An annotation falls outside the video.')
                annotations.setdefault(frame,[]).append((obj['id'],annotation))
        with torch.inference_mode():
            for frame,entries in sorted(annotations.items()):
                for obj_id,annotation in entries:
                    points=annotation.get('points',[]);labels=annotation.get('labels',[])
                    if len(points)!=len(labels) or any(label not in [0,1] for label in labels):raise ValueError('Point labels must match their clicks.')
                    if any(not (0<=x<width and 0<=y<height) for x,y in points):raise ValueError('A click falls outside the image.')
                    box=annotation.get('box')
                    if box and not (0<=box[0]<box[2]<width and 0<=box[1]<box[3]<height):raise ValueError('A subject box falls outside the image.')
                lengths={len(a.get('points',[])) for _,a in entries}
                boxes=[a.get('box') for _,a in entries]
                if len(lengths)!=1 or any(boxes) and not all(boxes):
                    raise ValueError('Annotations on the same frame need equal click counts and either all or no boxes.')
                processor.add_inputs_to_inference_session(session,frame_idx=frame,obj_ids=[i for i,_ in entries],
                    input_points=[[a['points'] for _,a in entries]] if next(iter(lengths)) else None,
                    input_labels=[[a['labels'] for _,a in entries]] if next(iter(lengths)) else None,
                    input_boxes=[boxes] if all(boxes) else None)
                model(inference_session=session,frame_idx=frame)
            output=np.zeros((count,len(ids),height,width),dtype=np.uint8)
            for prediction in model.propagate_in_video_iterator(session):
                values=processor.post_process_masks([prediction.pred_masks],original_sizes=[[height,width]],binarize=True)[0]
                for i,obj_id in enumerate(session.obj_ids):output[prediction.frame_idx,ids.index(obj_id)]=values[i,0].cpu().numpy().astype('uint8')
                if prediction.frame_idx%12==0:print(f'{role}: {prediction.frame_idx+1}/{count}',flush=True)
        if (output.sum(axis=(2,3))==0).any():raise ValueError('A tracked subject disappeared; refine its annotations before compositing.')
        np.savez_compressed(stored,masks=output);masks[role]=output
        del session;gc.collect()
        if device=='cuda':torch.cuda.empty_cache()
    alpha=[]
    for frame in range(count):
        replace=np.zeros((height,width),dtype=np.uint8);protect=replace.copy()
        for role in ['source','generation']:
            for index,obj in enumerate(request[role]['objects']):
                if obj['role']=='replace':replace=np.maximum(replace,masks[role][frame,index])
                else:protect=np.maximum(protect,masks[role][frame,index])
        replace=cv2.dilate(replace,np.ones((5,5),np.uint8)).astype('float32')
        layer=cv2.GaussianBlur(replace,(0,0),.8)
        layer[cv2.dilate(protect,np.ones((3,3),np.uint8)).astype(bool)]=0
        alpha.append(layer)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    temporary=args.output.with_name(args.output.stem+'.pending.mp4')
    with av.open(str(temporary),'w') as container:
        container.metadata['comment']=json.dumps({'format':'aftertake-matte-video/1','requestCanonicalSHA256':request_sha,'model':manifest['model'],'revision':manifest['revision']})
        stream=container.add_stream('libx264',rate=Fraction(str(fps)));stream.width=width;stream.height=height
        stream.pix_fmt='yuv420p';stream.options={'crf':'0','preset':'fast'}
        for layer in alpha:
            pixels=np.uint8((layer.clip(0,1)*255).round())
            for packet in stream.encode(av.VideoFrame.from_ndarray(np.repeat(pixels[...,None],3,axis=-1),format='rgb24')):container.mux(packet)
        for packet in stream.encode():container.mux(packet)
    temporary.replace(args.output)
    receipt={'format':'aftertake-matte-receipt/1','model':manifest['model'],'revision':manifest['revision'],'license':manifest['license'],
        'requestCanonicalSHA256':request_sha,'inputs':verified,'width':width,'height':height,'frames':count,'fps':fps,
        'outputSHA256':sha(args.output),'modelFilesVerified':True,'network':'Model download only; local segmentation.',
        'operation':'Union source and generated replacement subjects, dilate 2px and feather 0.8px; subtract protected subjects with a 1px guard.'}
    if args.subject_masks:
        args.subject_masks.parent.mkdir(parents=True,exist_ok=True)
        np.savez_compressed(args.subject_masks,source=masks['source'],generation=masks['generation'])
        receipt['subjectMasksSHA256']=sha(args.subject_masks)
    args.output.with_suffix('.receipt.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(receipt),flush=True)

if __name__=='__main__':main()
