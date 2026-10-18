"""Small media/coordinate adapters. Native SAM3 and H3 perform inference. MIT."""
import hashlib
import json
import math
import os
from fractions import Fraction
import av
import numpy as np
import torch


class AftertakeSubjectPoints:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required':{'images':('IMAGE',),'points_json':('STRING',{'default':'{}'}),
            'source_width':('INT',{'default':1920,'min':1}),'source_height':('INT',{'default':1080,'min':1})}}
    RETURN_TYPES=('STRING','STRING')
    FUNCTION='execute'
    CATEGORY='Aftertake/Character'
    def execute(self,images,points_json,source_width,source_height):
        h,w=images.shape[1:3];scale=max(w/source_width,h/source_height)
        dx=(source_width*scale-w)/2;dy=(source_height*scale-h)/2
        value=json.loads(points_json)
        def points(kind):
            result=[]
            for p in value.get(kind,[]):
                x=float(p['x'])*source_width*scale-dx;y=float(p['y'])*source_height*scale-dy
                if not math.isfinite(x+y):raise ValueError('Subject point must be finite')
                if not 0<=x<=w or not 0<=y<=h:
                    if kind=='positive':raise ValueError('That subject point is outside the prepared frame. Select a point farther inside the picture.')
                    continue
                result.append({'x':min(w-1,round(x)),'y':min(h-1,round(y))})
            return json.dumps(result)
        return points('positive'),points('negative')


class AftertakeSelectCharacterMask:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required':{'masks':('MASK',),'positive_coords':('STRING',{'default':'[]'}),
            'negative_coords':('STRING',{'default':'[]'})}}
    RETURN_TYPES=('MASK',)
    FUNCTION='execute'
    CATEGORY='Aftertake/Character'
    def execute(self,masks,positive_coords,negative_coords):
        positive=json.loads(positive_coords);negative=json.loads(negative_coords)
        if not positive or not len(masks):raise ValueError('No person was detected at that point. Choose a clear point on the person.')
        h,w=masks.shape[-2:];rank=[]
        for index,mask in enumerate(masks):
            def hits(points):return sum(bool(mask[min(h-1,max(0,p['y'])),min(w-1,max(0,p['x']))]>.5)for p in points)
            included=hits(positive);excluded=hits(negative)
            if included:rank.append((included/len(positive)-2*excluded/max(1,len(negative)),index))
        rank.sort(reverse=True)
        if not rank or rank[0][0]<=0:raise ValueError('No detected person matches those selection and exclusion points.')
        if len(rank)>1 and rank[0][0]==rank[1][0]:raise ValueError('Those points match more than one person. Add a point on the intended person or exclude the other person.')
        return (masks[rank[0][1]:rank[0][1]+1],)


