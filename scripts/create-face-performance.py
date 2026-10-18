"""Transfer a source video's lip expression into a finished character plate.

Experimental local video-to-video utility. No audio-driven lip-sync, head-pose
repair, identity guarantee or automatic visual approval is implied.
"""
import argparse,json,os,subprocess,sys,tempfile,time
from fractions import Fraction
from pathlib import Path
from face_performance import checked_request,read_frames,mouth_alpha,composite,sha
ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('request',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();output=args.output.resolve();output.parent.mkdir(parents=True,exist_ok=True)
    if output.suffix.lower()!='.mp4':parser.error('Choose an MP4 output.')
    mask_output=output.with_name(output.stem+'-matte.mp4');receipt_output=output.with_suffix('.receipt.json')
    if any(p.exists() for p in [output,mask_output,receipt_output]):parser.error('Choose new output filenames; existing results are retained.')
    raw=json.loads(args.request.read_text(encoding='utf-8'));request=checked_request(raw,args.request.resolve().parent)
    config_path=ROOT/'.runtime/face-performance/config.json'
    if not config_path.exists():parser.error('Run python scripts/setup-face-performance.py first.')
    config=json.loads(config_path.read_text(encoding='utf-8'));runtime=Path(config['runtime']);deps=Path(config['deps'])
    manifest=json.loads((ROOT/'docs/models-face-performance.json').read_text(encoding='utf-8'))
    if subprocess.check_output(['git','-C',str(runtime),'rev-parse','HEAD'],text=True).strip()!=manifest['code']['revision']:raise ValueError('The local LivePortrait revision changed.')
    subprocess.run(['git','-C',str(runtime),'diff','--exit-code','HEAD','--'],check=True,capture_output=True)
    for row in manifest['files']:
        p=runtime/'pretrained_weights'/row['path']
        if not p.is_file() or p.stat().st_size!=row['bytes'] or sha(p)!=row['sha256']:raise ValueError('Pinned model integrity mismatch: '+row['path'])
    sys.path[:0]=[str(deps),str(runtime),str(ROOT/'custom_nodes/aftertake')]
    import av,cv2,numpy as np,torch
    from scipy.ndimage import gaussian_filter1d
    from filelock import FileLock
    from media_utils import mux_source_audio
    from src.config.inference_config import InferenceConfig
    from src.live_portrait_wrapper import LivePortraitWrapper
    from src.utils.human_landmark_runner import LandmarkRunner
    from src.utils.crop import crop_image,crop_image_by_bbox,parse_bbox_from_landmark
    from src.utils.camera import get_rotation_matrix
    if not torch.cuda.is_available():raise ValueError('This experimental profile currently requires the local CUDA runtime.')
    if torch.cuda.mem_get_info()[0]<2*1024**3:raise ValueError('Free at least 2 GB of GPU memory before this optional pass.')
    torch.set_num_threads(6);start=time.monotonic();frames=request['frames'];fps=request['fps']
    base=read_frames(request['base']['path'],frames,fps);driver=read_frames(request['driver']['path'],frames,fps)
    h,w=base[0].shape[:2]
    landmarker=LandmarkRunner(ckpt_path=str(runtime/'pretrained_weights/liveportrait/landmark.onnx'),onnx_provider='cpu')
    def tracked(images,box):
        height,width=images[0].shape[:2];left,top,right,bottom=[round(n*size) for n,size in zip(box,[width,height,width,height])]
        if right-left<24 or bottom-top<24:raise ValueError('The first face box must be at least 24 pixels per side.')
        first=landmarker.run(images[0][top:bottom,left:right])+np.array([left,top]);previous=first;points=[]
        for im in images:
            p=landmarker.run(im,previous)
            if not np.isfinite(p).all() or np.min(p)<-width*.1 or np.max(p[:,0])>width*1.1 or np.max(p[:,1])>height*1.1:raise ValueError('Face tracking left the image; review the first-frame box.')
            if np.linalg.norm(np.mean(p-previous,axis=0))>max(right-left,bottom-top)*.5:raise ValueError('Face tracking jumped; use one continuous performance.')
            previous=p;points.append(p)
        return gaussian_filter1d(np.asarray(points),sigma=.65,axis=0,mode='nearest')
    bl=tracked(base,request['base']['box']);dl=tracked(driver,request['driver']['box'])
    bc=[crop_image(f,l,dsize=512,scale=2.3,vy_ratio=-.125) for f,l in zip(base,bl)]
    boxes=[parse_bbox_from_landmark(l,scale=2.2,vy_ratio=-.1)['bbox'] for l in dl]
    box=np.mean([[b[0,0],b[0,1],b[2,0],b[2,1]] for b in boxes],axis=0)
    dc=[crop_image_by_bbox(f,box,dsize=512) for f in driver]
    model=LivePortraitWrapper(InferenceConfig(flag_use_half_precision=True))
    def tensor(c):return model.prepare_source(cv2.resize(c['img_crop'],(256,256),interpolation=cv2.INTER_AREA))
    di=[model.get_kp_info(tensor(c)) for c in dc]
    temporary=[];changes=[]
    with FileLock(str(output)+'.lock'):
        if any(p.exists() for p in [output,mask_output,receipt_output]):raise ValueError('An output appeared while this pass was preparing; choose a new filename.')
        containers=[]
        try:
            for prefix in ['face-video-','face-mask-']:
                handle,path=tempfile.mkstemp(suffix='.mp4',prefix=prefix,dir=output.parent);os.close(handle);temporary.append(Path(path))
            for path in temporary:
                container=av.open(str(path),'w');s=container.add_stream('libx264',rate=fps);s.width=w;s.height=h;s.pix_fmt='yuv420p';s.options={'crf':'16','preset':'medium'};containers.append((container,s))
            containers[0][0].metadata['comment']=json.dumps({'format':'aftertake-face-performance/1','request':raw,'models':{'repository':manifest['repo'],'revision':manifest['revision'],'codeRevision':manifest['code']['revision']},'operation':'Video-driven lip expression; measured plate head pose retained; tracked lower-face blend.'},ensure_ascii=False)
            for i,(im,c) in enumerate(zip(base,bc)):
                with torch.inference_mode():
                    image=tensor(c);info=model.get_kp_info(image);key=model.transform_keypoint(info);feature=model.extract_feature_3d(image)
                    rotation=get_rotation_matrix(info['pitch'],info['yaw'],info['roll']);expression=info['exp'].clone()
                    for index in [6,12,14,17,19,20]:expression[:,index,:]=di[i]['exp'][:,index,:]
                    target=info['scale'][...,None]*(info['kp']@rotation+expression);target[:,:,:2]+=info['t'][:,None,:2]
                    target=model.stitching(key,target);patch=model.parse_output(model.warp_decode(feature,key,target)['out'])[0]
                    placed=cv2.warpAffine(patch,c['M_c2o'][:2],(w,h));alpha=mouth_alpha(bl[i],h,w);result=composite(im,placed,alpha)
                    changes.append(int(np.count_nonzero(alpha)))
                    matte=np.repeat(np.rint(alpha*255).astype('uint8')[:,:,None],3,axis=2)
                    for pixels,(container,stream) in zip([result,matte],containers):
                        frame=av.VideoFrame.from_ndarray(pixels,format='rgb24');frame.pts=i;frame.time_base=Fraction(1,fps)
                        for packet in stream.encode(frame):container.mux(packet)
                print(f'Facial performance: {i+1}/{frames}',flush=True)
            for container,stream in containers:
                for packet in stream.encode():container.mux(packet)
                container.close()
            containers=[]
            sound=mux_source_audio(temporary[0],request['base']['path'],0,frames/fps)
            # Decode actual output clocks before publishing either artifact.
            for path in temporary:read_frames(path,frames,fps)
            temporary[0].rename(output);temporary[1].rename(mask_output)
            receipt={'format':'aftertake-face-performance-receipt/1','request':raw,'model':manifest,'frames':frames,'fps':fps,'width':w,'height':h,'outputSHA256':sha(output),'matteSHA256':sha(mask_output),'headPoseModified':False,'audioDriven':False,'baseAudioRetained':sound,'zeroAlphaPixelsExactBeforeEncoding':True,'changedMaskPixelsPerFrame':changes,'drivingCrop':'One average box across the complete source sequence.','runtime':{'modelDevice':'CUDA','landmarkDevice':'CPU','elapsedSeconds':time.monotonic()-start},'review':'Review the complete moving face, teeth, jaw, boundaries and head turn before using. No automatic visual acceptance.'}
            receipt_output.write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
            print(json.dumps({'output':str(output),'receipt':str(receipt_output),'frames':frames,'fps':fps}))
        finally:
            for container,_ in containers:container.close()
            for path in temporary:path.unlink(missing_ok=True)

if __name__=='__main__':main()
