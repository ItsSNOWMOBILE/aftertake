"""Experimental local portrait/video head performance, with explicit SAM annotations.

This is a separate finishing utility. It is not an audio lip-sync system or a
studio/MCP control. Review every moving frame before using the resulting clip.
"""
import argparse,gc,json,os,shutil,subprocess,sys,tempfile,time
from fractions import Fraction
from pathlib import Path
from face_performance import read_frames,sha
from head_performance import checked_head_request,validate_annotations,head_composite
ROOT=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('request',type=Path);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();output=args.output.resolve()
    if output.suffix.lower()!='.mp4':parser.error('Choose a new MP4 output.')
    targets=[output,output.with_name(output.stem+'-matte.mp4'),output.with_name(output.stem+'-subjects.npz'),output.with_suffix('.receipt.json')]
    if any(p.exists()for p in targets):parser.error('Choose new output names; existing results are retained.')
    raw=json.loads(args.request.read_text(encoding='utf-8'));request=checked_head_request(raw,args.request.resolve().parent)
    config_path=ROOT/'.runtime/face-performance/config.json'
    if not config_path.is_file():parser.error('Run python scripts/setup-face-performance.py first.')
    config=json.loads(config_path.read_text(encoding='utf-8'));runtime=Path(config['runtime']);deps=Path(config['deps'])
    manifest=json.loads((ROOT/'docs/models-face-performance.json').read_text(encoding='utf-8'))
    if subprocess.check_output(['git','-C',str(runtime),'rev-parse','HEAD'],text=True).strip()!=manifest['code']['revision']:raise ValueError('The local LivePortrait revision changed.')
    subprocess.run(['git','-C',str(runtime),'diff','--exit-code','HEAD','--'],check=True,capture_output=True)
    for row in manifest['files']:
        p=runtime/'pretrained_weights'/row['path']
        if not p.is_file() or p.stat().st_size!=row['bytes'] or sha(p)!=row['sha256']:raise ValueError('Pinned model integrity mismatch: '+row['path'])
    sys.path[:0]=[str(deps),str(runtime),str(ROOT/'custom_nodes/aftertake')]
    import av,cv2,numpy as np,torch
    from PIL import Image
    from scipy.ndimage import gaussian_filter1d
    from filelock import FileLock
    from media_utils import mux_source_audio
    from src.config.inference_config import InferenceConfig
    from src.live_portrait_wrapper import LivePortraitWrapper
    from src.utils.human_landmark_runner import LandmarkRunner
    from src.utils.crop import crop_image_by_bbox,parse_bbox_from_landmark
    from src.utils.camera import get_rotation_matrix
    if not torch.cuda.is_available() or torch.cuda.mem_get_info()[0]<2*1024**3:raise ValueError('This profile needs an idle CUDA runtime with at least 2 GB free.')
    torch.set_num_threads(4);start=time.monotonic();count=request['frames'];fps=request['fps']
    base=read_frames(request['base']['path'],count,fps);driver=read_frames(request['driver']['path'],count,fps)
    height,width=base[0].shape[:2];validate_annotations(request['matte'],width,height)
    with Image.open(request['portrait']['path'])as image:
        if image.size!=(512,512) or image.getexif().get(274,1)!=1:raise ValueError('Use an upright, aligned 512 × 512 portrait.')
        portrait=np.array(image.convert('RGB'))
    output.parent.mkdir(parents=True,exist_ok=True)
    with FileLock(str(ROOT/'.runtime/face-performance/head-inference.lock'),timeout=0),FileLock(str(output)+'.lock',timeout=0):
        if any(p.exists()for p in targets):raise ValueError('An output appeared while preparing the pass; choose a new name.')
        landmarker=LandmarkRunner(ckpt_path=str(runtime/'pretrained_weights/liveportrait/landmark.onnx'),onnx_provider='cpu')
        def track(images,box=None):
            if box is None:previous=landmarker.run(images[0])
            else:
                h,w=images[0].shape[:2];l,t,r,b=[round(v*s)for v,s in zip(box,[w,h,w,h])]
                if min(r-l,b-t)<24:raise ValueError('The initial face box must be at least 24 pixels per side.')
                previous=landmarker.run(images[0][t:b,l:r])+np.array([l,t])
            points=[]
            for im in images:
                p=landmarker.run(im,previous)
                if not np.isfinite(p).all() or np.linalg.norm(np.mean(p-previous,axis=0))>max(im.shape[:2])*.15:raise ValueError('Face tracking jumped; use one continuous shot and review the face box.')
                previous=p;points.append(p)
            return gaussian_filter1d(np.asarray(points),sigma=.65,axis=0,mode='nearest')
        bl=track(base,request['base']['box']);dl=track(driver,request['driver']['box'])
        boxes=[parse_bbox_from_landmark(l,scale=2.2,vy_ratio=-.1)['bbox']for l in dl]
        global_box=np.mean([[b[0,0],b[0,1],b[2,0],b[2,1]]for b in boxes],axis=0)
        driving=[crop_image_by_bbox(f,global_box,dsize=512)['img_crop']for f in driver]
        def animate():
            model=LivePortraitWrapper(InferenceConfig(flag_use_half_precision=True))
            def tensor(im):return model.prepare_source(cv2.resize(im,(256,256),interpolation=cv2.INTER_AREA))
            heads=[]
            with torch.inference_mode():
                source=tensor(portrait);si=model.get_kp_info(source);feature=model.extract_feature_3d(source);key=model.transform_keypoint(si)
                di=[model.get_kp_info(tensor(im))for im in driving]
                R_s=get_rotation_matrix(si['pitch'],si['yaw'],si['roll']);R_0=get_rotation_matrix(di[0]['pitch'],di[0]['yaw'],di[0]['roll'])
                for i,info in enumerate(di):
                    rotation=(get_rotation_matrix(info['pitch'],info['yaw'],info['roll'])@R_0.permute(0,2,1))@R_s
                    expression=si['exp']+(info['exp']-di[0]['exp'])
                    for index in [6,12,14,17,19,20]:expression[:,index,:]=info['exp'][:,index,:]
                    scale=si['scale']*(info['scale']/di[0]['scale']);translation=si['t']+(info['t']-di[0]['t']);translation[...,2].fill_(0)
                    target=scale[...,None]*(si['kp']@rotation+expression)+translation[:,None,:]
                    target=model.stitching(key,target);heads.append(model.parse_output(model.warp_decode(feature,key,target)['out'])[0])
                    if i%12==0:print(f'Head performance: {i+1}/{count}',flush=True)
            return heads
        heads=animate();gc.collect();torch.cuda.empty_cache()
        hl=track(heads)
        def eyes(l):return np.array([np.mean(l[a],axis=0)for a in [[0,6,12,18],[24,30,36,42]]])
        be,he=eyes(bl[0]),eyes(hl[0]);bd,hd=be[1]-be[0],he[1]-he[0]
        if min(np.linalg.norm(bd),np.linalg.norm(hd))<6:raise ValueError('The tracked eyes are too small for head placement.')
        scale=np.linalg.norm(bd)/np.linalg.norm(hd);angle=np.arctan2(bd[1],bd[0])-np.arctan2(hd[1],hd[0])
        linear=np.array([[np.cos(angle),-np.sin(angle)],[np.sin(angle),np.cos(angle)]])*scale
        placed=[]
        for b,h,bp,hp in zip(base,heads,bl,hl):
            matrix=np.c_[linear,eyes(bp).mean(axis=0)-linear@eyes(hp).mean(axis=0)]
            support=cv2.warpAffine(np.ones((512,512),np.float32),matrix,(width,height))
            patch=cv2.warpAffine(h,matrix,(width,height))
            placed.append(np.rint(patch*support[:,:,None]+b*(1-support[:,:,None])).clip(0,255).astype('uint8'))
        def write_video(path,images,metadata=None):
            with av.open(str(path),'w')as c:
                if metadata:c.metadata['comment']=json.dumps(metadata)
                s=c.add_stream('libx264',rate=fps);s.width=width;s.height=height;s.pix_fmt='yuv420p';s.options={'crf':'16','preset':'medium'}
                for i,im in enumerate(images):
                    f=av.VideoFrame.from_ndarray(im,format='rgb24');f.pts=i;f.time_base=Fraction(1,fps)
                    for packet in s.encode(f):c.mux(packet)
                for packet in s.encode():c.mux(packet)
        with tempfile.TemporaryDirectory(prefix='head-performance-',dir=output.parent)as folder:
            work=Path(folder);placed_path=work/'placed-head.mp4';write_video(placed_path,placed)
            shutil.copyfile(request['base']['path'],work/'base.mp4')
            sam_request={'format':'aftertake-motion-matte/1','width':width,'height':height,'frames':count,'fps':fps}
            for role,p in [('source',work/'base.mp4'),('generation',placed_path)]:
                sam_request[role]={'path':p.name,'sha256':sha(p),'objects':[{'id':1,'role':'replace','annotations':request['matte'][role]}]}
            sam_path=work/'matte-request.json';sam_path.write_text(json.dumps(sam_request,indent=2)+'\n',encoding='utf-8')
            subjects=work/'subjects.npz'
            subprocess.run([sys.executable,str(ROOT/'scripts/create-motion-matte.py'),str(sam_path),'--output',str(work/'union.mp4'),'--subject-masks',str(subjects)],check=True)
            with np.load(subjects)as masks:old,new=masks['source'][:,0],masks['generation'][:,0]
            if old.shape!=(count,height,width) or new.shape!=old.shape:raise ValueError('The subject masks do not cover the complete shot.')
            # Composite the same encoded pixels that SAM actually segmented.
            placed=read_frames(placed_path,count,fps);finished=[];alphas=[];holes=[]
            for b,p,o,n in zip(base,placed,old,new):
                result,alpha,removal=head_composite(b,p,o,n);finished.append(result);alphas.append(alpha);holes.append(removal)
            movie=work/'result.mp4';matte=work/'result-matte.mp4'
            write_video(movie,finished,{'format':'aftertake-head-performance/1','request':raw,'operation':'Stable portrait, relative driver pose, direct lip expression, explicit SAM head masks and local exposed-contour fill.'})
            coverage=[np.maximum(a,r.astype('float32'))for a,r in zip(alphas,holes)]
            write_video(matte,[np.repeat(np.uint8(np.rint(a*255))[:,:,None],3,axis=2)for a in coverage])
            audio=mux_source_audio(movie,request['base']['path'],0,count/fps)
            read_frames(movie,count,fps);read_frames(matte,count,fps)
            sam_manifest=json.loads((ROOT/'docs/models-matting.json').read_text(encoding='utf-8'))
            receipt={'format':'aftertake-head-performance-receipt/1','request':raw,'models':{'portrait':manifest,'matting':sam_manifest},'frames':count,'fps':fps,'width':width,'height':height,'outputSHA256':sha(movie),'matteSHA256':sha(matte),'subjectsSHA256':sha(subjects),'samRequest':sam_request,'audioDriven':False,'baseAudioRetained':audio,'rigidPose':'Relative rotation from one global driving crop.','placement':'Initial eye scale/roll calibration; tracked eye-midpoint translation.','fill':'OpenCV Telea radius 3 px only in exposed old head contour.','zeroAlphaAndRemovalPixelsExactBeforeEncoding':True,'removalPixels':[int(a.sum())for a in holes],'runtime':{'modelDevice':'CUDA','landmarkDevice':'CPU','seconds':time.monotonic()-start},'review':'Review hair, jaw, neck, exposed background and the whole moving performance. Not an automatic quality or viseme guarantee.'}
            receipt_path=work/'result.receipt.json';receipt_path.write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
            for source,destination in zip([movie,matte,subjects,receipt_path],targets):source.replace(destination)
        print(json.dumps({'output':str(output),'receipt':str(targets[-1]),'frames':count,'fps':fps}))

if __name__=='__main__':main()