class AftertakeSaveCharacterSelection:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required':{'images':('IMAGE',),'masks':('MASK',),
            'filename_prefix':('STRING',{'default':'aftertake/character-selection'}),
            'request_json':('STRING',{'default':'{}'})},'hidden':{'prompt':'PROMPT'}}
    RETURN_TYPES=()
    FUNCTION='execute'
    OUTPUT_NODE=True
    CATEGORY='Aftertake/Character'
    def execute(self,images,masks,filename_prefix,request_json,prompt=None):
        import folder_paths
        from . import export_prompt
        n,h,w=images.shape[:3]
        if not 24<=n<=360 or h%32 or w%32 or w*h>500000 or tuple(masks.shape)!=(n,h,w):
            raise ValueError('Character selection must match a 1–15s, 24 fps prepared source')
        if not torch.isfinite(masks).all():raise ValueError('Selection contains non-finite values')
        folder,name,counter,subfolder,_=folder_paths.get_save_image_path(filename_prefix,folder_paths.get_output_directory())
        mask_name=f'{name}_{counter:05}_mask.mkv';mask_path=os.path.join(folder,mask_name)
        empty=[]
        with av.open(mask_path,'w')as container:
            stream=container.add_stream('ffv1',rate=24);stream.width=w;stream.height=h;stream.pix_fmt='gray'
            stream.options={'level':'3','threads':'2'}
            for i,mask in enumerate(masks):
                pixels=(mask.detach().cpu().numpy()>.5).astype(np.uint8)*255
                if not pixels.any():empty.append(i)
                frame=av.VideoFrame.from_ndarray(pixels,format='gray');frame.pts=i;frame.time_base=Fraction(1,24)
                for packet in stream.encode(frame):container.mux(packet)
            for packet in stream.encode():container.mux(packet)
        with open(mask_path,'rb')as file:mask_hash=hashlib.file_digest(file,'sha256').hexdigest()
        info={'width':w,'height':h,'frames':n,'fps':24,'emptyFrames':empty,'maskSha256':mask_hash}
        preview_name=f'{name}_{counter:05}_preview.mp4'
        with av.open(os.path.join(folder,preview_name),'w')as container:
            container.metadata['comment']=json.dumps({'recipe':{'format':'aftertake-character-selection-output/1',
                'request':json.loads(request_json),'selection':info},'workflow':export_prompt(prompt)},allow_nan=False)
            stream=container.add_stream('libx264',rate=24);stream.width=w;stream.height=h;stream.pix_fmt='yuv420p'
            stream.options={'crf':'17','preset':'fast','threads':'2'}
            for i,(image,mask) in enumerate(zip(images,masks)):
                pixels=(image[...,:3].detach().cpu().clamp(0,1).numpy()*255).round().astype(np.uint8)
                inside=mask.detach().cpu().numpy()>.5
                pixels[inside]=(pixels[inside]*.58+np.array([70,235,150])*.42).round().astype(np.uint8)
                frame=av.VideoFrame.from_ndarray(pixels,format='rgb24');frame.pts=i;frame.time_base=Fraction(1,24)
                for packet in stream.encode(frame):container.mux(packet)
            for packet in stream.encode():container.mux(packet)
        return {'ui':{'gifs':[
            {'filename':mask_name,'subfolder':subfolder,'type':'output','format':'video/x-matroska'},
            {'filename':preview_name,'subfolder':subfolder,'type':'output','format':'video/mp4'}]}}


class AftertakeAlignCharacterMask:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required':{'masks':('MASK',),'images':('IMAGE',),'source_frames':('INT',{'default':56,'min':1})}}
    RETURN_TYPES=('MASK',)
    FUNCTION='execute'
    CATEGORY='Aftertake/Character'
    def execute(self,masks,images,source_frames):
        if len(masks)!=source_frames or len(images)<source_frames or masks.shape[1:3]!=images.shape[1:3]:
            raise ValueError('The reviewed selection does not match this source timeline and canvas')
        if not torch.isfinite(masks).all():raise ValueError('Selection contains non-finite values')
        masks=(masks>.5).float()
        if not masks.flatten(1).any(dim=1).all():raise ValueError('The person was lost in some frames. Review the selection before generating.')
        if len(images)>source_frames:masks=torch.cat((masks,masks[-1:].expand(len(images)-source_frames,-1,-1)))
        return (masks,)


class AftertakeRuntimeInfo:
    @classmethod
    def INPUT_TYPES(cls):
        import shutil
        enabled=os.name=='nt' and os.environ.get('AFTERTAKE_SAFE_WEIGHT_COPIES')=='1'
        return {'required':{'weight_copy_backend':(['pytorch' if enabled else 'native'],),
            'ffmpeg_tools':(['ready' if shutil.which('ffmpeg') and shutil.which('ffprobe') else 'missing'],)}}
    RETURN_TYPES=('STRING',)
    FUNCTION='execute'
    CATEGORY='Aftertake/Runtime'
    def execute(self,weight_copy_backend,ffmpeg_tools):return (weight_copy_backend,)


CHARACTER_NODES={c.__name__:c for c in (AftertakeSubjectPoints,AftertakeSelectCharacterMask,AftertakeSaveCharacterSelection,AftertakeAlignCharacterMask,AftertakeRuntimeInfo)}
